// Golden export (one-way door: the export container, ARCHITECTURE §9.2). basic.zip was written once
// by a format-1 build and must import, forever, to basic.expected.json. Never regenerate it: if a
// change breaks this test, the change broke old files on parents' devices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readImport } from "../../web/js/io/share.js";
import { canonicalJson, canonicalSnapshot } from "../../web/js/farm/snapshot.js";

const DIR = resolve(import.meta.dirname, "../fixtures/exports/v1");
const ZIP_SHA256 = "206f4bbba898e5e1731b3aa210c02fcc867ed8bd5411c42c3c4cfb45285be3ae";
const sha = (u8) => createHash("sha256").update(u8).digest("hex");

test("the v1 fixture file never changes", () => {
  assert.equal(sha(readFileSync(`${DIR}/basic.zip`)), ZIP_SHA256);
});

test("the v1 fixture imports to the expected canonical snapshot and blobs", async () => {
  const bytes = readFileSync(`${DIR}/basic.zip`);
  const expected = JSON.parse(readFileSync(`${DIR}/basic.expected.json`, "utf8"));
  const out = await readImport(new Uint8Array(bytes), { now: "2026-11-03T12:00:00.000Z" });
  assert.equal(canonicalJson(canonicalSnapshot(out.snapshot)), canonicalJson(expected.snapshot));
  const blobs = out.blobs.map(({ sha256, mime, size }) => ({ sha256, mime, size })).sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1));
  assert.deepEqual(blobs, expected.blobs);
  for (const b of out.blobs) assert.equal(sha(new Uint8Array(b.bytes)), b.sha256);
  assert.deepEqual(out.counts, { places: 2, things: 3, clips: 4 });
});

// Golden export of format 3, written once by the format 3 build (9caba36) with an edited cue line
// and a prompt in take 3. Never regenerate it. Format 4 adds settings.maxThings on import; format 5
// discards per-thing questions (cue lines and prompt recordings, whose blobs are left out).
const DIR3 = resolve(import.meta.dirname, "../fixtures/exports/v3");
const ZIP3_SHA256 = "4383deb0093f20172a893e07f1112167d1e8ceb52354632ee1a30510ea5ffab7";

test("the v3 fixture file never changes", () => {
  assert.equal(sha(readFileSync(`${DIR3}/basic.zip`)), ZIP3_SHA256);
});

test("the v3 fixture imports to format 6: maxThings 8, cue lines and prompt recordings discarded", async () => {
  const bytes = readFileSync(`${DIR3}/basic.zip`);
  const expected = JSON.parse(readFileSync(`${DIR3}/basic.expected.json`, "utf8"));
  const out = await readImport(new Uint8Array(bytes), { now: "2026-11-03T12:00:00.000Z" });
  assert.equal(canonicalJson(canonicalSnapshot(out.snapshot)), canonicalJson(expected.snapshot));
  assert.equal(out.snapshot.formatVersion, 6);
  assert.equal(out.snapshot.settings.maxThings, 8);
  assert.deepEqual(out.snapshot.things[0].cues, {});
  assert.deepEqual(out.snapshot.clips.map((c) => c.kind).sort(), ["name", "sound"]);
  assert.equal(out.blobs.length, 2, "the prompt recordings' blobs are not imported");
  assert.deepEqual(out.counts, { places: 1, things: 1, clips: 2 });
});

// Golden export of format 4, written once by the format 4 build (549d468): the v3 farm with a lilac
// sky and sand ground, exported again. Never regenerate it. Format 5 only adds colours; format 6 drops its per-thing questions.
const DIR4 = resolve(import.meta.dirname, "../fixtures/exports/v4");
const ZIP4_SHA256 = "1ea1de5b77f197f69113cb46b53ca6984c143850f879e9b0ae9c4d77f39d7ccc";

test("the v4 fixture file never changes", () => {
  assert.equal(sha(readFileSync(`${DIR4}/basic.zip`)), ZIP4_SHA256);
});

test("the v4 fixture imports to format 6 with its sky and ground kept, its per-thing questions discarded", async () => {
  const bytes = readFileSync(`${DIR4}/basic.zip`);
  const expected = JSON.parse(readFileSync(`${DIR4}/basic.expected.json`, "utf8"));
  const out = await readImport(new Uint8Array(bytes), { now: "2026-11-03T12:00:00.000Z" });
  assert.equal(canonicalJson(canonicalSnapshot(out.snapshot)), canonicalJson(expected.snapshot));
  assert.equal(out.snapshot.formatVersion, 6);
  assert.deepEqual([out.snapshot.places[0].skyColor, out.snapshot.places[0].groundColor], ["lilac", "sand"]);
  assert.deepEqual(out.snapshot.clips.map((c) => c.kind).sort(), ["name", "sound"]);
  assert.deepEqual(out.counts, { places: 1, things: 1, clips: 2 });
});
