// FarmStore: the single owner of the persisted Snapshot.
// Every intent: pure function → await repo.write(writes) (one transaction) → swap snapshot → emit 'change'.
// If the write fails, nothing changes and the intent rejects with FarmError('storage').
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

  /** Replaces everything (import, starter content). Re-hydrates from what was read back. */
  async replaceAll(snapshot, blobs = []) {
    await this._serial(async () => {
      try {
        await this.repo.replaceAll(snapshot, blobs);
      } catch (e) {
        throw new FarmError("storage", e?.message ?? String(e));
      }
    });
    await this.hydrate();
    this._emit({ kind: "replaced", ids: [] });
  }

  // ---- intents (each resolves after commit) ----
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

  getBlob(sha) { return this.repo.getBlob(sha); }

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
  async _run(fn, args) {
    return this._serial(async () => {
      const result = fn(this.snapshot, args, this.env); // may throw FarmError (invalid input)
      try {
        await this.repo.write(result.writes);
      } catch (e) {
        throw new FarmError(e?.name === "QuotaExceededError" ? "quota" : "storage", e?.message ?? String(e));
      }
      this.snapshot = result.snapshot;
      this._emit(result.change);
      return result.change;
    });
  }

  async _write(writes) {
    return this._serial(async () => {
      try {
        await this.repo.write(writes);
      } catch (e) {
        throw new FarmError("storage", e?.message ?? String(e));
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
