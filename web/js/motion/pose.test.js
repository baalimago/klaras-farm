import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolveMotion, pose, newPose, restPose, STILL, isGrounded, PRESET_IDS } from "./pose.js";
import { MAX_SPEED, travelSpeed } from "./blocks.js";

const preset = (id) => JSON.parse(readFileSync(new URL(`../../data/motions/${id}.json`, import.meta.url), "utf8"));
const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0;

test("resolveMotion applies dotted overrides without touching the preset", () => {
  const walk = preset("walk");
  const before = JSON.stringify(walk);
  const r = resolveMotion(walk, { "travel.speed": 0.3, "bob.amp": 0.01, "wave.amp": 0.2 });
  assert.equal(r.travel.speed, 0.3);
  assert.equal(r.travel.mode, "ground");
  assert.equal(r.bob.amp, 0.01);
  assert.equal(r.wave.amp, 0.2, "a block the preset lacks can be added");
  assert.equal(JSON.stringify(walk), before);
});

test("resolveMotion ignores non-numbers, bad keys and prototype keys", () => {
  const r = resolveMotion(preset("walk"), { "travel.mode": "hop", "bob": 3, "a.b.c": 1, "__proto__.x": 1, "bob.__proto__": 1, "bob.amp": NaN });
  assert.equal(r.travel.mode, "ground");
  assert.equal(r.bob.amp, preset("walk").bob.amp);
  assert.equal({}.x, undefined);
});

test("resolveMotion of a missing preset is the still preset", () => {
  assert.equal(resolveMotion(undefined, {}).id, STILL.id);
  const out = newPose();
  pose(resolveMotion(undefined), 1.3, { move: 1, blinkT: -1 }, out);
  assert.deepEqual(out, { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, legs: [], eyeOpen: 1 });
});

test("pose writes into the same object and the same legs array", () => {
  const r = resolveMotion(preset("walk"));
  const out = newPose(2);
  const legs = out.legs;
  for (let t = 0; t < 3; t += 0.1) assert.equal(pose(r, t, { move: 1, blinkT: -1 }, out), out);
  assert.equal(out.legs, legs);
  assert.equal(legs.length, 2);
});

test("move = 0 is the rest pose; move scales the motion", () => {
  const r = resolveMotion(preset("walk"));
  const out = newPose(2);
  pose(r, 0.25, { move: 0, blinkT: -1 }, out);
  assert.deepEqual(out, restPose(newPose(2), 2));
  const full = pose(r, 0.25, { move: 1, blinkT: -1 }, newPose(2));
  pose(r, 0.25, { move: 0.5, blinkT: -1 }, out);
  assert.ok(Math.abs(out.dy - full.dy / 2) < 1e-12);
  assert.ok(Math.abs(out.legs[0] - full.legs[0] / 2) < 1e-12);
});

test("the thing decides the leg count: pose fills whatever legs array it is given", () => {
  const walk = resolveMotion(preset("walk"));
  for (const n of [0, 1, 3, 4, 8]) {
    const out = newPose(n);
    pose(walk, 0, { move: 1, blinkT: -1 }, out);
    assert.equal(out.legs.length, n);
    for (let i = 0; i < n; i++) assert.equal(r4(out.legs[i]), i % 2 ? -0.45 : 0.45, "neighbours swing opposite");
  }
  // a floater's legs hang still
  const out = newPose(4);
  pose(resolveMotion(preset("float")), 0.3, { move: 1, blinkT: -1 }, out);
  assert.deepEqual(out.legs.map(r4), [0, 0, 0, 0]);
  for (const id of ["walk", "float", "hop", "swim", "scuttle"]) assert.equal(preset(id).legs.count, undefined, `${id}: presets no longer carry a leg count`);
});

test("isGrounded: walkers (walk, hop, scuttle) keep their feet on the ground; floaters do not", () => {
  for (const id of ["walk", "hop", "scuttle"]) assert.equal(isGrounded(preset(id)), true, id);
  for (const id of ["float", "swim"]) assert.equal(isGrounded(preset(id)), false, id);
  // the flag wins; without it the travel mode decides
  assert.equal(isGrounded({ ground: false, travel: { mode: "ground" } }), false);
  assert.equal(isGrounded({ travel: { mode: "hop" } }), true);
  assert.equal(isGrounded({ travel: { mode: "ground" } }), true);
  assert.equal(isGrounded({ travel: { mode: "water" } }), false);
  assert.equal(isGrounded(undefined), false);
  assert.equal(isGrounded(STILL), false);
});

