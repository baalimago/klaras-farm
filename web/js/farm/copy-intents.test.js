// The animal library's intents (QA round 3): copyThing, and createPlace seeding a new scene.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as I from "./intents.js";
import { validateSnapshot } from "./snapshot.js";
import { aSnapshot, aPlace, aThing, aClip, fixedEnv, square } from "../../../tests/builders.js";

const env = () => fixedEnv();
const valid = (s) => assert.deepEqual(validateSnapshot(s), { ok: true });

test("copyThing adds an independent copy of a thing to another scene, with its recordings over the same blobs", () => {
  const pig = aThing({ names: { en: "Pig", sv: "Gris" }, cues: { en: { lines: ["Find the pig"] } }, motion: { kind: "preset", preset: "hop", params: {} } })
    .withClip(aClip({ kind: "name" }))
    .withClip(aClip({ kind: "prompt", take: 1 }));
  const s = aSnapshot().withPlace(aPlace().withThing(pig)).withPlace(aPlace({ name: "Sea" })).build();
  const [farm, sea] = s.places;
  const source = s.things[0];
  const r = I.copyThing(s, { placeId: sea.id, thingId: source.id }, env());
  valid(r.snapshot);
  const copy = r.snapshot.things.find((t) => t.placeId === sea.id);
  assert.notEqual(copy.id, source.id);
  for (const key of ["names", "cues", "color", "motion"]) assert.deepEqual(copy[key], source[key], key);
  assert.equal(copy.eyes.length, source.eyes.length);
  assert.equal(copy.legs.length, source.legs.length);
  assert.deepEqual(r.snapshot.places.find((p) => p.id === sea.id).thingOrder, [copy.id]);
  assert.deepEqual(r.snapshot.places.find((p) => p.id === farm.id).thingOrder, [source.id], "the original stays");
  const copied = r.snapshot.clips.filter((c) => c.thingId === copy.id);
  assert.deepEqual(copied.map((c) => [c.kind, c.take, c.blobSha256]), s.clips.map((c) => [c.kind, c.take, c.blobSha256]));
  assert.ok(copied.every((c) => !s.clips.some((o) => o.id === c.id)), "new clip ids");
  assert.deepEqual(r.writes.map((w) => w.store), ["things", "places", "clips", "clips"], "no blob writes: blobs are shared by hash");
  assert.deepEqual(r.change, { kind: "thing-added", ids: [copy.id] });

  // Deleting the original leaves the copy whole: its clips keep pointing at the blobs.
  const d = I.deleteThing(r.snapshot, { thingId: source.id }, env());
  valid(d.snapshot);
  assert.equal(d.snapshot.clips.filter((c) => c.thingId === copy.id).length, 2);
});

test("copyThing never mutates its input", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build();
  const frozen = JSON.stringify(s);
  I.copyThing(s, { placeId: s.places[0].id, thingId: s.things[0].id }, env());
  assert.equal(JSON.stringify(s), frozen);
});

test("copyThing copies a pre-made example (no recordings) and places it apart from the things there", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing({ outline: square(0.5, 0.86, 0.06) }))).build();
  const example = aThing({ id: "example-fox", placeId: "library", names: { en: "Fox", fi: "Kettu" }, color: "orange", outline: square(0.5, 0.86, 0.06) }).build().thing;
  const r = I.copyThing(s, { placeId: s.places[0].id, thing: example }, env());
  valid(r.snapshot);
  const copy = r.snapshot.things.at(-1);
  assert.equal(copy.placeId, s.places[0].id);
  assert.notEqual(copy.id, example.id);
  assert.deepEqual(copy.names, { en: "Fox", fi: "Kettu" });
  assert.equal(r.snapshot.clips.length, 0);
  const [a, b] = r.snapshot.things.map((t) => t.outline.map(([x]) => x));
  assert.ok(Math.max(...b) <= Math.min(...a) || Math.min(...b) >= Math.max(...a), "side by side, not on top");
});

test("copyThing fills in what an example leaves out (names, cues, legs)", () => {
  const s = aSnapshot().withPlace(aPlace()).build();
  const { names, cues, legs, ...bare } = aThing({ id: "example-blob", placeId: "library" }).build().thing;
  const r = I.copyThing(s, { placeId: s.places[0].id, thing: bare }, env());
  valid(r.snapshot);
  const copy = r.snapshot.things[0];
  assert.deepEqual([copy.names, copy.cues, copy.legs], [{}, {}, []]);
});

test("copyThing refuses a full scene, a missing source and a broken example", () => {
  let s = aSnapshot().withPlace(aPlace().withThing(aThing())).build();
  s = { ...s, settings: { ...s.settings, maxThings: 1 } };
  const placeId = s.places[0].id;
  assert.throws(() => I.copyThing(s, { placeId, thingId: s.things[0].id }, env()), { code: "place-full" });
  s = { ...s, settings: { ...s.settings, maxThings: 8 } };
  assert.throws(() => I.copyThing(s, { placeId, thingId: "nope" }, env()), { code: "not-found" });
  assert.throws(() => I.copyThing(s, { placeId: "nope", thingId: s.things[0].id }, env()), { code: "not-found" });
  assert.throws(() => I.copyThing(s, { placeId }, env()), { code: "invalid" });
  const bad = aThing().build().thing;
  assert.throws(() => I.copyThing(s, { placeId, thing: { ...bad, color: "#ff0000" } }, env()), { code: "invalid" });
  assert.throws(() => I.copyThing(s, { placeId, thing: { ...bad, outline: [[0, 0]] } }, env()), { code: "invalid" });
  assert.throws(() => I.copyThing(s, { placeId, thing: { ...bad, legs: [{ x: "a" }] } }, env()), { code: "invalid" });
});

