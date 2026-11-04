// Package E in Chromium against the real Python server: the repository contract on IndexedDB,
// export → wipe → import, rejected imports, Delete all data, and the service worker offline.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setup } from "./harness.js";
import { repositoryContract } from "../contracts/repository.contract.js";
import { aSnapshot, aPlace, aThing, aClip } from "../builders.js";

// ArrayBuffers don't cross page.evaluate; this codec carries them as byte arrays both ways.
function enc(v) {
  if (v instanceof ArrayBuffer) return { __ab: Array.from(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) return { __ab: Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}
function dec(v) {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === "object") {
    if (Array.isArray(v.__ab) && Object.keys(v).length === 1) return new Uint8Array(v.__ab).buffer;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]));
  }
  return v;
}

let h;
let page; // one module page hosts every contract repository (one database each)

before(async () => {
  h = await setup();
  page = await h.modulePage();
  await page.evaluate(`window.__enc = ${enc}; window.__dec = ${dec}; window.__repos = new Map();`);
});
after(() => h?.teardown());

// ---- the repository contract, run in Node, executed by IdbRepo inside the page ----
let dbCount = 0;
async function makeIdbRepo(opts = {}) {
  const id = `contract-${++dbCount}`;
  await page.evaluate(async (id) => {
    const { openIdbRepo } = await import("./js/io/idb-repo.js");
    window.__repos.set(id, await openIdbRepo({ name: id }));
  }, id);
  const call = async (method, args, fail = null) => {
    const r = await page.evaluate(
      async ({ id, method, args, fail }) => {
        const repo = window.__repos.get(id);
        repo.failOn = fail ? () => Object.assign(new Error(fail.message), { name: fail.name }) : null;
        try {
          return window.__enc(await repo[method](...window.__dec(args)));
        } catch (e) {
          return { __error: { name: e.name, message: e.message } };
        }
      },
      { id, method, args: enc(args), fail },
    );
    if (r && r.__error) throw Object.assign(new Error(r.__error.message), { name: r.__error.name });
    return dec(r);
  };
  // Faults are decided here (failOn is a Node function) and injected into the real transaction,
  // which issues every request and then aborts: atomicity is IndexedDB's, not the proxy's.
  let calls = 0;
  const faulty = (method) => (...args) => {
    calls += 1;
    const err = opts.failOn?.(method === "write" ? args[0] : [{ store: "*", op: "replace" }], calls);
    return call(method, args, err ? { name: err.name, message: err.message } : null);
  };
  return {
    load: () => call("load", []),
    write: faulty("write"),
    replaceAll: faulty("replaceAll"),
    getBlob: (sha) => call("getBlob", [sha]),
    listBlobShas: () => call("listBlobShas", []),
    listDrafts: () => call("listDrafts", []),
    sweepOrphanBlobs: (iso) => call("sweepOrphanBlobs", [iso]),
    clear: () => call("clear", []),
    close: () => call("close", []),
  };
}

repositoryContract({ describe, it, assert, makeRepo: makeIdbRepo });

