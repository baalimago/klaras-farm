import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSnapshot, canonicalJson, canonicalSnapshot, emptySnapshot, clipKey, roundPoints } from "./snapshot.js";
import { aSnapshot, aPlace, aThing, aClip, fixedEnv } from "../../../tests/builders.js";

const full = () => aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()).withClip(aClip({ kind: "prompt" })))).build();

test("a built snapshot and an empty one are valid", () => {
  assert.deepEqual(validateSnapshot(full()), { ok: true });
  assert.deepEqual(validateSnapshot(emptySnapshot(fixedEnv())), { ok: true });
});

test("rejects files from a newer app that this one cannot read", () => {
  const r = validateSnapshot({ ...full(), formatVersion: 4, minReaderFormat: 3 });
  assert.equal(r.ok, false);
  assert.match(r.error, /newer/);
});

test("accepts a newer file that is still readable (additive change)", () => {
  assert.equal(validateSnapshot({ ...full(), formatVersion: 3, minReaderFormat: 1 }).ok, true);
});

test("rejects duplicate clip keys, unknown references and bad colours", () => {
  const s = full();
  assert.equal(validateSnapshot({ ...s, clips: [s.clips[0], { ...s.clips[0], id: "other" }] }).ok, false);
  assert.equal(validateSnapshot({ ...s, clips: [{ ...s.clips[0], thingId: "nope" }] }).ok, false);
  assert.equal(validateSnapshot({ ...s, things: [{ ...s.things[0], color: "#ff0000" }] }).ok, false);
  assert.equal(validateSnapshot({ ...s, settings: { ...s.settings, currentPlaceId: "nope" } }).ok, false);
});

test("checks every clip's blob when blob shas are given", () => {
  const s = full();
  assert.equal(validateSnapshot(s, { blobShas: new Set() }).ok, false);
  assert.equal(validateSnapshot(s, { blobShas: new Set(s.clips.map((c) => c.blobSha256)) }).ok, true);
});

test("rejects more than 4 things in a place", () => {
  let place = aPlace();
  for (let i = 0; i < 5; i++) place = place.withThing(aThing());
  assert.match(validateSnapshot(aSnapshot().withPlace(place).build()).error, /more than 4/);
});

test("never throws on garbage", () => {
  for (const g of [null, 1, "x", [], {}, { formatVersion: 1 }]) assert.equal(validateSnapshot(g).ok, false);
});

test("canonical JSON ignores key and entity order", () => {
  const s = full();
  const shuffled = { ...s, clips: [...s.clips].reverse(), settings: Object.fromEntries(Object.entries(s.settings).reverse()) };
  assert.equal(canonicalJson(canonicalSnapshot(s)), canonicalJson(canonicalSnapshot(shuffled)));
});

test("clip key and point rounding", () => {
  assert.equal(clipKey({ thingId: "t", language: "sv", kind: "prompt", take: 2 }), "t|sv|prompt|2");
  assert.deepEqual(roundPoints([[0.12345, 0.98765]]), [[0.123, 0.988]]);
});

test("migrate steps format 1 up to 2 (Find it is optional and off when absent)", async () => {
  const { migrate, FORMAT_VERSION } = await import("./snapshot.js");
  const v1 = { ...full(), formatVersion: 1 };
  const v2 = migrate(v1);
  assert.equal(v2.formatVersion, FORMAT_VERSION);
  assert.equal(v2.places[0].findIt, undefined);
  assert.equal(validateSnapshot(v2).ok, true);
  assert.equal(validateSnapshot({ ...v2, places: [{ ...v2.places[0], findIt: "yes" }] }).ok, false);
});