test("PRESET_IDS lists every preset file, so main.js loads them all", () => {
  const files = readdirSync(new URL("../../data/motions/", import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  assert.deepEqual([...PRESET_IDS].sort(), files.sort());
});

test("blink drives eyeOpen in any state", () => {
  const r = resolveMotion(preset("float"));
  const out = newPose();
  pose(r, 0, { move: 0, blinkT: r.blink.duration / 2 }, out);
  assert.equal(out.eyeOpen, 0);
});

test("every shipped preset is under the speed cap and has rest timings", () => {
  for (const id of ["walk", "float", "hop", "swim", "scuttle"]) {
    const p = preset(id);
    assert.equal(p.id, id);
    assert.ok(travelSpeed(p.travel) <= MAX_SPEED);
    assert.ok(p.travel.restMin > 0 && p.travel.restMax >= p.travel.restMin, id);
    assert.ok(p.travel.distMin > 0 && p.travel.distMax >= p.travel.distMin, id);
    assert.ok(p.blink.intervalMin >= 2, `${id}: blinks no faster than every 2 s`);
  }
});

// Golden pose tables: [t, dy, rot, sx, sy, legs, eyeOpen] at move = 1. A tweak to a preset or a
// block shows up here as a reviewed diff. dx is always 0 (travel moves the actor, not the pose).
const GOLDEN = {
  walk: [
    [0, 0, 0, 1.06, 0.94, [0.45, -0.45], 1],
    [0.1, -0.0029, 0.0096, 1.0321, 0.9679, [0.3943, -0.3943], 1],
    [0.25, -0.0057, 0.019, 0.9515, 1.0485, [0.1391, -0.1391], 1],
    [0.3125, -0.006, 0.02, 0.94, 1.06, [0, 0], 1],
    [0.5, -0.0035, 0.0118, 1.0185, 0.9815, [-0.3641, 0.3641], 1],
    [0.75, -0.0035, -0.0118, 1.0185, 0.9815, [-0.3641, 0.3641], 1],
    [1, -0.0057, -0.019, 0.9515, 1.0485, [0.1391, -0.1391], 1],
    [1.5, -0.0057, 0.019, 0.9515, 1.0485, [0.1391, -0.1391], 1],
  ],
  float: [
    [0, 0, 0, 1.03, 0.97, [], 1],
    [0.1, 0.0025, 0.0247, 1.0285, 0.9715, [], 1],
    [0.25, 0.0057, 0.0566, 1.0212, 0.9788, [], 1],
    [0.3125, 0.0067, 0.0665, 1.0167, 0.9833, [], 1],
    [0.5, 0.008, 0.08, 1, 1, [], 1],
    [0.75, 0.0057, 0.0566, 0.9788, 1.0212, [], 1],
    [1, 0, 0, 0.97, 1.03, [], 1],
    [1.5, -0.008, -0.08, 1, 1, [], 1],
  ],
  hop: [
    [0, 0, 0, 1.08, 0.92, [0, 0], 1],
    [0.1, -0.0136, 0, 1.047, 0.953, [0.1816, 0.1816], 1],
    [0.25, -0.0277, 0, 0.9434, 1.0566, [0.3696, 0.3696], 1],
    [0.3125, -0.0299, 0, 0.9215, 1.0785, [0.3981, 0.3981], 1],
    [0.5, -0.0212, 0, 1, 1, [0.2828, 0.2828], 1],
    [0.75, -0.0115, 0, 1.0566, 0.9434, [0.1531, 0.1531], 1],
    [1, -0.03, 0, 0.92, 1.08, [0.4, 0.4], 1],
    [1.5, -0.0212, 0, 1, 1, [0.2828, 0.2828], 1],
  ],
  swim: [
    [0, 0, 0, 1.02, 0.98, [], 1],
    [0.1, 0.0026, 0.047, 1.0127, 0.9873, [], 1],
    [0.25, 0.0053, 0.08, 0.9882, 1.0118, [], 1],
    [0.3125, 0.0059, 0.0739, 0.9815, 1.0185, [], 1],
    [0.5, 0.0049, 0, 0.9938, 1.0062, [], 1],
    [0.75, -0.0009, -0.08, 1.019, 0.981, [], 1],
    [1, -0.0057, 0, 0.9838, 1.0162, [], 1],
    [1.5, 0.0019, 0, 1.0162, 0.9838, [], 1],
  ],
  scuttle: [
    [0, 0, 0, 1.02, 0.98, [0.35, -0.35, 0.35, -0.35, 0.35, -0.35], 1],
    [0.1, -0.0024, 0, 0.9938, 1.0062, [0.2057, -0.2057, 0.2057, -0.2057, 0.2057, -0.2057], 1],
    [0.25, -0.0021, 0, 1, 1, [-0.2475, 0.2475, -0.2475, 0.2475, -0.2475, 0.2475], 1],
    [0.3125, -0.0006, 0, 1.0185, 0.9815, [-0.3433, 0.3433, -0.3433, 0.3433, -0.3433, 0.3433], 1],
    [0.5, -0.003, 0, 0.98, 1.02, [0, 0, 0, 0, 0, 0], 1],
    [0.75, -0.0021, 0, 1, 1, [0.2475, -0.2475, 0.2475, -0.2475, 0.2475, -0.2475], 1],
    [1, 0, 0, 1.02, 0.98, [-0.35, 0.35, -0.35, 0.35, -0.35, 0.35], 1],
    [1.5, -0.003, 0, 0.98, 1.02, [0, 0, 0, 0, 0, 0], 1],
  ],
};

for (const [id, rows] of Object.entries(GOLDEN)) {
  test(`golden pose table: ${id}`, () => {
    const r = resolveMotion(preset(id));
    const out = newPose(rows[0][5].length);
    for (const [t, dy, rot, sx, sy, legs, eyeOpen] of rows) {
      pose(r, t, { move: 1, blinkT: -1 }, out);
      assert.deepEqual([t, r4(out.dx), r4(out.dy), r4(out.rot), r4(out.sx), r4(out.sy), out.legs.map(r4), out.eyeOpen], [t, 0, dy, rot, sx, sy, legs, eyeOpen], `${id} at t=${t}`);
    }
  });
}

test("walk: a slower, bouncier pig is two numbers", () => {
  const r = resolveMotion(preset("walk"), { "travel.speed": 0.3, "bob.amp": 0.012 });
  const out = newPose();
  pose(r, 0.3125, { move: 1, blinkT: -1 }, out);
  assert.equal(r4(out.dy), -0.012);
  assert.ok(travelSpeed(r.travel) < travelSpeed(preset("walk").travel));
});
