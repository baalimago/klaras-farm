// io/share.js in Node: Node 22 has crypto.subtle and File, and fflate is plain JS.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildExport, readImport, importReplacing, undoImport, canUndoImport, discardImportBackup, ImportError } from "./share.js";
import { sha256Hex } from "./sha.js";
import { FarmStore } from "../farm-store.js";
import { MemoryRepo } from "./memory-repo.js";
import { canonicalJson, canonicalSnapshot } from "../farm/snapshot.js";
import { zipSync, unzipSync, strToU8, strFromU8 } from "../../vendor/fflate.js";
import { aSnapshot, aPlace, aThing, aClip, fixedEnv } from "../../../tests/builders.js";

const sha = (u8) => createHash("sha256").update(u8).digest("hex");
const T0 = "2026-11-03T12:00:00.000Z";

function blobOf(bytes, mime = "audio/mp4") {
  const u8 = new Uint8Array(bytes);
  return { sha256: sha(u8), mime, size: u8.byteLength, createdAt: T0, bytes: u8.buffer };
}

/** A store with two places, three clips (two in Swedish) and their blobs. */
async function filledStore(repo = new MemoryRepo()) {
  const blobs = [blobOf([1, 2, 3, 4]), blobOf([9, 8, 7]), blobOf(Array.from({ length: 300 }, (_, i) => i % 256), "audio/webm")];
  const s = aSnapshot()
    .withPlace(
      aPlace().withThing(
        aThing({ names: { en: "Pig", sv: "Gris" } })
          .withClip(aClip({ blobSha256: blobs[0].sha256 }))
          .withClip(aClip({ language: "sv", blobSha256: blobs[1].sha256 }))
          .withClip(aClip({ language: "sv", kind: "sound", blobSha256: blobs[2].sha256, mime: "audio/webm" })),
      ),
    )
    .withPlace(aPlace({ name: "Sea", backdrop: "sea" }).withThing(aThing({ names: { en: "Fish" } })))
    .build();
  s.settings.languages = ["en", "sv"];
  const store = new FarmStore(repo, fixedEnv(), "test");
  await store.replaceAll(s, blobs);
  return { store, repo, blobs };
}

const comparable = (s) => canonicalJson((({ settings, places, things, clips }) => ({ settings, places, things, clips }))(canonicalSnapshot(s)));

async function blobBytes(repo) {
  const out = {};
  for (const k of (await repo.listBlobShas()).sort()) out[k] = [...new Uint8Array((await repo.getBlob(k)).bytes)];
  return out;
}

async function stateOf(repo) {
  const d = await repo.load();
  return { data: canonicalJson(d), blobs: await blobBytes(repo) };
}

describe("sha256Hex", () => {
  it("matches node's sha256", async () => {
    const u8 = new Uint8Array([104, 105]);
    assert.equal(await sha256Hex(u8.buffer), sha(u8));
    assert.equal(await sha256Hex(u8), sha(u8));
  });
});

describe("buildExport", () => {
  it("writes a stored zip with the canonical manifest and one entry per blob", async () => {
    const { store, blobs } = await filledStore();
    const out = await buildExport(store);
    assert.match(out.name, /^klaras-farm-\d{4}-\d{2}-\d{2}\.zip$/);
    assert.equal(out.file.name, out.name);
    assert.equal(out.file.type, "application/zip");
    assert.deepEqual(out.counts, { places: 2, things: 2, clips: 3, blobs: 3, missingBlobs: 0, bytes: out.file.size });
    const u8 = new Uint8Array(await out.file.arrayBuffer());
    const entries = unzipSync(u8);
    assert.deepEqual(Object.keys(entries).sort(), ["manifest.json", ...blobs.map((b) => `blobs/${b.sha256}`)].sort());
    const manifest = strFromU8(entries["manifest.json"]);
    assert.equal(manifest, canonicalJson(canonicalSnapshot(JSON.parse(manifest))));
    assert.equal(JSON.parse(manifest).formatVersion, 1);
    for (const b of blobs) assert.deepEqual([...entries[`blobs/${b.sha256}`]], [...new Uint8Array(b.bytes)]);
    // Local file header: compression method 0 (stored).
    assert.equal(new DataView(u8.buffer, u8.byteOffset).getUint16(8, true), 0);
  });

  it("leaves out clips whose recording is missing, so the file always imports", async () => {
    const { store, repo, blobs } = await filledStore();
    await repo.write([{ store: "blobs", op: "delete", key: blobs[1].sha256 }]);
    const out = await buildExport(store);
    assert.equal(out.counts.missingBlobs, 1);
    assert.equal(out.counts.clips, 2);
    const back = await readImport(await out.file.arrayBuffer());
    assert.equal(back.snapshot.clips.length, 2);
  });
});

