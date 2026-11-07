// IndexedDB Repository (ARCHITECTURE §9.3). Same contract as memory-repo.js
// (tests/contracts/repository.contract.js).
// Rules: async work (hashing, blob.arrayBuffer()) happens before a transaction opens; one
// transaction per call, readwrite ones with durability 'strict', resolved only on 'complete';
// blobs are stored as ArrayBuffer, never Blob; onversionchange closes the connection.
// Store names, keys and the clip uniqueness index are one-way doors. Upgrades are additive only.

export const DB_NAME = "klaras-farm";
// 2 (format 4): no schema change. The bump makes an older app (format 3) fail to open the database
// with VersionError and show "update needed", instead of reading format 4 records as corrupt and
// inviting an import that would replace them.
// 3 (format 5): no schema change either. It stops a format 4 app the same way, instead of reading
// a custom sky or a new palette key as corrupt and inviting an import that would replace the farm.
// 4 (format 6): no schema change. The bump makes a format 5 app fail with VersionError and show
// "update needed", instead of reading 'find-question' clips as corrupt and inviting an import that
// would replace them; an open format 4 tab gets onversionchange and closes, so it stops writing
// per-thing questions.
export const DB_VERSION = 4;
const SETTINGS_KEY = "settings";
const KEYED = { places: "id", things: "id", clips: "id", blobs: "sha256", drafts: "id", meta: "key" };
const ALL_STORES = ["places", "things", "clips", "blobs", "settings", "drafts", "usage", "meta"];
const SNAPSHOT_STORES = ["places", "things", "clips", "blobs", "settings"];

const connections = new Set();

/**
 * @param {{name?: string, onBlocked?: () => void, onVersionChange?: () => void,
 *          failOn?: ((writes: any[], n: number) => Error|null) | null}} [opts]
 *   onBlocked: an older connection (another window) holds the database during an upgrade;
 *   onVersionChange: another window wants to upgrade, this connection has been closed;
 *   failOn: test hook, like MemoryRepo's: the write is issued in a real transaction, then aborted.
 * @returns {Promise<IdbRepo>}  rejects with IndexedDB's own error (e.g. VersionError) unchanged
 */
export function openIdbRepo({ name = DB_NAME, onBlocked, onVersionChange, failOn = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(Object.assign(new Error("IndexedDB is not available"), { name: "NotSupportedError" }));
      return;
    }
    let req;
    try {
      req = indexedDB.open(name, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = (ev) => upgrade(req.result, ev.oldVersion);
    req.onblocked = () => onBlocked?.();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const repo = new IdbRepo(db, { failOn });
      db.onversionchange = () => {
        repo.close();
        onVersionChange?.();
      };
      db.onclose = () => connections.delete(repo); // closed by the browser (e.g. storage cleared)
      resolve(repo);
    };
  });
}

/** Closes every connection this page opened (before deleting the database). */
export function closeAllConnections() {
  for (const repo of [...connections]) repo.close();
}

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore("places", { keyPath: "id" });
    db.createObjectStore("things", { keyPath: "id" }).createIndex("placeId", "placeId");
    const clips = db.createObjectStore("clips", { keyPath: "id" });
    clips.createIndex("thingId", "thingId");
    clips.createIndex("key", ["thingId", "language", "kind", "take"], { unique: true });
    db.createObjectStore("blobs", { keyPath: "sha256" }).createIndex("createdAt", "createdAt");
    db.createObjectStore("settings");
    db.createObjectStore("drafts", { keyPath: "id" });
    db.createObjectStore("usage");
    db.createObjectStore("meta", { keyPath: "key" });
  }
  // 2 and 3: no schema change (see DB_VERSION). Future versions: `if (oldVersion < 4) { ...additive... }`
}

export class IdbRepo {
  constructor(db, { failOn = null } = {}) {
    this.db = db;
    this.failOn = failOn;
    this.calls = 0;
    connections.add(this);
  }

  async load() {
    const tx = this.db.transaction(["places", "things", "clips", "settings", "meta"], "readonly");
    const [places, things, clips, settings, meta] = await Promise.all([
      req(tx.objectStore("places").getAll()),
      req(tx.objectStore("things").getAll()),
      req(tx.objectStore("clips").getAll()),
      req(tx.objectStore("settings").get(SETTINGS_KEY)),
      req(tx.objectStore("meta").getAll()),
    ]);
    return { places, things, clips, settings: settings ?? null, meta: Object.fromEntries(meta.map((m) => [m.key, m.value])) };
  }

