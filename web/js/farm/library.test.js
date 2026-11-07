import { test } from "node:test";
import assert from "node:assert/strict";
import { thingKey, libraryEntries, copyOf, pickSeeds, seedCount, SEED_MIN, SEED_MAX } from "./library.js";
import { aSnapshot, aPlace, aThing, aClip, fixedEnv, square } from "../../../tests/builders.js";

const moved = (thing, dx, dy) => ({
  ...thing,
  id: `${thing.id}-moved`,
  outline: thing.outline.map(([x, y]) => [Math.round((x + dx) * 1000) / 1000, Math.round((y + dy) * 1000) / 1000]),
  eyes: thing.eyes.map((e) => ({ x: Math.round((e.x + dx) * 1000) / 1000, y: Math.round((e.y + dy) * 1000) / 1000 })),
  legs: thing.legs.map((l) => ({ x: Math.round((l.x + dx) * 1000) / 1000, y: Math.round((l.y + dy) * 1000) / 1000 })),
});

test("thingKey ignores where a thing stands and its id, but not its look or words", () => {
  const { thing } = aThing({ outline: square(0.3, 0.6, 0.1), eyes: [{ x: 0.33, y: 0.57 }], legs: [{ x: 0.25, y: 0.69 }] }).build();
  assert.equal(thingKey(moved(thing, 0.137, -0.021)), thingKey(thing));
  assert.equal(thingKey({ ...thing, names: { sv: "Gris", en: "Pig" } }), thingKey({ ...thing, names: { en: "Pig", sv: "Gris" } }), "name order does not matter");
  for (const patch of [{ names: { en: "Hog" } }, { color: "blue" }, { motion: { kind: "preset", preset: "hop", params: {} } }, { cues: { en: { lines: ["Where?"] } } }, { eyes: [] }, { legs: [] }, { outline: square(0.3, 0.6, 0.12) }])
    assert.notEqual(thingKey({ ...thing, ...patch }), thingKey(thing), JSON.stringify(patch));
});

test("libraryEntries: own things across every scene in scene order, one per look, then the examples", () => {
  const pig = aThing({ names: { en: "Pig" } });
  const cow = aThing({ names: { en: "Cow" }, color: "white" });
  const s = aSnapshot().withPlace(aPlace().withThing(pig)).withPlace(aPlace({ name: "Sea" }).withThing(cow)).build();
  const fox = aThing({ id: "example-fox", names: { en: "Fox" }, color: "orange" }).build().thing;
  const { own, examples } = libraryEntries(s, [fox, { ...fox, id: "example-fox-2" }]);
  assert.deepEqual(own.map((e) => e.thing.names.en), ["Pig", "Cow"]);
  assert.ok(own.every((e) => !e.example));
  assert.deepEqual(examples.map((e) => e.thing.id), ["example-fox"], "a repeated example shows once");
  assert.ok(examples[0].example);
  assert.deepEqual(examples[0].clips, []);
  assert.deepEqual(libraryEntries(s).examples, [], "no examples loaded");
});

test("libraryEntries folds copies into one entry, the one with most recordings, in the first copy's place", () => {
  const plain = aThing({ names: { en: "Pig" } }).build().thing;
  const recorded = { ...moved(plain, 0.2, 0), id: "pig-2" };
  const cow = aThing({ names: { en: "Cow" }, color: "white" }).build().thing;
  const s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const things = [plain, cow, recorded].map((t) => ({ ...t, placeId }));
  const snap = {
    ...s,
    things,
    places: [{ ...s.places[0], thingOrder: things.map((t) => t.id) }],
    clips: [aClip({ thingId: "pig-2", kind: "name" }).build(), aClip({ thingId: "pig-2", kind: "sound" }).build()],
  };
  const { own } = libraryEntries(snap);
  assert.deepEqual(own.map((e) => [e.thing.id, e.clips.length]), [["pig-2", 2], [cow.id, 0]]);
});

test("libraryEntries hides an untouched copy of an example, but keeps one with recordings or changes", () => {
  const fox = aThing({ id: "example-fox", names: { en: "Fox" }, color: "orange" }).build().thing;
  const s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const copy = { ...moved(fox, 0.1, 0.05), id: "copy", placeId };
  const changed = { ...moved(fox, -0.1, 0), id: "renamed", placeId, names: { en: "Foxy" } };
  const voiced = { ...moved(fox, 0, -0.1), id: "voiced", placeId };
  const snap = { ...s, things: [copy, changed, voiced], places: [{ ...s.places[0], thingOrder: ["copy", "renamed", "voiced"] }], clips: [aClip({ thingId: "voiced" }).build()] };
  const { own, examples } = libraryEntries(snap, [fox]);
  assert.deepEqual(own.map((e) => e.thing.id), ["renamed", "voiced"]);
  assert.deepEqual(examples.map((e) => e.thing.id), ["example-fox"]);
});

test("libraryEntries folds an untouched thing that lacks some of the example's name languages, not one without names", () => {
  const fox = aThing({ id: "example-fox", names: { en: "Fox", sv: "Räv", fi: "Kettu" }, color: "orange" }).build().thing;
  const s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const older = { ...moved(fox, 0.1, 0), id: "older", placeId, names: { en: "Fox", sv: "Räv" } };
  const nameless = { ...moved(fox, -0.1, 0), id: "nameless", placeId, names: {} };
  const snap = { ...s, things: [older, nameless], places: [{ ...s.places[0], thingOrder: ["older", "nameless"] }] };
  assert.deepEqual(libraryEntries(snap, [fox]).own.map((e) => e.thing.id), ["nameless"]);
});