describe("readImport", () => {
  it("returns the snapshot and blobs with ArrayBuffer bytes", async () => {
    const { store, blobs } = await filledStore();
    const { file } = await buildExport(store);
    const out = await readImport(await file.arrayBuffer(), { now: T0 });
    assert.equal(comparable(out.snapshot), comparable(store.snapshot));
    assert.deepEqual(out.counts, { places: 2, things: 2, clips: 3 });
    for (const b of out.blobs) {
      assert.ok(b.bytes instanceof ArrayBuffer);
      assert.equal(b.createdAt, T0);
      assert.equal(b.size, b.bytes.byteLength);
    }
    assert.deepEqual(out.blobs.map((b) => b.sha256).sort(), blobs.map((b) => b.sha256).sort());
  });

  it("rejects garbage, a zip without a manifest, a newer file and a tampered blob", async () => {
    const { store } = await filledStore();
    const good = unzipSync(new Uint8Array(await (await buildExport(store)).file.arrayBuffer()));
    const zip = (entries) => zipSync(entries, { level: 0 }).buffer;
    const manifest = JSON.parse(strFromU8(good["manifest.json"]));
    const cases = [
      [new Uint8Array([1, 2, 3, 4, 5]).buffer, "not-a-farm"],
      [new ArrayBuffer(0), "not-a-farm"],
      [zip({ "hello.txt": strToU8("hi") }), "not-a-farm"],
      [zip({ ...good, "manifest.json": strToU8(JSON.stringify({ ...manifest, formatVersion: 3, minReaderFormat: 2 })) }), "newer"],
    ];
    const tampered = { ...good };
    const key = Object.keys(good).find((k) => k.startsWith("blobs/"));
    tampered[key] = new Uint8Array([...good[key], 0]);
    cases.push([zip(tampered), "corrupt"]);
    const missing = { ...good };
    delete missing[key];
    cases.push([zip(missing), "corrupt"]);
    for (const [buf, code] of cases) {
      await assert.rejects(readImport(buf), (e) => e instanceof ImportError && e.code === code, code);
    }
  });
});

describe("importReplacing", () => {
  it("export → wipe → import gives an identical canonical snapshot and identical blobs", async () => {
    const { store, repo } = await filledStore();
    const before = comparable(store.snapshot);
    const beforeBlobs = await blobBytes(repo);
    const { file } = await buildExport(store);
    await repo.clear();
    await store.hydrate();
    assert.equal(store.snapshot.places.length, 0);
    const counts = await importReplacing(store, await file.arrayBuffer());
    assert.deepEqual(counts, { places: 2, things: 2, clips: 3 });
    assert.equal(comparable(store.snapshot), before);
    assert.equal(comparable(await repo.load()), before); // read back, not from memory
    assert.deepEqual(await blobBytes(repo), beforeBlobs);
  });

  it("rejects bad files with storage unchanged and no backup written", async () => {
    const { store, repo } = await filledStore();
    const before = await stateOf(repo);
    await assert.rejects(importReplacing(store, new Uint8Array([80, 75, 3, 4, 0]).buffer), ImportError);
    assert.deepEqual(await stateOf(repo), before);
    assert.equal(canUndoImport(store), false);
  });

  it("keeps a pre-import backup that undoImport restores", async () => {
    const { store: other } = await filledStore();
    await other.renamePlace({ placeId: other.snapshot.places[0].id, name: "Other farm" });
    const { file } = await buildExport(other);

    const { store, repo } = await filledStore();
    const before = comparable(store.snapshot);
    const beforeBlobs = await blobBytes(repo);
    await importReplacing(store, await file.arrayBuffer());
    assert.ok(store.snapshot.places.some((p) => p.name === "Other farm"));
    assert.ok(store.meta.preImport instanceof ArrayBuffer);
    assert.equal(canUndoImport(store), true);

    await undoImport(store);
    assert.equal(comparable(store.snapshot), before);
    assert.deepEqual(await blobBytes(repo), beforeBlobs);
    assert.equal(canUndoImport(store), false);
    assert.equal(store.meta.preImport, null);
  });

  it("does not replace anything when the backup cannot be written", async () => {
    let failMeta = false;
    const repo = new MemoryRepo({ failOn: (w) => (failMeta && w.some((x) => x.store === "meta") ? Object.assign(new Error("full"), { name: "QuotaExceededError" }) : null) });
    const { store } = await filledStore(repo);
    const { store: other } = await filledStore();
    const { file } = await buildExport(other);
    const before = await stateOf(repo);
    failMeta = true;
    await assert.rejects(importReplacing(store, await file.arrayBuffer()), /full/);
    assert.deepEqual(await stateOf(repo), before);
  });

  it("discardImportBackup drops the backup", async () => {
    const { store } = await filledStore();
    const { store: other } = await filledStore();
    await importReplacing(store, await (await buildExport(other)).file.arrayBuffer());
    await discardImportBackup(store);
    assert.equal(canUndoImport(store), false);
    assert.equal(store.meta.preImport, null);
  });
});