  /** @param {import('../types.js').Write[]} writes  one strict transaction, all or nothing */
  async write(writes) {
    this.calls += 1;
    const ops = writes.map(normalise); // throws before anything is opened
    if (!ops.length) return;
    const stores = [...new Set(ops.map((w) => w.store))];
    await this._readwrite(stores, (tx) => {
      for (const w of ops) {
        const os = tx.objectStore(w.store);
        if (w.store === "settings") w.op === "put" ? os.put(w.value, SETTINGS_KEY) : os.delete(SETTINGS_KEY);
        else if (w.op === "put") os.put(w.value);
        else os.delete(w.key);
      }
    }, writes);
  }

  async getBlob(sha256) {
    const tx = this.db.transaction("blobs", "readonly");
    return (await req(tx.objectStore("blobs").get(sha256))) ?? null;
  }

  async listBlobShas() {
    return req(this.db.transaction("blobs", "readonly").objectStore("blobs").getAllKeys());
  }

  async listDrafts() {
    return req(this.db.transaction("drafts", "readonly").objectStore("drafts").getAll());
  }

  /** Import: one transaction replaces places, things, clips, blobs and settings; meta and drafts stay. */
  async replaceAll(snapshot, blobs) {
    this.calls += 1;
    const records = blobs.map((b) => normalise({ store: "blobs", op: "put", value: b }).value);
    await this._readwrite(SNAPSHOT_STORES, (tx) => {
      for (const s of SNAPSHOT_STORES) tx.objectStore(s).clear();
      for (const p of snapshot.places) tx.objectStore("places").put(p);
      for (const t of snapshot.things) tx.objectStore("things").put(t);
      for (const c of snapshot.clips) tx.objectStore("clips").put(c);
      for (const b of records) tx.objectStore("blobs").put(b);
      tx.objectStore("settings").put(snapshot.settings, SETTINGS_KEY);
    }, [{ store: "*", op: "replace" }]);
  }

  /**
   * Deletes blobs older than the cutoff that no clip or draft references, in one readwrite
   * transaction over clips, drafts and blobs. Only key cursors over blobs: no audio is read.
   */
  sweepOrphanBlobs(olderThanIso) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["clips", "drafts", "blobs"], "readwrite", { durability: "strict" });
      let n = 0;
      tx.oncomplete = () => resolve(n);
      tx.onabort = () => reject(tx.error ?? abortError());
      const clipsReq = tx.objectStore("clips").getAll();
      const draftsReq = tx.objectStore("drafts").getAll();
      draftsReq.onsuccess = () => {
        const used = new Set(clipsReq.result.map((c) => c.blobSha256));
        for (const d of draftsReq.result) for (const c of d.clips ?? []) used.add(c.blobSha256);
        const blobs = tx.objectStore("blobs");
        const cursorReq = blobs.index("createdAt").openKeyCursor(IDBKeyRange.upperBound(olderThanIso, true));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          if (!used.has(cursor.primaryKey)) {
            blobs.delete(cursor.primaryKey);
            n += 1;
          }
          cursor.continue();
        };
      };
    });
  }

  async clear() {
    await this._readwrite(ALL_STORES, (tx) => {
      for (const s of ALL_STORES) tx.objectStore(s).clear();
    }, null);
  }

  close() {
    connections.delete(this);
    this.db.close();
  }

  /** Runs `issue(tx)` synchronously in a strict readwrite transaction; resolves on 'complete'. */
  _readwrite(stores, issue, faultWrites) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this.db.transaction(stores, "readwrite", { durability: "strict" });
      } catch (e) {
        reject(e);
        return;
      }
      let failure = null;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? tx.error ?? abortError());
      try {
        issue(tx);
        failure = faultWrites ? (this.failOn?.(faultWrites, this.calls) ?? null) : null;
      } catch (e) {
        failure = e;
      }
      if (failure) {
        try {
          tx.abort();
        } catch {}
      }
    });
  }
}

/** Validates one write and returns it ready for IndexedDB (blob bytes as an ArrayBuffer). */
function normalise(w) {
  if (w.store !== "settings" && !(w.store in KEYED)) throw new Error(`unknown store ${w.store}`);
  if (w.op === "delete") {
    if (w.store !== "settings" && w.key == null) throw new Error(`missing key for ${w.store}`);
    return w;
  }
  if (w.op !== "put") throw new Error(`unknown op ${w.op}`);
  if (w.store !== "settings" && w.value?.[KEYED[w.store]] == null) throw new Error(`missing key for ${w.store}`);
  if (w.store === "blobs") {
    const bytes = w.value.bytes;
    if (bytes instanceof ArrayBuffer) return w;
    if (ArrayBuffer.isView(bytes)) {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { ...w, value: { ...w.value, bytes: copy } };
    }
    throw new TypeError("blob bytes must be an ArrayBuffer (read Blobs before the transaction)");
  }
  return w;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function abortError() {
  return Object.assign(new Error("transaction aborted"), { name: "AbortError" });
}
