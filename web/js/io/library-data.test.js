// web/data/library.json: the animal library's pre-made examples (QA round 3, "more default").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { libraryJson, LIBRARY_PATH, LIBRARY_ONLY, buildStarter } from "../../../tools/make-starter.mjs";
import { pointInPolygon, bbox, signedArea } from "../geometry/stroke.js";
import { footY } from "../farm/legs.js";
import { isColorKey } from "../farm/palette.js";
import { thingKey, libraryEntries } from "../farm/library.js";
import { starterSnapshot } from "./starter.js";
import { fixedEnv } from "../../../tests/builders.js";

const library = JSON.parse(readFileSync(LIBRARY_PATH, "utf8"));
const examples = library.examples;
const byName = Object.fromEntries(examples.map((t) => [t.names.en, t]));

test("library.json is what tools/make-starter.mjs generates", () => {
  assert.equal(readFileSync(LIBRARY_PATH, "utf8"), libraryJson());
  assert.equal(library.version, 1);
});

test("every starter thing plus at least six more animals, each once, with unique ids", () => {
  assert.ok(LIBRARY_ONLY.length >= 6);
  const starter = buildStarter({ maxPerPlace: 8 }).things.map((t) => t.names.en);
  for (const name of starter) assert.ok(byName[name], `${name} in the library`);
  assert.equal(examples.length, starter.length + LIBRARY_ONLY.length);
  assert.equal(new Set(examples.map((t) => t.id)).size, examples.length);
  assert.equal(new Set(examples.map(thingKey)).size, examples.length, "no two look the same");
  for (const name of ["Fox", "Frog", "Bird", "Turtle", "Snail", "Elephant", "Hedgehog", "Whale", "Owl"]) assert.ok(byName[name], name);
});

test("examples have English, Swedish and Finnish names (and the starter's other languages)", () => {
  for (const t of examples) for (const lang of ["en", "sv", "fi", "de", "fr", "es"]) assert.ok(t.names[lang]?.trim(), `${t.names.en}: ${lang}`);
  assert.equal(byName.Fox.names.sv, "Räv");
  assert.equal(byName.Fox.names.fi, "Kettu");
});

// Real leg counts, as the starter's: frogs and turtles walk on 4, birds and owls on 2, no legs in water.
const LEGS = { Fox: 4, Frog: 4, Bird: 2, Turtle: 4, Snail: 0, Elephant: 4, Hedgehog: 4, Whale: 0, Owl: 2 };

test("examples are well formed: palette colour, shipped motion, outline on the board, eyes and hips inside", () => {
  const shipped = readdirSync(new URL("../../data/motions/", import.meta.url)).map((f) => f.replace(/\.json$/, ""));
  for (const t of examples) {
    const name = t.names.en;
    assert.ok(isColorKey(t.color), `${name} colour`);
    assert.ok(shipped.includes(t.motion.preset), `${name} motion`);
    assert.deepEqual(t.cues, {});
    const b = bbox(t.outline);
    assert.ok(b.x > 0 && b.x + b.w < 1 && b.y > 0 && b.y + b.h < 1, `${name} on the board`);
    assert.ok(b.w > 0.06 && b.w < 0.3, `${name} width ${b.w}`);
    assert.ok(signedArea(t.outline) > 0, `${name} winding`);
    assert.ok(t.eyes.length >= 1 && t.eyes.length <= 2, `${name} eyes`);
    for (const e of t.eyes) assert.ok(pointInPolygon([e.x, e.y], t.outline), `${name} eye inside`);
    for (const l of t.legs) {
      assert.ok(pointInPolygon([l.x, l.y], t.outline), `${name} hip inside`);
      assert.ok(footY(t.outline, l) < 1, `${name} foot on the board`);
    }
    if (name in LEGS) assert.equal(t.legs.length, LEGS[name], `${name} legs`);
  }
});

test("an untouched starter thing folds into its example in the library", () => {
  const s = starterSnapshot(buildStarter(), fixedEnv({ prefix: "s" }), "en", "v1");
  const { own, examples: listed } = libraryEntries(s, examples);
  assert.deepEqual(own, [], "the starter animals are listed once, as examples");
  assert.equal(listed.length, examples.length);
});

// The starter before QA round 3 (commit 78e7f77) had no Finnish names, and every iPad in use holds
// things like that. They must still be listed and seeded once, as their example.
const withoutFinnish = (template) => ({ ...template, things: template.things.map((t) => { const { fi, ...names } = t.names; return { ...t, names }; }) });

test("a starter thing from before Finnish names still folds into its example, and seeding never doubles it", async () => {
  const { createPlace } = await import("../farm/intents.js");
  const s = starterSnapshot(withoutFinnish(buildStarter()), fixedEnv({ prefix: "s" }), "en", "v1");
  assert.ok(s.things.every((t) => !t.names.fi && t.names.sv));
  assert.deepEqual(libraryEntries(s, examples).own, [], "each starter animal is listed once");
  for (let seed = 1; seed <= 40; seed++) {
    const env = fixedEnv({ seed, prefix: `n${seed}` });
    const r = createPlace(s, { name: "Seeded", seed: { examples } }, env);
    const placeId = r.snapshot.settings.currentPlaceId;
    const names = r.snapshot.things.filter((t) => t.placeId === placeId).map((t) => t.names.en);
    assert.equal(new Set(names).size, names.length, `seed ${seed}: ${names}`);
  }
});

test("a starter thing the family renamed is its own, whatever languages the example gained", () => {
  const s = starterSnapshot(withoutFinnish(buildStarter()), fixedEnv({ prefix: "s" }), "en", "v1");
  const pig = s.things.find((t) => t.names.en === "Pig");
  const renamed = { ...s, things: s.things.map((t) => (t === pig ? { ...t, names: { ...t.names, sv: "Nasse" } } : t)) };
  assert.deepEqual(libraryEntries(renamed, examples).own.map((e) => e.thing.names.sv), ["Nasse"]);
  const extra = { ...s, things: s.things.map((t) => (t === pig ? { ...t, names: { ...t.names, it: "Maiale" } } : t)) };
  assert.deepEqual(libraryEntries(extra, examples).own.map((e) => e.thing.names.it), ["Maiale"], "a name the example lacks");
});
