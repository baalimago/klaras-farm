import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, syncWorld, step, setMode, react, dropActor, sleepAll, isIdle, nextWakeMs, hitTargets, TICK, GROUND_TOP } from "./world.js";
import { MAX_SPEED, REACT_S, DROP_S, WIGGLE_S, SLEEP_SETTLE_S } from "../motion/blocks.js";
import { ASPECT } from "./hit.js";

const preset = (id) => JSON.parse(readFileSync(new URL(`../../data/motions/${id}.json`, import.meta.url), "utf8"));
const presets = { walk: preset("walk"), float: preset("float"), hop: preset("hop") };

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
const thing = (id, cx, cy, { r = 0.08, preset = "walk", params = {}, eyes = 1 } = {}) => ({
  id, outline: sq(cx, cy, r), eyes: Array.from({ length: eyes }, () => ({ x: cx, y: cy })), motion: { kind: "preset", preset, params },
});
const run = (w, seconds, rng, input = {}, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) step(w, 1 / fps, input, rng);
};

test("actors start at their outline centroids, at rest, idle, with valid poses", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.3, 0.7), thing("fish", 0.6, 0.4, { preset: "float" })], { rng, presets });
  assert.equal(w.actors.length, 2);
  const [pig, fish] = w.actors;
  assert.equal(pig.thingId, "pig");
  assert.ok(Math.abs(pig.x - 0.3) < 1e-12 && Math.abs(pig.y - 0.7) < 1e-12);
  assert.equal(pig.state, "idle");
  assert.equal(pig.facing, 1);
  assert.deepEqual(pig.pose, { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, legs: [0, 0], eyeOpen: 1 });
  assert.deepEqual(fish.pose.legs, []);
  assert.ok(isIdle(w));
});

test("unknown presets stand still instead of failing", () => {
  const rng = seeded();
  const w = createWorld([thing("x", 0.5, 0.7, { preset: "moonwalk" })], { rng, presets });
  run(w, 60, rng);
  assert.ok(Math.abs(w.actors[0].x - 0.5) < 1e-12);
});

test("things wander slowly: speed cap, inside the board, feet in the ground band, rests between walks", () => {
  const rng = seeded(3);
  const w = createWorld([thing("pig", 0.3, 0.75), thing("hen", 0.8, 0.8, { r: 0.05 }), thing("frog", 0.5, 0.7, { preset: "hop" })], { rng, presets });
  let walked = 0, rests = 0;
  const prev = w.actors.map((a) => [a.x, a.y]);
  const wasMoving = w.actors.map(() => false);
  for (let i = 0; i < 60 * 120; i++) {
    step(w, TICK, {}, rng);
    w.actors.forEach((a, k) => {
      const dx = a.x - prev[k][0], dy = (a.y - prev[k][1]) * ASPECT;
      assert.ok(Math.hypot(dx, dy) <= MAX_SPEED * TICK + 1e-12, "speed cap");
      walked += Math.abs(dx);
      prev[k][0] = a.x; prev[k][1] = a.y;
      const r = k === 1 ? 0.05 : 0.08;
      assert.ok(a.x - r >= 0 && a.x + r <= 1, "inside the board");
      assert.ok(a.y + r >= GROUND_TOP - 1e-9 && a.y + r <= 1, "feet in the ground band");
      if (wasMoving[k] && a.state === "idle") rests++;
      wasMoving[k] = a.state === "moving";
    });
  }
  assert.ok(walked > 0.3, `walked ${walked}`);
  assert.ok(rests >= 3, "rests between walks");
});

test("walkers face where they go and turn around at the edges", () => {
  const rng = seeded(11);
  const w = createWorld([thing("pig", 0.9, 0.75)], { rng, presets });
  const a = w.actors[0];
  while (a.state !== "moving") step(w, TICK, {}, rng);
  assert.equal(a.facing, -1, "first walk from the right edge goes left");
  const w2 = createWorld([thing("pig", 0.1, 0.75)], { rng, presets });
  while (w2.actors[0].state !== "moving") step(w2, TICK, {}, rng);
  assert.equal(w2.actors[0].facing, 1);
});

test("fixed timestep: 30 fps and 60 fps give the same world", () => {
  const things = [thing("pig", 0.3, 0.75), thing("fish", 0.6, 0.4, { preset: "float" })];
  const r1 = seeded(5), r2 = seeded(5);
  const a = createWorld(things, { rng: r1, presets }), b = createWorld(things, { rng: r2, presets });
  run(a, 20, r1, {}, 60);
  run(b, 20, r2, {}, 30);
  for (let k = 0; k < 2; k++) {
    assert.ok(Math.abs(a.actors[k].x - b.actors[k].x) < 1e-9);
    assert.ok(Math.abs(a.actors[k].t - b.actors[k].t) < 1e-9);
    assert.equal(a.actors[k].state, b.actors[k].state);
  }
});

