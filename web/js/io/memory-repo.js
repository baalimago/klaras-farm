// In-memory Repository. Same contract as idb-repo.js (tests/contracts/repository.contract.js).
// `failOn` injects faults for tests: failOn = (writes, n) => Error|null, n = write call count.

import { clipKey } from "../farm/snapshot.js";

const STORES = ["places", "things", "clips", "blobs", "drafts", "meta"];
const keyOf = (store, value) => (store === "blobs" ? value.sha256 : store === "meta" ? value.key : value.id);
const clone = (v) => structuredClone(v);

export class MemoryRepo {
  constructor({ failOn = null } = {}) {
    this.failOn = failOn;
    this.calls = 0;
    this._reset();
  }

  _reset() {
    this.data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
    this.settings = null;
  }

  async load() {
    return {
      places: [...this.data.places.values()].map(clone),
      things: [...this.data.things.values()].map(clone),
      clips: [...this.data.clips.values()].map(clone),
      settings: this.settings ? clone(this.settings) : null,
      meta: Object.fromEntries([...this.data.meta.values()].map((m) => [m.key, clone(m.value)])),
    };
  }

  async write(writes) {
    this.calls += 1;
    const err = this.failOn?.(writes, this.calls);
    if (err) throw err;
    // Validate everything first, then apply: all or nothing.
    for (const w of writes) {
      if (w.store !== "settings" && !STORES.includes(w.store)) throw new Error(`unknown store ${w.store}`);
      if (w.op === "put" && w.store !== "settings" && keyOf(w.store, w.value) == null) throw new Error(`missing key for ${w.store}`);
    }
    const clipIndex = new Map([...this.data.clips.values()].map((c) => [uniq(c), c.id]));
    for (const w of writes) {
      if (w.store === "clips" && w.op === "delete") {
        const c = this.data.clips.get(w.key);
        if (c) clipIndex.delete(uniq(c));
      }
      if (w.store === "clips" && w.op === "put") {
        // A put of an existing clip under a new key (a renumbered take) frees its old key, as in IndexedDB.
        for (const [k, id] of clipIndex) if (id === w.value.id) clipIndex.delete(k);
        const owner = clipIndex.get(uniq(w.value));
        if (owner && owner !== w.value.id) {
          const e = new Error("clip key not unique");
          e.name = "ConstraintError";
          throw e;
        }
        clipIndex.set(uniq(w.value), w.value.id);
      }
    }
    for (const w of writes) {
      if (w.store === "settings") this.settings = clone(w.value);
      else if (w.op === "put") this.data[w.store].set(keyOf(w.store, w.value), clone(w.value));
      else this.data[w.store].delete(w.key);
    }
  }

  async getBlob(sha256) {
    const b = this.data.blobs.get(sha256);
    return b ? clone(b) : null;
  }

  async listBlobShas() { return [...this.data.blobs.keys()]; }
  async listDrafts() { return [...this.data.drafts.values()].map(clone); }

  async replaceAll(snapshot, blobs) {
    this.calls += 1;
    const err = this.failOn?.([{ store: "*", op: "replace" }], this.calls);
    if (err) throw err;
    const meta = this.data.meta;
    const drafts = this.data.drafts;
    this._reset();
    this.data.meta = meta; // meta (e.g. the pre-import backup) and drafts survive an import
    this.data.drafts = drafts;
    for (const p of snapshot.places) this.data.places.set(p.id, clone(p));
    for (const t of snapshot.things) this.data.things.set(t.id, clone(t));
    for (const c of snapshot.clips) this.data.clips.set(c.id, clone(c));
    for (const b of blobs) this.data.blobs.set(b.sha256, clone(b));
    this.settings = clone(snapshot.settings);
  }

  async sweepOrphanBlobs(olderThanIso) {
    const used = new Set([...this.data.clips.values()].map((c) => c.blobSha256));
    for (const d of this.data.drafts.values()) for (const c of d.clips ?? []) used.add(c.blobSha256);
    let n = 0;
    for (const [sha, b] of this.data.blobs) {
      if (!used.has(sha) && b.createdAt < olderThanIso) {
        this.data.blobs.delete(sha);
        n += 1;
      }
    }
    return n;
  }

  async clear() { this._reset(); }
  close() {}
}

// The clip uniqueness key (thing clips by thing, colour game clips by colour), as IndexedDB enforces it.
const uniq = (c) => clipKey(c);
