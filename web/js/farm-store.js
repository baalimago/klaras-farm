// FarmStore: the single owner of the persisted Snapshot.
// Every intent: pure function → swap snapshot → emit 'change' (synchronously, inside the caller's
// tap) → repo.write(writes) in one transaction, one write at a time in call order. The intent's
// promise resolves after the commit. The UI never waits for the disk (playtest 2: "state updates
// must propagate immediately"); if a write fails, the snapshot rolls back to the last committed
// one, a 'reverted' change is emitted, and that intent and the ones applied after it reject with
// FarmError('storage' | 'quota') without writing.
import * as I from "./farm/intents.js";
import { FarmError } from "./farm/intents.js";
import { emptySnapshot, migrate, validateSnapshot, storedFormat, FORMAT_VERSION, MIN_READER_FORMAT } from "./farm/snapshot.js";

export class FarmStore extends EventTarget {
  /** @param {import('./types.js').Repository} repo @param {import('./types.js').Env} env */
  constructor(repo, env, appVersion = "dev") {
    super();
    this.repo = repo;
    this.env = env;
    this.appVersion = appVersion;
    /** @type {import('./types.js').Snapshot} */
    this.snapshot = emptySnapshot(env, appVersion);
    this.meta = {};
    this._queue = Promise.resolve();
    /** Blobs written but not yet committed, so getBlob agrees with the optimistic snapshot. */
    this._pendingBlobs = new Map();
    this._replacing = 0;
    this._epoch = 0; // bumped by a failed write: intents applied before it are dropped
  }

  /** Loads from the repository. Returns {fresh:true} when there was no data yet. */
  async hydrate() {
    const data = await this.repo.load();
    this.meta = data.meta ?? {};
    const fresh = !data.settings;
    const base = emptySnapshot(this.env, this.appVersion);
    const candidate = migrate({
      ...base,
      formatVersion: storedFormat(data.things, data.settings),
      settings: data.settings ?? base.settings,
      places: data.places,
      things: data.things,
      clips: data.clips,
    });
    const check = validateSnapshot(candidate);
    if (!check.ok) throw new FarmError("corrupt", check.error);
    this.snapshot = candidate;
    this._emit({ kind: "hydrated", ids: [] });
    return { fresh };
  }

  /** The current snapshot stamped for export. */
  exportSnapshot() {
    return { ...this.snapshot, formatVersion: FORMAT_VERSION, minReaderFormat: MIN_READER_FORMAT, appVersion: this.appVersion, exportedAt: this.env.now(), deviceId: this.env.deviceId };
  }

  /** Replaces everything (import, starter content). Re-hydrates from what was read back. Intents
   *  called meanwhile wait and apply to the replaced farm. */
  async replaceAll(snapshot, blobs = []) {
    this._replacing++;
    try {
      await this._serial(async () => {
        try {
          await this.repo.replaceAll(snapshot, blobs);
        } catch (e) {
          throw new FarmError("storage", e?.message ?? String(e));
        }
        await this.hydrate();
      });
    } finally {
      this._replacing--;
    }
    this._emit({ kind: "replaced", ids: [] });
  }

  // ---- intents (the snapshot and 'change' follow at once; each resolves after commit) ----
  createPlace(args) { return this._run(I.createPlace, args); }
  renamePlace(args) { return this._run(I.renamePlace, args); }
  updatePlace(args) { return this._run(I.updatePlace, args); }
  deletePlace(args) { return this._run(I.deletePlace, args); }
  setCurrentPlace(args) { return this._run(I.setCurrentPlace, args); }
  addPiece(args) { return this._run(I.addPiece, args); }
  updatePiece(args) { return this._run(I.updatePiece, args); }
  removePiece(args) { return this._run(I.removePiece, args); }
  addThing(args) { return this._run(I.addThing, args); }
  updateThing(args) { return this._run(I.updateThing, args); }
  deleteThing(args) { return this._run(I.deleteThing, args); }
  restoreThing(args) { return this._run(I.restoreThing, args); }
  saveClip(args) { return this._run(I.saveClip, args); }
  deleteClip(args) { return this._run(I.deleteClip, args); }
  updateSettings(args) { return this._run(I.updateSettings, args); }
  setQuestionLine(args) { return this._run(I.setQuestionLine, args); }
  addQuestion(args) { return this._run(I.addQuestion, args); }
  removeQuestion(args) { return this._run(I.removeQuestion, args); }
  restoreQuestions(args) { return this._run(I.restoreQuestions, args); }

