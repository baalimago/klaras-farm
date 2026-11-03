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
  const r = validateSnapshot({ ...full(), formatVersion: 5, minReaderFormat: 4 });
  assert.equal(r.ok, false);
  assert.match(r.error, /newer/);
});

test("accepts a newer file that is still readable (additive change)", () => {
  assert.equal(validateSnapshot({ ...full(), formatVersion: 4, minReaderFormat: 1 }).ok, true);
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

test("migrate steps format 1 up to 2 (Place.findIt is optional; absent shows the find buttons)", async () => {
  const { migrate, FORMAT_VERSION } = await import("./snapshot.js");
  const v1 = { ...full(), formatVersion: 1 };
  const v2 = migrate(v1);
  assert.equal(v2.formatVersion, FORMAT_VERSION);
  assert.equal(v2.places[0].findIt, undefined);
  assert.equal(validateSnapshot(v2).ok, true);
  assert.equal(validateSnapshot({ ...v2, places: [{ ...v2.places[0], findIt: "yes" }] }).ok, false);
});

// ---------- format 3: legs ----------

const v2Thing = (t) => { const { legs, ...rest } = t; return rest; };

test("migrate 2 → 3 gives walkers the two legs the renderer drew, floaters none", async () => {
  const { migrate, FORMAT_VERSION } = await import("./snapshot.js");
  assert.equal(FORMAT_VERSION, 3);
  const s = aSnapshot().withPlace(aPlace()
    .withThing(aThing({ motion: { kind: "preset", preset: "walk", params: {} } }))
    .withThing(aThing({ motion: { kind: "preset", preset: "float", params: {} } }))
    .withThing(aThing({ motion: { kind: "preset", preset: "scuttle", params: {} } }))
    .withThing(aThing({ motion: { kind: "preset", preset: "walk", params: { "legs.count": 4 } } }))).build();
  const v2 = { ...s, formatVersion: 2, things: s.things.map(v2Thing) };
  assert.equal(validateSnapshot(v2).ok, false, "a format 2 thing without legs is not valid as is");
  const v3 = migrate(v2);
  assert.equal(v3.formatVersion, 3);
  assert.deepEqual(validateSnapshot(v3), { ok: true });
  const [walk, float, scuttle, four] = v3.things;
  // square() outline: x 0.4…0.6, bottom 0.7; hips at 22 % and 78 % of the width, 3/600 above the bottom
  assert.deepEqual(walk.legs, [{ x: 0.444, y: 0.695 }, { x: 0.556, y: 0.695 }]);
  assert.deepEqual(float.legs, []);
  assert.equal(scuttle.legs.length, 6);
  assert.equal(four.legs.length, 4);
  for (const l of scuttle.legs) assert.ok(l.x > 0.4 && l.x < 0.6 && l.y < 0.7);
  assert.equal(v2.things[0].legs, undefined, "migrate does not mutate its input");
});

test("migrate 1 → 3 runs both steps; things that already have legs keep them", async () => {
  const { migrate, withLegacyLegs } = await import("./snapshot.js");
  const s = full();
  const v1 = { ...s, formatVersion: 1, things: s.things.map(v2Thing) };
  const v3 = migrate(v1);
  assert.equal(v3.formatVersion, 3);
  assert.equal(v3.things[0].legs.length, 2);
  const mine = { ...s.things[0], legs: [{ x: 0.5, y: 0.6 }] };
  assert.equal(withLegacyLegs(mine), mine);
});

test("storedFormat: records without legs come from a format 2 build", async () => {
  const { storedFormat } = await import("./snapshot.js");
  assert.equal(storedFormat([]), 3);
  assert.equal(storedFormat(full().things), 3);
  assert.equal(storedFormat(full().things.map(v2Thing)), 2);
});

test("validates legs: an array of up to 8 points", () => {
  const s = full();
  const withLegs = (legs) => ({ ...s, things: [{ ...s.things[0], legs }] });
  assert.equal(validateSnapshot(withLegs([])).ok, true);
  assert.equal(validateSnapshot(withLegs(Array.from({ length: 8 }, (_, i) => ({ x: 0.4 + i * 0.02, y: 0.65 })))).ok, true);
  for (const bad of [undefined, null, {}, [{ x: 0.5 }], [{ x: "a", y: 1 }], [[0.5, 0.6]], Array.from({ length: 9 }, () => ({ x: 0.5, y: 0.6 }))]) {
    const r = validateSnapshot(withLegs(bad));
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /legs/);
  }
});