describe("IdbRepo specifics", () => {
  it("creates the §9.3 stores and indexes, stores blobs as ArrayBuffer and uses one database version", async () => {
    const out = await page.evaluate(async () => {
      const { openIdbRepo } = await import("./js/io/idb-repo.js");
      const repo = await openIdbRepo({ name: "layout" });
      await repo.write([{ store: "blobs", op: "put", value: { sha256: "a".repeat(64), mime: "audio/mp4", size: 2, createdAt: "2026-11-03T12:00:00.000Z", bytes: new Uint8Array([5, 6]) } }]);
      const blob = await repo.getBlob("a".repeat(64));
      const db = repo.db;
      const tx = db.transaction(["things", "clips", "blobs"]);
      const clips = tx.objectStore("clips");
      const key = clips.index("key");
      const res = {
        version: db.version,
        stores: [...db.objectStoreNames].sort(),
        thingIndexes: [...tx.objectStore("things").indexNames],
        clipIndexes: [...clips.indexNames].sort(),
        keyPath: key.keyPath,
        unique: key.unique,
        bytesIsArrayBuffer: blob.bytes instanceof ArrayBuffer,
        bytes: [...new Uint8Array(blob.bytes)],
      };
      let blobRejected = false;
      try {
        await repo.write([{ store: "blobs", op: "put", value: { sha256: "b".repeat(64), bytes: new Blob([new Uint8Array([1])]) } }]);
      } catch {
        blobRejected = true;
      }
      repo.close();
      return { ...res, blobRejected };
    });
    assert.deepEqual(out, {
      version: 2, // DB_VERSION 2 (format 4): no schema change, it stops a format 3 app with VersionError
      stores: ["blobs", "clips", "drafts", "meta", "places", "settings", "things", "usage"],
      thingIndexes: ["placeId"],
      clipIndexes: ["key", "thingId"],
      keyPath: ["thingId", "language", "kind", "take"],
      unique: true,
      bytesIsArrayBuffer: true,
      bytes: [5, 6],
      blobRejected: true,
    });
  });

  it("closes when another window upgrades, then a newer database rejects with VersionError unchanged", async () => {
    const out = await page.evaluate(async () => {
      const { openIdbRepo, DB_VERSION } = await import("./js/io/idb-repo.js");
      let changed = 0;
      const repo = await openIdbRepo({ name: "versions", onVersionChange: () => changed++ });
      await repo.write([{ store: "meta", op: "put", value: { key: "k", value: 1 } }]);
      // A newer app version in another window: its upgrade must not be blocked by us.
      let blocked = 0;
      await new Promise((ok, fail) => {
        const r = indexedDB.open("versions", DB_VERSION + 1);
        r.onblocked = () => blocked++;
        r.onsuccess = () => { r.result.close(); ok(); };
        r.onerror = () => fail(r.error);
      });
      let error = null;
      try {
        await openIdbRepo({ name: "versions" });
      } catch (e) {
        error = e.name;
      }
      return { changed, blocked, error };
    });
    assert.deepEqual(out, { changed: 1, blocked: 0, error: "VersionError" });
  });
});


// ---- export and import in the browser ----
const sha = (u8) => createHash("sha256").update(u8).digest("hex");
function blobOf(n, seed, mime = "audio/mp4") {
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = (i * seed + 7) & 255;
  return { sha256: sha(u8), mime, size: n, createdAt: "2026-11-03T12:00:00.000Z", bytes: u8.buffer };
}
function farm() {
  const blobs = [blobOf(200_000, 13), blobOf(1500, 7), blobOf(900, 3, "audio/webm")];
  const s = aSnapshot()
    .withPlace(
      aPlace({ name: "Farm" })
        .withPiece({})
        .withThing(
          aThing({ names: { en: "Pig", sv: "Gris" } })
            .withClip(aClip({ blobSha256: blobs[0].sha256 }))
            .withClip(aClip({ language: "sv", blobSha256: blobs[1].sha256 })),
        ),
    )
    .withPlace(aPlace({ name: "Sea", backdrop: "sea" }).withThing(aThing({ names: { en: "Fish" } }).withClip(aClip({ kind: "sound", blobSha256: blobs[2].sha256, mime: "audio/webm" }))))
    .build();
  s.settings.languages = ["en", "sv"];
  return { snapshot: s, blobs };
}

/** Installs page helpers: a filled IndexedDB-backed FarmStore and a dump of everything stored. */
async function farmPage(name) {
  const p = await h.modulePage();
  await p.evaluate(`window.__enc = ${enc}; window.__dec = ${dec};`);
  await p.evaluate(
    async ({ name, data }) => {
      const [{ openIdbRepo }, { FarmStore }, share, snap, fflate] = await Promise.all([
        import("./js/io/idb-repo.js"), import("./js/farm-store.js"), import("./js/io/share.js"), import("./js/farm/snapshot.js"), import("./vendor/fflate.js"),
      ]);
      const env = { now: () => new Date().toISOString(), rng: Math.random, newId: () => crypto.randomUUID(), deviceId: "d" };
      const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
      const { snapshot, blobs } = window.__dec(data);
      const repo = await openIdbRepo({ name });
      const store = new FarmStore(repo, env, "test");
      await store.replaceAll(snapshot, blobs);
      const entities = (s) => {
        const c = snap.canonicalSnapshot(s);
        return snap.canonicalJson({ settings: c.settings, places: c.places, things: c.things, clips: c.clips });
      };
      /** Everything in the database, read through a fresh connection. */
      const dump = async () => {
        const r = await openIdbRepo({ name });
        const d = await r.load();
        const blobs = {};
        for (const k of (await r.listBlobShas()).sort()) blobs[k] = hex((await r.getBlob(k)).bytes);
        r.close();
        return { entities: entities(d), meta: Object.keys(d.meta).sort(), blobs };
      };
      Object.assign(window, { __t: { repo, store, share, snap, fflate, env, dump, entities, openIdbRepo, FarmStore } });
    },
    { name, data: enc(farm()) },
  );
  return p;
}

