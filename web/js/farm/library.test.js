import { test } from "node:test";
import assert from "node:assert/strict";
import { thingKey, libraryEntries, placeCopy, boxesIn, copyOf, pickSeeds, seedCount, SEED_MIN, SEED_MAX, GROUND_AT } from "./library.js";
import { aSnapshot, aPlace, aThing, aClip, fixedEnv, square } from "../../../tests/builders.js";
import { bbox } from "../geometry/stroke.js";

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

test("libraryEntries skips ids in thingOrder that have no thing", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing())).build();
  const snap = { ...s, places: [{ ...s.places[0], thingOrder: ["ghost", ...s.places[0].thingOrder] }] };
  assert.equal(libraryEntries(snap).own.length, 1);
});

const box = (outline) => {
  const b = bbox(outline);
  return { left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h };
};
const shift = (outline, { dx, dy }) => outline.map(([x, y]) => [x + dx, y + dy]);
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("placeCopy stands a copy on the ground in the middle of an empty scene, rounded to 3 decimals", () => {
  const outline = square(0.2, 0.3, 0.05);
  const at = placeCopy(outline, [], { backdrop: "meadow" });
  const b = box(shift(outline, at));
  assert.ok(Math.abs((b.left + b.right) / 2 - 0.5) < 0.002, "centred");
  assert.ok(Math.abs(b.bottom - 0.92) < 0.002, "on the low row");
  assert.equal(at.dx, Math.round(at.dx * 1000) / 1000);
  assert.equal(at.dy, Math.round(at.dy * 1000) / 1000);
});

test("placeCopy finds a free spot beside the things already there, inside the board", () => {
  const outline = square(0.5, 0.5, 0.06);
  const others = [];
  for (let i = 0; i < 6; i++) {
    const b = box(shift(outline, placeCopy(outline, others, { backdrop: "meadow" })));
    assert.ok(b.left >= 0 && b.right <= 1 && b.bottom <= 0.921, JSON.stringify(b));
    for (const o of others) assert.ok(!overlaps(b, o), `copy ${i} overlaps`);
    others.push(b);
  }
});

test("placeCopy keeps a copy below the ground line of each backdrop, and a very wide thing in the middle", () => {
  const outline = square(0.5, 0.2, 0.04);
  for (const [backdrop, ground] of Object.entries(GROUND_AT)) {
    const b = box(shift(outline, placeCopy(outline, [box(square(0.5, 0.88, 0.04))], { backdrop })));
    assert.ok(b.bottom >= ground + 0.05, `${backdrop} ${b.bottom}`);
  }
  const wide = [[0, 0.4], [0.98, 0.4], [0.98, 0.5], [0, 0.5]];
  const b = box(shift(wide, placeCopy(wide, [], {})));
  assert.ok(Math.abs((b.left + b.right) / 2 - 0.5) < 0.002);
});

test("boxesIn lists the boxes of one place's things", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing({ outline: square(0.3, 0.6, 0.1) }))).withPlace(aPlace().withThing(aThing())).build();
  const boxes = boxesIn(s, s.places[0].id);
  assert.equal(boxes.length, 1);
  assert.ok(Math.abs(boxes[0].left - 0.2) < 1e-9 && Math.abs(boxes[0].bottom - 0.7) < 1e-9);
});

test("copyOf makes an independent copy with fresh ids and its own clip records over the same blobs", () => {
  const built = aThing({ cues: { en: { lines: ["Where is my pig?"] } } }).withClip(aClip({ kind: "name" })).withClip(aClip({ kind: "prompt" })).build();
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
