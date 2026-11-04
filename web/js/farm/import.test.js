import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkImport, countsOf, ImportError, blobPath, exportName, MANIFEST } from "./import.js";
import { canonicalJson } from "./snapshot.js";
import { aSnapshot, aPlace, aThing, aClip } from "../../../tests/builders.js";

const NOW = "2026-11-03T12:00:00.000Z";

function farm() {
  return aSnapshot()
    .withPlace(aPlace().withThing(aThing().withClip(aClip()).withClip(aClip({ kind: "sound" }))))
    .withPlace(aPlace({ name: "Sea" }).withThing(aThing({ names: { en: "Fish" } })))
    .build();
}

/** The input io/share.js hands over: manifest text and, per blob entry, the recomputed hash. */
function input(s, { blobs } = {}) {
  const shas = blobs ?? [...new Set(s.clips.map((c) => c.blobSha256))];
  return { manifestText: JSON.stringify(s), blobs: shas.map((sha) => ({ path: blobPath(sha), sha256: sha, size: 3 })) };
}

function rejects(fn, code, pattern) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof ImportError, `expected ImportError, got ${e}`);
    assert.equal(e.code, code);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
}

describe("checkImport", () => {
  it("accepts a valid farm and returns the snapshot, blob records and counts", () => {
    const s = farm();
    const out = checkImport(input(s), { createdAt: NOW });
    assert.equal(canonicalJson(out.snapshot), canonicalJson(s));
    assert.deepEqual(out.counts, { places: 2, things: 2, clips: 2 });
    assert.deepEqual(
      out.blobs.map((b) => b.sha256).sort(),
      s.clips.map((c) => c.blobSha256).sort(),
    );
    assert.deepEqual(out.blobs[0], { sha256: out.blobs[0].sha256, mime: "audio/mp4", size: 3, createdAt: NOW });
  });

  it("ignores blob entries no clip references and unrelated files", () => {
    const s = farm();
    const extra = "e".repeat(64);
    const inp = input(s, { blobs: [...s.clips.map((c) => c.blobSha256), extra] });
    inp.blobs.push({ path: "__MACOSX/._manifest.json", sha256: "x", size: 1 });
    const out = checkImport(inp, { createdAt: NOW });
    assert.ok(!out.blobs.some((b) => b.sha256 === extra));
  });

  it("rejects a file without a manifest, with broken JSON or with someone else's JSON as not-a-farm", () => {
    rejects(() => checkImport({ manifestText: null, blobs: [] }, { createdAt: NOW }), "not-a-farm");
    rejects(() => checkImport({ manifestText: "{nope", blobs: [] }, { createdAt: NOW }), "not-a-farm");
    rejects(() => checkImport({ manifestText: '{"name":"package"}', blobs: [] }, { createdAt: NOW }), "not-a-farm");
    rejects(() => checkImport({ manifestText: "[1,2]", blobs: [] }, { createdAt: NOW }), "not-a-farm");
  });

  it("rejects a file whose minReaderFormat is newer than this app reads", () => {
    const s = { ...farm(), formatVersion: 7, minReaderFormat: 5 };
    rejects(() => checkImport(input(s), { createdAt: NOW }), "newer");
  });

  it("accepts a newer formatVersion that this app can still read, keeping unknown fields", () => {
    const s = { ...farm(), formatVersion: 5, minReaderFormat: 4, futureField: { x: 1 } };
    const out = checkImport(input(s), { createdAt: NOW });
    assert.deepEqual(out.snapshot.futureField, { x: 1 });
  });

  it("rejects a schema violation as corrupt", () => {
    const s = farm();
    s.places[0].backdrop = "volcano";
    rejects(() => checkImport(input(s), { createdAt: NOW }), "corrupt", /backdrop/);
    const t = farm();
    delete t.settings;
    rejects(() => checkImport(input(t), { createdAt: NOW }), "corrupt");
  });

  it("rejects a blob whose recomputed hash differs from its name", () => {
    const s = farm();
    const inp = input(s);
    inp.blobs[0].sha256 = "0".repeat(63) + "f";
    rejects(() => checkImport(inp, { createdAt: NOW }), "corrupt", /hash/);
  });

  it("rejects a blob entry with a malformed name", () => {
    const s = farm();
    const inp = input(s);
    inp.blobs.push({ path: "blobs/not-a-hash", sha256: "a".repeat(64), size: 1 });
    rejects(() => checkImport(inp, { createdAt: NOW }), "corrupt", /hash/);
  });

  it("rejects a clip whose blob is missing from the file", () => {
    const s = farm();
    rejects(() => checkImport(input(s, { blobs: [s.clips[0].blobSha256] }), { createdAt: NOW }), "corrupt", /blob missing/);
  });

  it("rejects duplicate clip keys", () => {
    const s = farm();
    s.clips.push({ ...s.clips[0], id: s.clips[0].id + "-dup", blobSha256: s.clips[1].blobSha256 });
    rejects(() => checkImport(input(s), { createdAt: NOW }), "corrupt", /duplicate key/);
  });

  it("is pure: does not modify its input", () => {
    const s = farm();
    const inp = input(s);
    const before = JSON.stringify(inp);
    checkImport(inp, { createdAt: NOW });
    assert.equal(JSON.stringify(inp), before);
  });
});

describe("import helpers", () => {
  it("countsOf counts places, things and clips", () => {
    assert.deepEqual(countsOf(farm()), { places: 2, things: 2, clips: 2 });
  });
  it("names files and entries", () => {
    assert.equal(MANIFEST, "manifest.json");
    assert.equal(blobPath("ab".repeat(32)), `blobs/${"ab".repeat(32)}`);
    assert.equal(exportName("2026-11-03T23:10:00.000Z"), "klaras-farm-2026-11-03.zip");
  });
  it("ImportError carries a parent-facing message per code", () => {
    for (const code of ["corrupt", "newer", "not-a-farm"]) {
      const e = new ImportError(code, "detail");
      assert.equal(e.name, "ImportError");
      assert.ok(e.parentMessage.length > 10);
    }
  });
});
