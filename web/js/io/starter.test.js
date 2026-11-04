import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { starterSnapshot, baseLanguage } from "./starter.js";
import { validateSnapshot, DEFAULT_MAX_THINGS } from "../farm/snapshot.js";
import { pointInPolygon, bbox, signedArea } from "../geometry/stroke.js";
import { fixedEnv } from "../../../tests/builders.js";
import { starterJson, STARTER_PATH, STARTER_MAX, buildStarter } from "../../../tools/make-starter.mjs";
import { readdirSync } from "node:fs";
import { footY } from "../farm/legs.js";
import { centroid } from "../play/hit.js";

const template = JSON.parse(readFileSync(STARTER_PATH, "utf8"));

test("starter.json is what tools/make-starter.mjs generates", () => {
  assert.equal(readFileSync(STARTER_PATH, "utf8"), starterJson());
});

test("the template itself is a valid snapshot", () => {
  assert.deepEqual(validateSnapshot(template), { ok: true });
  // the full eight-thing scenes are valid too
  assert.deepEqual(validateSnapshot(full), { ok: true });
});

test("starterSnapshot gives fresh ids and passes validateSnapshot", () => {
  const env = fixedEnv({ prefix: "s" });
  const s = starterSnapshot(template, env, "sv-SE", "v1");
  assert.deepEqual(validateSnapshot(s), { ok: true });
  const ids = [...s.places.map((p) => p.id), ...s.things.map((t) => t.id), ...s.places.flatMap((p) => p.pieces.map((x) => x.id))];
  assert.ok(ids.every((id) => id.startsWith("s-")));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(s.settings.languages, ["sv"]);
  assert.equal(s.settings.playLanguage, "alternate", "Mix languages by default");
  assert.equal(s.appVersion, "v1");
  assert.deepEqual(s.clips, []);
  const farm = s.places.find((p) => p.name === "Farm");
  assert.equal(s.settings.currentPlaceId, farm.id);
  for (const t of s.things) assert.ok(s.places.find((p) => p.id === t.placeId).thingOrder.includes(t.id));
  // two loads never share ids
  const s2 = starterSnapshot(template, fixedEnv({ prefix: "t" }));
  assert.ok(s2.things.every((t) => !ids.includes(t.id)));
});

// The scenes as designed: eight animals on the Farm (meeting 2), best spread first.
const DESIGNED = {
  Farm: ["Pig", "Cow", "Chicken", "Sheep", "Horse", "Duck", "Dog", "Bunny"],
  Sea: ["Fish", "Octopus", "Crab"],
  Kitchen: ["Teapot", "Cat", "Chair", "Spoon", "Mouse", "Spider"],
};
// Meeting 2: "All example animals need a correct number of legs."
const LEGS = { Pig: 4, Cow: 4, Chicken: 2, Sheep: 4, Horse: 4, Duck: 2, Dog: 4, Bunny: 4, Fish: 0, Octopus: 0, Crab: 8, Spoon: 0, Teapot: 0, Cat: 4, Chair: 4, Mouse: 4, Spider: 8 };
const full = buildStarter({ maxPerPlace: 8 });
const namesIn = (s) => Object.fromEntries(s.places.map((p) => [p.name, p.thingOrder.map((id) => s.things.find((t) => t.id === id).names.en)]));

test("Farm, Sea and Kitchen with the planned things, as many as a place may hold", () => {
  assert.equal(STARTER_MAX, Math.min(8, DEFAULT_MAX_THINGS - 1), "room left for the first own thing");
  const expected = Object.fromEntries(Object.entries(DESIGNED).map(([k, v]) => [k, v.slice(0, STARTER_MAX)]));
  assert.deepEqual(namesIn(template), expected);
  assert.deepEqual(namesIn(full), DESIGNED, "with room for eight, every designed thing is there");
  assert.deepEqual(template.places.map((p) => p.backdrop), ["meadow", "sea", "room"]);
  const motion = Object.fromEntries(full.things.map((t) => [t.names.en, t.motion.preset]));
  assert.equal(motion.Crab, "scuttle");
  assert.equal(motion.Spider, "scuttle");
  assert.equal(motion.Bunny, "hop");
  assert.equal(motion.Pig, "walk");
  assert.equal(motion.Fish, "float");
  assert.equal(motion.Octopus, "float");
  const shipped = readdirSync(new URL("../../data/motions/", import.meta.url)).map((f) => f.replace(/\.json$/, ""));
  for (const t of full.things) assert.ok(shipped.includes(t.motion.preset), `${t.names.en}: ${t.motion.preset} ships`);
  for (const p of template.places) assert.ok(p.thingOrder.length <= DEFAULT_MAX_THINGS);
});

test("every starter thing has its real number of legs, hips inside the body near the bottom", () => {
  for (const t of full.things) {
    const name = t.names.en;
    assert.equal(t.legs.length, LEGS[name], `${name} legs`);
    const b = bbox(t.outline);
    const xs = t.legs.map((l) => l.x);
    for (const l of t.legs) {
      assert.ok(pointInPolygon([l.x, l.y], t.outline), `${name} hip outside`);
      assert.ok(l.y > b.y + b.h * 0.5, `${name} hip in the lower half`);
      assert.ok(footY(t.outline, l) < 1, `${name} foot on the board`);
    }
    // spread out: no two hips on top of each other
    xs.sort((a, c) => a - c);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] > 0.004, `${name} hips too close`);
  }
});

test("the full scenes: things apart (120 px tap targets), sizes vary, walkers in the ground band", () => {
  for (const p of full.places) {
    const things = full.things.filter((t) => t.placeId === p.id);
    const boxes = things.map((t) => bbox(t.outline));
    for (let i = 0; i < things.length; i++) {
      for (let j = i + 1; j < things.length; j++) {
        const a = boxes[i], c = boxes[j];
        const overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
        assert.ok(!overlap, `${p.name}: ${things[i].names.en} overlaps ${things[j].names.en}`);
        // tap targets are at least 120 CSS px across (60 px radius on a ~1180 px board, 4:3)
        const [ax, ay] = centroid(things[i].outline), [cx, cy] = centroid(things[j].outline);
        assert.ok(Math.hypot(ax - cx, (ay - cy) * 0.75) > 120 / 1180, `${p.name}: ${things[i].names.en} too close to ${things[j].names.en}`);
      }
    }
    for (const t of things) {
      if (!t.legs.length) continue;
      for (const l of t.legs) assert.ok(footY(t.outline, l) > 0.55, `${t.names.en}: feet in the ground band`);
    }
  }
  const farm = full.things.filter((t) => t.placeId === "place-farm").map((t) => bbox(t.outline).w * bbox(t.outline).h);
  assert.ok(Math.max(...farm) / Math.min(...farm) > 3, "some animals smaller, some bigger");
});

test("outlines are single closed polygons on the board with eyes inside", () => {
  for (const t of [...template.things, ...full.things]) {
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