const examplesFor = (n) =>
  Array.from({ length: n }, (_, i) => aThing({ id: `example-${i}`, placeId: "library", names: { en: `Animal ${i}` }, outline: square(0.5, 0.8, 0.05 + i * 0.002) }).build().thing);

const boxOf = (t) => {
  const xs = t.outline.map(([x]) => x), ys = t.outline.map(([, y]) => y);
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
};

test("createPlace with seed adds 3 or 4 random things from the repertoire in one change, apart on the ground", () => {
  const own = aThing({ names: { en: "Our cow" }, color: "white" }).withClip(aClip({ kind: "name" }));
  const s = aSnapshot().withPlace(aPlace().withThing(own)).build();
  const counts = new Set();
  let cowSeen = false;
  for (let k = 1; k <= 16; k++) {
    const seed = Math.imul(k, 2654435761) >>> 0; // spread out: the test LCG's first draw barely moves for small seeds
    const r = I.createPlace(s, { name: "Garden", seed: { examples: examplesFor(6) } }, fixedEnv({ seed }));
    valid(r.snapshot);
    const place = r.snapshot.places.at(-1);
    const things = r.snapshot.things.filter((t) => t.placeId === place.id);
    counts.add(things.length);
    assert.ok(things.length >= 3 && things.length <= 4, `seed ${seed}: ${things.length}`);
    assert.deepEqual(place.thingOrder, things.map((t) => t.id));
    assert.equal(new Set(things.map((t) => t.names.en)).size, things.length, "no animal twice");
    assert.deepEqual(r.change, { kind: "place-created", ids: [place.id], things: place.thingOrder });
    assert.equal(r.snapshot.settings.currentPlaceId, place.id);
    assert.deepEqual(r.writes.filter((w) => w.store === "things").map((w) => w.value.id), place.thingOrder, "every seeded thing written in the same change");
    assert.equal(r.writes.at(-1).store, "settings");
    // The family's own cow comes with its recording when it is picked.
    const cow = things.find((t) => t.names.en === "Our cow");
    if (cow) {
      cowSeen = true;
      assert.equal(r.snapshot.clips.filter((c) => c.thingId === cow.id).length, 1);
      assert.ok(r.writes.some((w) => w.store === "clips" && w.value.thingId === cow.id));
    }
    // Apart, in the ground band.
    const boxes = things.map(boxOf);
    for (const [i, a] of boxes.entries()) {
      assert.ok(a.b >= 0.65 && a.b <= 0.921, `bottom ${a.b}`);
      for (const b of boxes.slice(i + 1)) assert.ok(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t, `seed ${seed}: overlap`);
    }
    // Deterministic for the injected rng.
    assert.deepEqual(I.createPlace(s, { name: "Garden", seed: { examples: examplesFor(6) } }, fixedEnv({ seed })).snapshot, r.snapshot);
  }
  assert.deepEqual([...counts].sort(), [3, 4], "both 3 and 4 happen");
  assert.ok(cowSeen, "the family's own things are in the repertoire");
});

test("createPlace seeding stays under the family's cap, and copes with a small or empty repertoire", () => {
  const base = aSnapshot().withPlace(aPlace()).build();
  const lastOrder = (r) => r.snapshot.places.at(-1).thingOrder;
  const capped = { ...base, settings: { ...base.settings, maxThings: 3 } };
  assert.equal(lastOrder(I.createPlace(capped, { seed: { examples: examplesFor(10) } }, fixedEnv({ seed: 3 }))).length, 2, "room left for one more");
  const one = { ...base, settings: { ...base.settings, maxThings: 1 } };
  assert.equal(lastOrder(I.createPlace(one, { seed: { examples: examplesFor(10) } }, env())).length, 0);
  assert.equal(lastOrder(I.createPlace(base, { seed: { examples: examplesFor(2) } }, env())).length, 2);
  const empty = I.createPlace(base, { seed: {} }, env());
  valid(empty.snapshot);
  assert.deepEqual(lastOrder(empty), []);
  assert.equal(lastOrder(I.createPlace(base, { seed: { examples: examplesFor(10), count: 2 } }, env())).length, 2, "an explicit count");
  assert.equal(lastOrder(I.createPlace(capped, { seed: { examples: examplesFor(10), count: 9 } }, env())).length, 2, "an explicit count is capped too");
  // Broken examples are skipped, never stored.
  const [ex] = examplesFor(1);
  const b = I.createPlace(base, { seed: { examples: [{ ...ex, color: "#123456" }, { ...ex, id: "x", outline: [] }, { ...ex, id: "y", legs: "no" }, null] } }, env());
  valid(b.snapshot);
  assert.deepEqual(lastOrder(b), []);
  // Without seed nothing changes from before.
  assert.deepEqual(I.createPlace(base, { name: "Plain" }, env()).writes.map((w) => w.store), ["places", "settings"]);
});

test("a seeded thing is an ordinary thing: delete and restore work", () => {
  const base = aSnapshot().withPlace(aPlace()).build();
  const r = I.createPlace(base, { seed: { examples: examplesFor(5), count: 3 } }, env());
  const id = r.snapshot.places.at(-1).thingOrder[1];
  const d = I.deleteThing(r.snapshot, { thingId: id }, env());
  assert.equal(d.snapshot.places.at(-1).thingOrder.length, 2);
  const back = I.restoreThing(d.snapshot, d.change.removed, env());
  valid(back.snapshot);
  assert.deepEqual(back.snapshot.places.at(-1).thingOrder, r.snapshot.places.at(-1).thingOrder);
});
