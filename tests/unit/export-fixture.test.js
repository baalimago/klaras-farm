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