  // ---- drafts (not part of the snapshot) ----
  async saveDraft(draft) {
    const value = { ...draft, id: draft.id ?? this.env.newId(), updatedAt: this.env.now() };
    await this._write([{ store: "drafts", op: "put", value }]);
    return value;
  }
  async discardDraft(id) { await this._write([{ store: "drafts", op: "delete", key: id }]); }
  listDrafts() { return this.repo.listDrafts(); }

  async setMeta(key, value) {
    await this._write([{ store: "meta", op: "put", value: { key, value } }]);
    this.meta = { ...this.meta, [key]: value };
  }

  getBlob(sha) {
    const pending = this._pendingBlobs.get(sha);
    return pending ? Promise.resolve(pending) : this.repo.getBlob(sha);
  }

  /** Stores a recording's bytes ahead of the clip that will reference it (drafts, re-records). */
  async putBlob(blob) { await this._write([{ store: "blobs", op: "put", value: blob }]); }

  // ---- queries ----
  get settings() { return this.snapshot.settings; }
  get currentPlace() { return this.snapshot.places.find((p) => p.id === this.snapshot.settings.currentPlaceId) ?? this.snapshot.places[0] ?? null; }
  thingsIn(placeId) { return I.thingsIn(this.snapshot, placeId); }
  clipsFor(thingId, filter) { return I.clipsFor(this.snapshot, thingId, filter); }
  canAddThing(placeId) { return I.canAddThing(this.snapshot, placeId); }
  gameClips(filter) { return I.gameClips(this.snapshot, filter); }
  /** Things per scene (Settings), 1 to 12, default 8. */
  get maxThings() { return I.maxThings(this.snapshot); }

  // ---- internals ----
  _run(fn, args) {
    // While a replace is running, the intent must see the replaced farm: apply it in the queue.
    if (this._replacing) return this._serial(() => this._commit(this._apply(fn, args)));
    let result;
    try {
      result = this._apply(fn, args);
    } catch (e) {
      return Promise.reject(e);
    }
    return this._serial(() => this._commit(result));
  }

  /** Runs the pure intent (may throw FarmError for invalid input), swaps the snapshot, emits. */
  _apply(fn, args) {
    const prev = this.snapshot;
    const result = fn(prev, args, this.env);
    this.snapshot = result.snapshot;
    this._holdBlobs(result.writes);
    this._emit(result.change);
    return { ...result, prev, epoch: this._epoch };
  }

  /** Persists one applied intent. Intents applied after a failed one were built on it, so they
   *  are dropped too: the snapshot goes back to the last committed one and they all reject. */
  async _commit(result) {
    try {
      if (result.epoch !== this._epoch) throw new FarmError("storage", "an earlier change could not be saved");
      try {
        await this.repo.write(result.writes);
      } catch (e) {
        this._epoch++;
        this.snapshot = result.prev; // every intent before this one has committed
        this._emit({ kind: "reverted", ids: [] });
        throw new FarmError(e?.name === "QuotaExceededError" ? "quota" : "storage", e?.message ?? String(e));
      }
    } finally {
      this._releaseBlobs(result.writes);
    }
    return result.change;
  }

  _holdBlobs(writes) {
    for (const w of writes ?? []) if (w.store === "blobs" && w.op === "put" && w.value?.sha256) this._pendingBlobs.set(w.value.sha256, w.value);
  }

  _releaseBlobs(writes) {
    for (const w of writes ?? []) if (w.store === "blobs" && w.op === "put" && this._pendingBlobs.get(w.value?.sha256) === w.value) this._pendingBlobs.delete(w.value.sha256);
  }

  async _write(writes) {
    this._holdBlobs(writes);
    return this._serial(async () => {
      try {
        await this.repo.write(writes);
      } catch (e) {
        throw new FarmError("storage", e?.message ?? String(e));
      } finally {
        this._releaseBlobs(writes);
      }
    });
  }

  /** Intents run one at a time, in call order, so each sees the previous one's snapshot. */
  _serial(task) {
    const run = this._queue.then(task, task);
    this._queue = run.catch(() => {});
    return run;
  }

  _emit(detail) {
    this.dispatchEvent(new CustomEvent("change", { detail }));
  }
}