test("libraryEntries lists the first of two equal copies with as many recordings", () => {
  const pig = aThing({ names: { en: "Pig" } }).build().thing;
  const s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const things = [{ ...pig, placeId }, { ...moved(pig, 0.2, 0), id: "pig-2", placeId }];
  const snap = {
    ...s,
    things,
    places: [{ ...s.places[0], thingOrder: things.map((t) => t.id) }],
    clips: [aClip({ thingId: pig.id }).build(), aClip({ thingId: "pig-2" }).build()],
  };
  assert.deepEqual(libraryEntries(snap).own.map((e) => e.thing.id), [pig.id]);
});

test("libraryEntries skips ids in thingOrder that have no thing", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing())).build();
  const snap = { ...s, places: [{ ...s.places[0], thingOrder: ["ghost", ...s.places[0].thingOrder] }] };
  assert.equal(libraryEntries(snap).own.length, 1);
});

test("copyOf makes an independent copy with fresh ids and its own clip records over the same blobs", () => {
  const built = aThing({ cues: { de: { article: "das" } } }).withClip(aClip({ kind: "name" })).withClip(aClip({ kind: "sound" })).build();
  const other = aClip({ thingId: "someone-else" }).build();
  const env = fixedEnv({ prefix: "c" });
  const { thing, clips } = copyOf(built.thing, [...built.clips, other], { placeId: "p2", dx: 0.1, dy: -0.05 }, env);
  assert.equal(thing.id, "c-0001");
  assert.equal(thing.placeId, "p2");
  assert.deepEqual(thing.names, built.thing.names);
  assert.deepEqual(thing.cues, built.thing.cues);
  assert.notEqual(thing.cues, built.thing.cues, "deep copy: editing the copy never edits the original");
  assert.deepEqual(thing.motion, built.thing.motion);
  assert.equal(thing.color, built.thing.color);
  assert.deepEqual(thing.outline[0], [0.5, 0.45]);
  assert.deepEqual(thing.eyes, [{ x: 0.65, y: 0.5 }]);
  assert.deepEqual(thing.legs, [{ x: 0.55, y: 0.54 }, { x: 0.65, y: 0.54 }]);
  assert.equal(thingKey(thing), thingKey(built.thing));
  assert.equal(clips.length, 2, "only the thing's own clips");
  assert.deepEqual(clips.map((c) => c.thingId), [thing.id, thing.id]);
  assert.deepEqual(clips.map((c) => c.blobSha256), built.clips.map((c) => c.blobSha256));
  assert.ok(clips.every((c, i) => c.id !== built.clips[i].id && c.kind === built.clips[i].kind && c.take === built.clips[i].take));
  // a copied recording keeps its date, so "the newest sound plays" picks the same take in the copy
  assert.deepEqual(clips.map((c) => c.createdAt), built.clips.map((c) => c.createdAt));
});

test("copyOf keeps which of two old sounds plays", async () => {
  const { soundClip } = await import("./intents.js");
  const built = aThing()
    .withClip(aClip({ kind: "sound", language: "en", createdAt: "2026-11-01T12:00:00.000Z" }))
    .withClip(aClip({ kind: "sound", language: "sv", createdAt: "2026-11-02T12:00:00.000Z" })).build();
  const { thing, clips } = copyOf(built.thing, built.clips, { placeId: "p2" }, fixedEnv({ prefix: "c" }));
  const before = soundClip({ clips: built.clips }, built.thing.id);
  for (const list of [clips, [...clips].reverse()]) assert.equal(soundClip({ clips: list }, thing.id).blobSha256, before.blobSha256);
});

test("pickSeeds picks n distinct entries at random, deterministic for an rng", () => {
  const pool = ["a", "b", "c", "d", "e", "f"];
  const one = pickSeeds(pool, 4, fixedEnv({ seed: 7 }).rng);
  assert.equal(one.length, 4);
  assert.equal(new Set(one).size, 4);
  assert.deepEqual(pickSeeds(pool, 4, fixedEnv({ seed: 7 }).rng), one, "same rng, same pick");
  assert.notDeepEqual(pickSeeds(pool, 4, fixedEnv({ seed: 8 }).rng), one, "another rng, another pick");
  assert.deepEqual(pool, ["a", "b", "c", "d", "e", "f"], "the pool is not shuffled in place");
  assert.deepEqual(pickSeeds(pool, 9, () => 0.999).sort(), [...pool].sort(), "never more than the pool");
  assert.deepEqual(pickSeeds([], 3, Math.random), []);
  assert.deepEqual(pickSeeds(pool, 1, () => 0.999), ["f"], "rng near 1 stays in range");
});

test("seedCount: 3 or 4, leaving room for one more under the cap, never more than the pool", () => {
  assert.equal(seedCount(8, 20, () => 0), SEED_MIN);
  assert.equal(seedCount(8, 20, () => 0.999), SEED_MAX);
  assert.equal(seedCount(4, 20, () => 0.999), 3);
  assert.equal(seedCount(1, 20, () => 0.5), 0);
  assert.equal(seedCount(8, 2, () => 0.5), 2);
  assert.equal(seedCount(8, 0, () => 0.5), 0);
});
