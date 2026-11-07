import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSnapshot, canonicalJson, canonicalSnapshot, emptySnapshot, clipKey, roundPoints, FORMAT_VERSION } from "./snapshot.js";
import { aSnapshot, aPlace, aThing, aClip, fixedEnv } from "../../../tests/builders.js";

const full = () => aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()).withClip(aClip({ kind: "prompt" })))).build();

test("a built snapshot and an empty one are valid", () => {
  assert.deepEqual(validateSnapshot(full()), { ok: true });
  assert.deepEqual(validateSnapshot(emptySnapshot(fixedEnv())), { ok: true });
});

test("rejects files from a newer app that this one cannot read", () => {
  const r = validateSnapshot({ ...full(), formatVersion: FORMAT_VERSION + 1, minReaderFormat: FORMAT_VERSION + 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /newer/);
});

test("accepts a newer file that is still readable (additive change)", () => {
  assert.equal(validateSnapshot({ ...full(), formatVersion: FORMAT_VERSION + 1, minReaderFormat: FORMAT_VERSION }).ok, true);
});

test("rejects duplicate clip keys, unknown references and bad colours", () => {
  const s = full();
  assert.equal(validateSnapshot({ ...s, clips: [s.clips[0], { ...s.clips[0], id: "other" }] }).ok, false);
  assert.equal(validateSnapshot({ ...s, clips: [{ ...s.clips[0], thingId: "nope" }] }).ok, false);
  assert.equal(validateSnapshot({ ...s, things: [{ ...s.things[0], color: "#ff0000" }] }).ok, false);
  assert.equal(validateSnapshot({ ...s, settings: { ...s.settings, currentPlaceId: "nope" } }).ok, false);
});

// ---------- format 5: more sky and ground colours, and any colour from the picker ----------

test("a place's sky and ground take a palette key or a lowercase #rrggbb; things and pieces do not", () => {
  const s = full();
  const withPlace = (over) => ({ ...s, places: [{ ...s.places[0], ...over }, ...s.places.slice(1)] });
  assert.equal(validateSnapshot(withPlace({ skyColor: "night", groundColor: "snow" })).ok, true);
  assert.equal(validateSnapshot(withPlace({ skyColor: "#12ab9f", groundColor: "#000000" })).ok, true);
  for (const bad of ["#12AB9F", "#fff", "12ab9f", "#12ab9g", "rgb(1,2,3)", "", null, 7])
    assert.equal(validateSnapshot(withPlace({ skyColor: bad })).ok, false, `sky ${bad}`);
  assert.equal(validateSnapshot(withPlace({ groundColor: "#ABCDEF" })).ok, false);
  const piece = { id: "pc", kind: "shape", stroke: [[0, 0], [1, 1]], color: "#ff0000" };
  assert.equal(validateSnapshot(withPlace({ pieces: [piece] })).ok, false, "a piece colour stays a key");
});

test("migrate 4 → 5 only moves the version: format 4 colours are valid as they are", async () => {
  const { migrate } = await import("./snapshot.js");
  const v4 = { ...full(), formatVersion: 4, minReaderFormat: 4 };
  const v5 = migrate(v4);
  assert.equal(v5.formatVersion, 5);
  assert.deepEqual({ ...v5, formatVersion: 4 }, v4);
  assert.equal(validateSnapshot(v5).ok, true);
});

test("checks every clip's blob when blob shas are given", () => {
  const s = full();
  assert.equal(validateSnapshot(s, { blobShas: new Set() }).ok, false);
  assert.equal(validateSnapshot(s, { blobShas: new Set(s.clips.map((c) => c.blobSha256)) }).ok, true);
});

test("rejects more than 12 things in a place (the hard ceiling; settings.maxThings only stops adding)", () => {
  let place = aPlace();
  for (let i = 0; i < 13; i++) place = place.withThing(aThing());
  assert.match(validateSnapshot(aSnapshot().withPlace(place).build()).error, /more than 12/);
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
  assert.equal(FORMAT_VERSION, 5);
  const s = aSnapshot().withPlace(aPlace()
    .withThing(aThing({ motion: { kind: "preset", preset: "walk", params: {} } }))
    .withThing(aThing({ motion: { kind: "preset", preset: "float", params: {} } }))
    .withThing(aThing({ motion: { kind: "preset", preset: "scuttle", params: {} } }))
    .withThing(aThing({ motion: { kind: "preset", preset: "walk", params: { "legs.count": 4 } } }))).build();
  const v2 = { ...s, formatVersion: 2, things: s.things.map(v2Thing) };
  assert.equal(validateSnapshot(v2).ok, false, "a format 2 thing without legs is not valid as is");
  const v3 = migrate(v2);
  assert.equal(v3.formatVersion, FORMAT_VERSION);
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
  assert.equal(v3.formatVersion, FORMAT_VERSION);
  assert.equal(v3.things[0].legs.length, 2);
  const mine = { ...s.things[0], legs: [{ x: 0.5, y: 0.6 }] };
  assert.equal(withLegacyLegs(mine), mine);
});

test("storedFormat: records without legs come from a format 2 build", async () => {
  const { storedFormat } = await import("./snapshot.js");
  assert.equal(storedFormat([]), FORMAT_VERSION);
  assert.equal(storedFormat(full().things), FORMAT_VERSION);
  assert.equal(storedFormat(full().things.map(v2Thing)), 2);
});

// ---------- format 4: things per scene, variable questions, colour game clips ----------

const v3Settings = (st) => { const { maxThings, ...rest } = st; return rest; };

test("storedFormat: stored settings without maxThings come from a format 3 build; no settings says nothing", async () => {
  const { storedFormat } = await import("./snapshot.js");
  const s = full();
  assert.equal(storedFormat(s.things, s.settings), FORMAT_VERSION);
  assert.equal(storedFormat(s.things, v3Settings(s.settings)), 3);
  assert.equal(storedFormat(s.things, null), FORMAT_VERSION);
  assert.equal(storedFormat(s.things.map(v2Thing), v3Settings(s.settings)), 2, "the oldest sign wins: every step runs");
});

test("migrate 3 → 4 adds maxThings 8 and keeps cue lines and takes; mixed data is safe", async () => {
  const { migrate, withMaxThings } = await import("./snapshot.js");
  const s = aSnapshot().withPlace(aPlace().withThing(aThing({ cues: { en: { lines: ["Where is our pig?", "", ""] } } }).withClip(aClip({ kind: "prompt", take: 3 })))).build();
  const v3 = { ...s, formatVersion: 3, minReaderFormat: 1, settings: v3Settings(s.settings) };
  assert.equal(validateSnapshot(v3).ok, false, "a format 3 settings record lacks maxThings");
  const v4 = migrate(v3);
  assert.equal(v4.formatVersion, FORMAT_VERSION);
  assert.equal(v4.settings.maxThings, 8);
  assert.deepEqual(v4.things[0].cues, s.things[0].cues);
  assert.equal(v4.clips[0].take, 3);
  assert.deepEqual(validateSnapshot(v4), { ok: true });
  assert.equal(v3.settings.maxThings, undefined, "migrate does not mutate its input");
  const kept = { ...s.settings, maxThings: 3 };
  assert.equal(withMaxThings(kept), kept);
  assert.equal(withMaxThings({ ...kept, maxThings: 40 }).maxThings, 8);
  assert.equal(withMaxThings(null), null);
});

test("validates settings.maxThings: a whole number from 1 to 12", () => {
  const s = full();
  for (const ok of [1, 8, 12]) assert.equal(validateSnapshot({ ...s, settings: { ...s.settings, maxThings: ok } }).ok, true, String(ok));
  for (const bad of [0, 13, 2.5, "8", undefined]) assert.match(validateSnapshot({ ...s, settings: { ...s.settings, maxThings: bad } }).error ?? "", /maxThings/, String(bad));
});

test("validates questions: up to 6 prompt takes and up to 6 free-text cue lines", () => {
  const s = full();
  const thing = s.things[0];
  const withCue = (cue) => ({ ...s, things: [{ ...thing, cues: { en: cue } }] });
  assert.equal(validateSnapshot(withCue({ lines: ["a", "b", "c", "d", "e", "f"] })).ok, true);
  assert.equal(validateSnapshot(withCue({ lines: ["a", null, ""], article: "der" })).ok, true, "null lines from old files mean the example");
  assert.equal(validateSnapshot(withCue({ lines: Array(7).fill("x") })).ok, false);
  assert.equal(validateSnapshot(withCue({ lines: [3] })).ok, false);
  assert.equal(validateSnapshot(withCue({ article: 3 })).ok, false);
  assert.equal(validateSnapshot({ ...s, things: [{ ...thing, cues: { en: null } }] }).ok, false);
  const prompt = (take) => ({ ...s, clips: [{ ...s.clips[1], take }] });
  assert.equal(validateSnapshot(prompt(6)).ok, true);
  assert.equal(validateSnapshot(prompt(7)).ok, false);
});

test("colour game clips: thingId null, a simple colour for words, keyed by language, kind, colour and take", async () => {
  const { isGameClip } = await import("./snapshot.js");
  const s = full();
  const word = (color, fields = {}) => aClip({ thingId: null, kind: "color-word", color, language: "en", ...fields }).build();
  const question = aClip({ thingId: null, kind: "color-question", language: "sv", take: 2 }).build();
  const ok = { ...s, clips: [...s.clips, word("yellow"), word("red"), word("yellow", { language: "sv" }), question] };
  assert.deepEqual(validateSnapshot(ok), { ok: true });
  assert.equal(isGameClip(question), true);
  assert.equal(isGameClip(s.clips[0]), false);
  assert.equal(clipKey(word("yellow")), "game|en|color-word|yellow|1");
  assert.equal(clipKey(question), "game|sv|color-question||2");
  const dup = { ...s, clips: [word("yellow"), word("yellow")] };
  assert.match(validateSnapshot(dup).error, /duplicate key/);
  assert.match(validateSnapshot({ ...s, clips: [word("sun")] }).error, /colour/, "felt keys are not simple colours");
  assert.match(validateSnapshot({ ...s, clips: [aClip({ thingId: null, kind: "name" }).build()] }).error, /kind/);
  assert.match(validateSnapshot({ ...s, clips: [{ ...s.clips[0], kind: "color-word", color: "red" }] }).error, /kind/, "a thing has no colour words");
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