test("everything pauses while a finger is down, then resumes", () => {
  const rng = seeded(3);
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  const a = w.actors[0];
  while (a.state !== "moving") step(w, TICK, {}, rng);
  run(w, 0.5, rng);
  run(w, 0.5, rng, { fingerDown: true }); // ramps out
  const x = a.x;
  run(w, 5, rng, { fingerDown: true });
  assert.equal(a.x, x, "no travel while the finger is down");
  assert.ok(isIdle(w), "nothing moves, so the board can stop drawing");
  run(w, 1, rng);
  assert.notEqual(a.x, x, "resumes");
});

test("a tapped thing stops and jumps, and is back to idle within 3 s", () => {
  const rng = seeded(3);
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  const a = w.actors[0];
  while (a.state !== "moving") step(w, TICK, {}, rng);
  run(w, 0.5, rng);
  assert.equal(react(w, "pig"), a);
  assert.equal(a.state, "react");
  assert.ok(!isIdle(w));
  const x = a.x;
  let minDy = 0;
  for (let i = 0; i < 60 * REACT_S - 1; i++) {
    step(w, TICK, {}, rng);
    assert.equal(a.x, x, "a reacting thing stops");
    minDy = Math.min(minDy, a.pose.dy);
  }
  assert.ok(minDy < -0.05, "it jumps");
  run(w, 3 - REACT_S, rng);
  assert.equal(a.state === "react", false);
  assert.equal(react(w, "nobody"), null);
});

test("dropActor: falls in from above, then idles", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  dropActor(w, "pig");
  step(w, TICK, {}, rng);
  assert.equal(w.actors[0].state, "drop");
  assert.ok(w.actors[0].pose.dy < -0.2);
  run(w, DROP_S, rng);
  assert.equal(w.actors[0].state, "idle");
  assert.equal(w.actors[0].pose.dy, 0);
});

test("edit mode: wiggle that settles, no wandering, no blinking; back to play resumes", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  setMode(w, "edit", rng);
  assert.equal(w.actors[0].state, "wiggle");
  step(w, 0.1, {}, rng);
  assert.ok(Math.abs(w.actors[0].pose.rot) > 0);
  run(w, WIGGLE_S, rng);
  assert.ok(isIdle(w));
  assert.equal(nextWakeMs(w), Infinity);
  run(w, 60, rng);
  assert.ok(Math.abs(w.actors[0].x - 0.5) < 1e-12);
  assert.equal(w.actors[0].pose.rot, 0);
  setMode(w, "play", rng);
  assert.equal(w.actors[0].state, "idle");
  assert.ok(nextWakeMs(w) <= 3000, "comes alive soon after edit");
});

test("scene mode: still and idle", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  setMode(w, "scene", rng);
  assert.ok(isIdle(w));
  assert.equal(nextWakeMs(w), Infinity);
  run(w, 30, rng);
  assert.ok(Math.abs(w.actors[0].x - 0.5) < 1e-12);
});

test("sleep: yawn, eyes close, then still and idle; nothing wanders", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  sleepAll(w);
  const a = w.actors[0];
  assert.equal(a.state, "sleep");
  run(w, 0.8, rng);
  assert.ok(a.pose.sy > 1, "yawns");
  run(w, SLEEP_SETTLE_S, rng);
  assert.equal(a.pose.eyeOpen, 0);
  assert.ok(isIdle(w));
  assert.equal(nextWakeMs(w), Infinity);
  run(w, 60, rng);
  assert.ok(Math.abs(a.x - 0.5) < 1e-12);
  assert.equal(react(w, "pig"), a, "a tap stirs it");
  assert.equal(a.state, "sleep");
  assert.ok(!isIdle(w));
  run(w, 3, rng);
  assert.ok(isIdle(w));
  assert.equal(a.pose.eyeOpen, 0);
});

test("idle board: nextWakeMs points at the next wander or blink; a big step skips straight to it", () => {
  const rng = seeded(9);
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  const a = w.actors[0];
  assert.ok(isIdle(w));
  const ms = nextWakeMs(w);
  assert.ok(ms >= 1000 && ms < 10000, `${ms}`);
  assert.equal(Math.min(a.rest, a.blinkIn) * 1000 <= ms, true);
  step(w, ms / 1000, {}, rng);
  assert.ok(!isIdle(w), "the wander or blink started");
  const xs = [];
  for (let i = 0; i < 40 * 60; i++) { step(w, TICK, {}, rng); if (isIdle(w)) break; xs.push(a.x); }
  assert.ok(isIdle(w), "a blink or a walk ends and the board idles again");
});