describe("export and import (IndexedDB)", () => {
  it("export → wipe → import gives an identical canonical snapshot and identical blobs", async () => {
    const p = await farmPage("roundtrip");
    const out = await p.evaluate(async () => {
      const { repo, store, share, dump, entities } = window.__t;
      const before = await dump();
      const exp = await share.buildExport(store);
      const buf = await exp.file.arrayBuffer();
      await repo.clear();
      await store.hydrate();
      const wiped = await dump();
      const counts = await share.importReplacing(store, buf);
      const after = await dump();
      return { before, wiped, after, counts, name: exp.name, live: entities(store.snapshot) };
    });
    assert.equal(Object.keys(out.wiped.blobs).length, 0);
    assert.equal(JSON.parse(out.wiped.entities).places.length, 0);
    assert.deepEqual(out.counts, { places: 2, things: 2, clips: 3 });
    assert.equal(out.after.entities, out.before.entities);
    assert.equal(out.live, out.before.entities);
    assert.deepEqual(out.after.blobs, out.before.blobs);
    assert.equal(Object.keys(out.after.blobs).length, 3);
    assert.match(out.name, /^klaras-farm-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it("rejects corrupt, foreign and newer files with storage unchanged", async () => {
    const p = await farmPage("rejects");
    const out = await p.evaluate(async () => {
      const { store, share, fflate, dump } = window.__t;
      const before = await dump();
      const good = fflate.unzipSync(new Uint8Array(await (await share.buildExport(store)).file.arrayBuffer()));
      const manifest = JSON.parse(fflate.strFromU8(good["manifest.json"]));
      const zip = (e) => fflate.zipSync(e, { level: 0 }).buffer;
      const blobKey = Object.keys(good).find((k) => k.startsWith("blobs/"));
      const tampered = { ...good, [blobKey]: good[blobKey].map((b, i) => (i === 10 ? b ^ 1 : b)) };
      const missing = { ...good };
      delete missing[blobKey];
      const dupClip = { ...manifest, clips: [...manifest.clips, { ...manifest.clips[0], id: "dup" }] };
      const files = {
        garbage: new TextEncoder().encode("hello, not a zip").buffer,
        truncated: zip(good).slice(0, 2000),
        foreign: zip({ "manifest.json": fflate.strToU8('{"name":"x"}') }),
        newer: zip({ ...good, "manifest.json": fflate.strToU8(JSON.stringify({ ...manifest, formatVersion: 6, minReaderFormat: 5 })) }),
        tampered: zip(tampered),
        missing: zip(missing),
        dupClip: zip({ ...good, "manifest.json": fflate.strToU8(JSON.stringify(dupClip)) }),
      };
      const codes = {};
      for (const [k, buf] of Object.entries(files)) {
        try {
          await share.importReplacing(store, buf);
          codes[k] = "accepted";
        } catch (e) {
          codes[k] = `${e.name}:${e.code}`;
        }
      }
      return { before, after: await dump(), codes, canUndo: share.canUndoImport(store) };
    });
    assert.deepEqual(out.codes, {
      garbage: "ImportError:not-a-farm",
      truncated: "ImportError:not-a-farm",
      foreign: "ImportError:not-a-farm",
      newer: "ImportError:newer",
      tampered: "ImportError:corrupt",
      missing: "ImportError:corrupt",
      dupClip: "ImportError:corrupt",
    });
    assert.deepEqual(out.after, out.before);
    assert.ok(!out.after.meta.includes("preImport"));
    assert.equal(out.canUndo, false);
  });

  it("an import can be undone until the next boot", async () => {
    const p = await farmPage("undo");
    const out = await p.evaluate(async () => {
      const { store, share, dump, env, FarmStore, openIdbRepo } = window.__t;
      const before = await dump();
      const other = new FarmStore(await openIdbRepo({ name: "undo-other" }), env, "test");
      await other.replaceAll({ ...store.snapshot, places: [], things: [], clips: [], settings: { ...store.snapshot.settings, currentPlaceId: null } }, []);
      await share.importReplacing(store, await (await share.buildExport(other)).file.arrayBuffer());
      const imported = await dump();
      const canUndo = share.canUndoImport(store);
      await share.undoImport(store);
      return { before, imported, canUndo, after: await dump(), canUndoAfter: share.canUndoImport(store) };
    });
    assert.equal(JSON.parse(out.imported.entities).places.length, 0);
    assert.equal(out.canUndo, true);
    assert.equal(out.after.entities, out.before.entities);
    assert.deepEqual(out.after.blobs, out.before.blobs);
    assert.equal(out.canUndoAfter, false);
  });
});

// ---- storage utilities and the service worker ----
describe("storage and service worker", () => {
  it("deleteAllData leaves no databases, caches, service worker registrations or local storage", async () => {
    const p = await h.modulePage();
    const out = await p.evaluate(async () => {
      const [{ openIdbRepo }, storage] = await Promise.all([import("./js/io/idb-repo.js"), import("./js/io/storage.js")]);
      const repo = await openIdbRepo(); // left open, as the running app would
      await repo.write([{ store: "meta", op: "put", value: { key: "x", value: 1 } }]);
      await openIdbRepo({ name: "another" });
      const id = storage.deviceId();
      await (await caches.open("kf-test")).put("/x", new Response("x"));
      await storage.registerServiceWorker();
      await navigator.serviceWorker.ready;
      const before = {
        dbs: (await indexedDB.databases()).length,
        caches: (await caches.keys()).length,
        regs: (await navigator.serviceWorker.getRegistrations()).length,
        ls: localStorage.length,
        stableId: storage.deviceId() === id,
      };
      const result = await storage.deleteAllData();
      return {
        before,
        result,
        after: {
          dbs: (await indexedDB.databases()).map((d) => d.name),
          caches: await caches.keys(),
          regs: (await navigator.serviceWorker.getRegistrations()).length,
          ls: localStorage.length,
        },
      };
    });
    assert.ok(out.before.dbs >= 2 && out.before.caches >= 1 && out.before.regs === 1 && out.before.ls >= 1);
    assert.equal(out.before.stableId, true);
    assert.deepEqual(out.result, { blocked: false });
    assert.deepEqual(out.after, { dbs: [], caches: [], regs: 0, ls: 0 });
  });

  it("the service worker installs from /sw.js, precaches, and serves / and the assets offline", async () => {
    const p = await h.modulePage();
    const { assets } = await (await fetch(`${h.server.url}/healthz`)).json();
    const out = await p.evaluate(async () => {
      const storage = await import("./js/io/storage.js");
      let updateReady = 0;
      storage.watchForUpdates(() => updateReady++);
      const reg = await storage.registerServiceWorker();
      await navigator.serviceWorker.ready;
      const keys = await caches.keys();
      const cache = await caches.open(keys[0]);
      const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
      return { scope: new URL(reg.scope).pathname, script: new URL(reg.active.scriptURL).pathname, keys, cached, updateReady };
    });
    assert.equal(out.scope, "/");
    assert.equal(out.script, "/sw.js");
    assert.deepEqual(out.keys, [`kf-${assets}`]);
    for (const path of ["/", `/v/${assets}/js/io/share.js`, `/v/${assets}/css/main.css`, `/v/${assets}/vendor/fflate.js`]) assert.ok(out.cached.includes(path), path);
    assert.equal(out.updateReady, 0, "a first install is not an update");

    await p.context().setOffline(true);
    const res = await p.goto(`${h.server.url}/`);
    assert.equal(res.status(), 200);
    assert.match(await p.content(), new RegExp(`/v/${assets}/`));
    const offline = await p.evaluate(async (assets) => {
      const urls = [`/v/${assets}/js/io/idb-repo.js`, `/v/${assets}/css/main.css`, `/v/${assets}/manifest.webmanifest`];
      const statuses = await Promise.all(urls.map((u) => fetch(u).then((r) => r.status, () => "failed")));
      const network = await fetch("/healthz").then(() => "online", () => "offline");
      return { statuses, network, controlled: !!navigator.serviceWorker.controller };
    }, assets);
    await p.context().setOffline(false);
    assert.deepEqual(offline, { statuses: [200, 200, 200], network: "offline", controlled: true });
  });
});
