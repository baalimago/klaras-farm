import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { starterSnapshot, baseLanguage } from "./starter.js";
import { validateSnapshot, MAX_THINGS_PER_PLACE } from "../farm/snapshot.js";
import { pointInPolygon, bbox, signedArea } from "../geometry/stroke.js";
import { fixedEnv } from "../../../tests/builders.js";
import { starterJson, STARTER_PATH } from "../../../tools/make-starter.mjs";

const template = JSON.parse(readFileSync(STARTER_PATH, "utf8"));

test("starter.json is what tools/make-starter.mjs generates", () => {
  assert.equal(readFileSync(STARTER_PATH, "utf8"), starterJson());
});

test("the template itself is a valid snapshot", () => {
  assert.deepEqual(validateSnapshot(template), { ok: true });
});

test("starterSnapshot gives fresh ids and passes validateSnapshot", () => {
  const env = fixedEnv({ prefix: "s" });
  const s = starterSnapshot(template, env, "sv-SE", "v1");
  assert.deepEqual(validateSnapshot(s), { ok: true });
  const ids = [...s.places.map((p) => p.id), ...s.things.map((t) => t.id), ...s.places.flatMap((p) => p.pieces.map((x) => x.id))];
  assert.ok(ids.every((id) => id.startsWith("s-")));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(s.settings.languages, ["sv"]);
  assert.equal(s.settings.playLanguage, "sv");
  assert.equal(s.appVersion, "v1");
  assert.deepEqual(s.clips, []);
  const farm = s.places.find((p) => p.name === "Farm");
  assert.equal(s.settings.currentPlaceId, farm.id);
  for (const t of s.things) assert.ok(s.places.find((p) => p.id === t.placeId).thingOrder.includes(t.id));
  // two loads never share ids
  const s2 = starterSnapshot(template, fixedEnv({ prefix: "t" }));
  assert.ok(s2.things.every((t) => !ids.includes(t.id)));
});

test("Farm, Sea and Kitchen with the planned things", () => {
  const byPlace = Object.fromEntries(template.places.map((p) => [p.name, p.thingOrder.map((id) => template.things.find((t) => t.id === id).names.en)]));
  assert.deepEqual(byPlace, { Farm: ["Pig", "Cow", "Chicken"], Sea: ["Fish", "Octopus", "Crab"], Kitchen: ["Spoon", "Teapot", "Cat", "Chair"] });
  assert.deepEqual(template.places.map((p) => p.backdrop), ["meadow", "sea", "room"]);
  const motion = Object.fromEntries(template.things.map((t) => [t.names.en, t.motion.preset]));
  assert.equal(motion.Crab, "walk");
  assert.equal(motion.Fish, "float");
  assert.equal(motion.Octopus, "float");
  for (const p of template.places) assert.ok(p.thingOrder.length <= MAX_THINGS_PER_PLACE);
});

test("outlines are single closed polygons on the board with eyes inside", () => {
  for (const t of template.things) {
    const b = bbox(t.outline);
    assert.ok(b.x > 0 && b.y > 0 && b.x + b.w < 1 && b.y + b.h < 1, `${t.names.en} off the board`);
    assert.ok(b.w > 0.08 && b.w < 0.3, `${t.names.en} width ${b.w}`);
    assert.ok(signedArea(t.outline) > 0, `${t.names.en} winding`);
    assert.ok(t.eyes.length >= 1 && t.eyes.length <= 2);
    for (const e of t.eyes) assert.ok(pointInPolygon([e.x, e.y], t.outline), `${t.names.en} eye outside`);
    // no self-touching duplicates
    const keys = new Set(t.outline.map(([x, y]) => `${x},${y}`));
    assert.equal(keys.size, t.outline.length, `${t.names.en} repeats a point`);
  }
});

test("baseLanguage", () => {
  assert.equal(baseLanguage("en-GB"), "en");
  assert.equal(baseLanguage("de"), "de");
  assert.equal(baseLanguage(undefined), "en");
  assert.equal(baseLanguage("x"), "en");
});