test("a whole idle hour in one step costs one skip, not 216000 ticks", () => {
  const rng = seeded(9);
  const w = createWorld([thing("pig", 0.5, 0.75, { eyes: 0 })], { rng, presets });
  setMode(w, "scene", rng);
  const t0 = process.hrtime.bigint();
  step(w, 3600, {}, rng);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 20);
});

test("things without eyes never wake the board to blink", () => {
  const rng = seeded(9);
  const w = createWorld([thing("rock", 0.5, 0.75, { eyes: 0 })], { rng, presets });
  const ms = nextWakeMs(w), rest = w.actors[0].rest * 1000;
  assert.ok(ms >= rest && ms <= rest + TICK * 1000 + 1, "the wander, rounded up to its tick");
});

test("blinks are at least 2 s apart (no flashing)", () => {
  const rng = seeded(2);
  const w = createWorld([thing("pig", 0.5, 0.75, { params: { "travel.speed": 0 } })], { rng, presets });
  let last = -Infinity, closed = false, t = 0;
  for (let i = 0; i < 60 * 60; i++) {
    step(w, TICK, {}, rng); t += TICK;
    const c = w.actors[0].pose.eyeOpen < 0.5;
    if (c && !closed) { assert.ok(t - last >= 2, "blink interval"); last = t; }
    closed = c;
  }
  assert.ok(last > 0, "it blinked");
});

test("steps reuse the actor and pose objects", () => {
  const rng = seeded(3);
  const w = createWorld([thing("pig", 0.5, 0.75)], { rng, presets });
  const arr = w.actors, a = arr[0], p = a.pose, legs = p.legs;
  run(w, 30, rng);
  assert.equal(w.actors, arr);
  assert.equal(arr[0], a);
  assert.equal(a.pose, p);
  assert.equal(p.legs, legs);
});

test("syncWorld keeps survivors where they are, drops new things in, removes the deleted", () => {
  const rng = seeded(3);
  const pig = thing("pig", 0.3, 0.75), cow = thing("cow", 0.7, 0.75);
  const w = createWorld([pig, cow], { rng, presets });
  w.actors[0].x = 0.35;
  const arr = w.actors, pigActor = w.actors[0];
  syncWorld(w, [pig, thing("hen", 0.5, 0.8)], rng, { drop: true });
  assert.equal(w.actors, arr);
  assert.deepEqual(w.actors.map((a) => a.thingId), ["pig", "hen"]);
  assert.equal(w.actors[0], pigActor);
  assert.equal(pigActor.x, 0.35);
  assert.equal(w.actors[1].state, "drop");
  // Redrawn outline: the thing keeps its offset from where it was drawn.
  syncWorld(w, [{ ...pig, outline: sq(0.2, 0.75, 0.08) }], rng);
  assert.ok(Math.abs(pigActor.x - 0.25) < 1e-12);
});

test("syncWorld picks up motion changes (walks → floats)", () => {
  const rng = seeded(3);
  const pig = thing("pig", 0.3, 0.75);
  const w = createWorld([pig], { rng, presets });
  syncWorld(w, [{ ...pig, motion: { kind: "preset", preset: "float", params: {} } }], rng);
  assert.equal(w.actors[0].pose.legs.length, 0);
});

test("hitTargets follow the actors (position and pose offset)", () => {
  const rng = seeded(3);
  const w = createWorld([thing("pig", 0.3, 0.75)], { rng, presets });
  w.actors[0].x = 0.5;
  const [t] = hitTargets(w);
  assert.equal(t.id, "pig");
  assert.equal(t.x, 0.5);
  assert.ok(Math.abs(t.poly[0][0] - 0.42) < 1e-12);
});

test("reduce motion halves the speed", () => {
  const r1 = seeded(3), r2 = seeded(3);
  const things = [thing("pig", 0.5, 0.75)];
  const a = createWorld(things, { rng: r1, presets }), b = createWorld(things, { rng: r2, presets, reduceMotion: true });
  while (a.actors[0].state !== "moving") { step(a, TICK, {}, r1); step(b, TICK, {}, r2); }
  run(a, 1, r1); run(b, 1, r2);
  assert.ok(Math.abs(b.actors[0].x - 0.5) < Math.abs(a.actors[0].x - 0.5));
});
