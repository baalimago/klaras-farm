import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, syncWorld, step, setMode, react, dropActor, sleepAll, isIdle, nextWakeMs, hitTargets, holdActor, placeActor, settleActor, takeSpreadMoves, isSettling, footPivot, scaleActor, settleResize, TICK, GROUND_TOP, GLIDE_S } from "./world.js";
import { MAX_SPEED, REACT_S, DROP_S, WIGGLE_S, SLEEP_SETTLE_S } from "../motion/blocks.js";
import { ASPECT } from "./hit.js";
import { footPoint, scaledThingPatch, movedThingPatch } from "../geometry/transform.js";

const preset = (id) => JSON.parse(readFileSync(new URL(`../../data/motions/${id}.json`, import.meta.url), "utf8"));
const presets = { walk: preset("walk"), float: preset("float"), hop: preset("hop") };

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
const thing = (id, cx, cy, { r = 0.08, preset = "walk", params = {}, eyes = 1, legs = preset === "walk" ? 2 : 0 } = {}) => ({
  id, outline: sq(cx, cy, r), eyes: Array.from({ length: eyes }, () => ({ x: cx, y: cy })),
  legs: Array.from({ length: legs }, (_, i) => ({ x: cx - r / 2 + i * 0.01, y: cy + r * 0.9 })), motion: { kind: "preset", preset, params },
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

test("syncWorld: the thing's legs decide the leg count, not its motion", () => {
  const rng = seeded(3);
  const pig = thing("pig", 0.3, 0.75);
  const w = createWorld([pig], { rng, presets });
  assert.equal(w.actors[0].pose.legs.length, 2);
  syncWorld(w, [{ ...pig, motion: { kind: "preset", preset: "float", params: {} } }], rng);
  assert.equal(w.actors[0].pose.legs.length, 2, "a floater keeps its (still) legs");
  syncWorld(w, [{ ...pig, legs: thing("x", 0.3, 0.75, { legs: 4 }).legs }], rng);
  assert.equal(w.actors[0].pose.legs.length, 4);
  syncWorld(w, [{ ...pig, legs: [] }], rng);
  assert.equal(w.actors[0].pose.legs.length, 0);
  syncWorld(w, [{ ...pig, legs: undefined }], rng);
  assert.equal(w.actors[0].pose.legs.length, 0, "no legs field: no legs");
});

test("legs swing only while walking", () => {
  const rng = seeded(5);
  const w = createWorld([thing("pig", 0.3, 0.75, { legs: 4 })], { rng, presets });
  const a = w.actors[0];
  assert.deepEqual(a.pose.legs, [0, 0, 0, 0]);
  let swung = false;
  for (let i = 0; i < 60 * 30 && !swung; i++) {
    step(w, 1 / 60, {}, rng);
    if (a.state === "moving" && a.pose.legs.some((v) => Math.abs(v) > 0.05)) swung = true;
    if (a.state === "idle" && a.move === 0) assert.deepEqual(a.pose.legs, [0, 0, 0, 0]);
  }
  assert.ok(swung, "legs swing during a walk");
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

// ---------- edit mode spreads overlapping things apart ----------

/** Do actors a and b overlap, by their outline extents where they now are? */
const actorsOverlap = (a, b) =>
  Math.min(a.x + a.ext.right, b.x + b.ext.right) - Math.max(a.x - a.ext.left, b.x - b.ext.left) > 1e-9 &&
  Math.min(a.y + a.ext.bottom, b.y + b.ext.bottom) - Math.max(a.y - a.ext.top, b.y - b.ext.top) > 1e-9;

test("entering edit mode glides overlapping things apart; things already apart stay put", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.7), thing("cow", 0.53, 0.7), thing("hen", 0.15, 0.2)], { rng, presets });
  const [pig, cow, hen] = w.actors;
  assert.ok(actorsOverlap(pig, cow));
  const start = { pig: [pig.x, pig.y], cow: [cow.x, cow.y], hen: [hen.x, hen.y] };
  setMode(w, "edit", rng);
  assert.ok(!isIdle(w), "the glide keeps the loop running");
  assert.deepEqual([cow.x, cow.y], start.cow, "it glides from where it was, no jump");
  run(w, GLIDE_S / 2, rng);
  assert.ok(cow.x > start.cow[0] && cow.x < cow.tx, "half way there");
  run(w, GLIDE_S, rng);
  assert.ok(!actorsOverlap(pig, cow), "pig and cow are apart");
  assert.deepEqual([pig.x, pig.y], start.pig, "the first one keeps its spot");
  assert.deepEqual([hen.x, hen.y], start.hen);
  assert.equal(cow.glideT, -1);
  assert.equal(cow.homeX, start.cow[0], "the world never edits a home itself: the farm is told (takeSpreadMoves)");
  run(w, WIGGLE_S, rng);
  assert.ok(isIdle(w), "then edit mode settles to 0 fps");
});

test("the gap includes room for the pencil and cross above each thing", () => {
  const rng = seeded();
  // the cow sits just below the pig, clear of its outline but on top of its badges
  const w = createWorld([thing("pig", 0.5, 0.4), thing("cow", 0.5, 0.4 + 0.16 + 0.005)], { rng, presets });
  setMode(w, "edit", rng);
  run(w, GLIDE_S, rng);
  const [pig, cow] = w.actors;
  const between = (cow.y - cow.ext.top) - (pig.y + pig.ext.bottom);
  assert.ok(between * ASPECT >= 0.03, `badge room ${between * ASPECT}`);
});

test("leaving edit mode mid-glide finishes it at once", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.7), thing("cow", 0.5, 0.7)], { rng, presets });
  setMode(w, "edit", rng);
  run(w, GLIDE_S / 3, rng);
  const cow = w.actors[1], to = [cow.tx, cow.ty];
  setMode(w, "play", rng);
  assert.deepEqual([cow.x, cow.y], to);
  assert.equal(cow.glideT, -1);
  assert.ok(!actorsOverlap(w.actors[0], cow), "play goes on from the spread positions");
});

test("picking a thing up mid-glide stops it under the finger", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.7), thing("cow", 0.5, 0.7)], { rng, presets });
  setMode(w, "edit", rng);
  run(w, GLIDE_S / 3, rng);
  const cow = holdActor(w, "cow");
  const at = [cow.x, cow.y];
  run(w, GLIDE_S, rng);
  assert.deepEqual([cow.x, cow.y], at);
  placeActor(w, "cow", 0.2, 0.3);
  run(w, GLIDE_S, rng);
  assert.deepEqual([cow.x, cow.y], [0.2, 0.3]);
});

test("putting a spread thing down saves where it is shown, spread included", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.7), thing("cow", 0.5, 0.7)], { rng, presets });
  setMode(w, "edit", rng);
  run(w, GLIDE_S, rng);
  const cow = w.actors[1], shown = [cow.x, cow.y];
  holdActor(w, "cow");
  const [dx, dy] = settleActor(w, "cow");
  assert.ok(Math.abs(0.5 + dx - shown[0]) < 1e-12 && Math.abs(0.7 + dy - shown[1]) < 1e-12);
});

test("a thing added while editing glides off the one it landed on; a store edit keeps the spread", () => {
  const rng = seeded();
  const pig = thing("pig", 0.5, 0.7);
  const w = createWorld([pig], { rng, presets, mode: "edit" });
  syncWorld(w, [pig, thing("cow", 0.52, 0.7)], rng);
  run(w, GLIDE_S, rng);
  assert.ok(!actorsOverlap(w.actors[0], w.actors[1]));
  const cowAt = [w.actors[1].x, w.actors[1].y];
  // an edit to the pig (a new outline object, same place) must not pull the cow back
  syncWorld(w, [{ ...pig, outline: pig.outline.map((p) => [...p]) }, thing("cow", 0.52, 0.7)], rng);
  run(w, GLIDE_S, rng);
  assert.deepEqual([w.actors[1].x, w.actors[1].y], cowAt);
});

test("a store change mid-glide finishes the glide, then keeps the offset", () => {
  const rng = seeded();
  const things = [thing("pig", 0.5, 0.7), thing("cow", 0.5, 0.7)];
  const w = createWorld(things, { rng, presets });
  setMode(w, "edit", rng);
  run(w, GLIDE_S / 3, rng);
  const to = [w.actors[1].tx, w.actors[1].ty];
  syncWorld(w, things, rng);
  assert.deepEqual([w.actors[1].x, w.actors[1].y], to);
  assert.equal(w.actors[1].glideT, -1);
});

test("play and scene modes never spread", () => {
  const rng = seeded();
  for (const mode of ["scene", "play"]) {
    const w = createWorld([thing("pig", 0.5, 0.7), thing("cow", 0.5, 0.7)], { rng, presets, mode: mode === "play" ? "edit" : "play" });
    run(w, 1, rng);
    takeSpreadMoves(w); // created in edit mode, it spread once already
    const at = w.actors.map((a) => [a.x, a.y]);
    setMode(w, mode, rng);
    assert.equal(isSettling(w), false, mode);
    assert.deepEqual(w.actors.map((a) => [a.x, a.y]), at, mode);
    assert.deepEqual(takeSpreadMoves(w), [], mode);
  }
});

test("takeSpreadMoves: each spread move once, home → target, and never for a thing picked up since", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.7), thing("cow", 0.5, 0.7), thing("hen", 0.52, 0.7)], { rng, presets });
  setMode(w, "edit", rng);
  holdActor(w, "hen");
  const cow = w.actors[1], home = [cow.homeX, cow.homeY], outline0 = cow.outline[0];
  const moves = takeSpreadMoves(w);
  assert.deepEqual(moves.map((m) => m.thingId), ["cow"]);
  assert.ok(Math.abs(home[0] + moves[0].dx - cow.tx) < 1e-12 && Math.abs(home[1] + moves[0].dy - cow.ty) < 1e-12);
  assert.deepEqual([cow.homeX, cow.homeY], [cow.tx, cow.ty], "the target is its home now");
  assert.ok(Math.abs(cow.outline[0][0] - (outline0[0] + moves[0].dx)) < 1e-12, "and its outline moved with it (taps)");
  assert.deepEqual(takeSpreadMoves(w), [], "only once");
});

test("when the farm catches up mid-glide (home = glide target), the glide carries on without a jump", () => {
  const rng = seeded();
  const pig = thing("pig", 0.5, 0.7), cow = thing("cow", 0.5, 0.7);
  const w = createWorld([pig, cow], { rng, presets });
  setMode(w, "edit", rng);
  const [{ dx, dy }] = takeSpreadMoves(w);
  run(w, GLIDE_S / 3, rng);
  const c = w.actors[1], at = [c.x, c.y];
  const saved = { ...cow, outline: cow.outline.map(([x, y]) => [x + dx, y + dy]) };
  syncWorld(w, [pig, saved], rng);
  assert.deepEqual([c.x, c.y], at);
  assert.ok(c.glideT > 0);
  run(w, GLIDE_S, rng);
  assert.ok(Math.abs(c.x - c.homeX) < 1e-9 && Math.abs(c.y - c.homeY) < 1e-9, "lands on its new home");
});

test("a thing made bigger while editing spreads again; a recolour (same outline) does not", () => {
  const rng = seeded();
  const pig = thing("pig", 0.3, 0.7), cow = thing("cow", 0.55, 0.7);
  const w = createWorld([pig, cow], { rng, presets, mode: "edit" });
  run(w, 1, rng);
  syncWorld(w, [{ ...pig, color: "red" }, cow], rng);
  assert.equal(isSettling(w), false);
  const big = thing("pig", 0.3, 0.7, { r: 0.16 });
  syncWorld(w, [big, cow], rng);
  assert.equal(isSettling(w), true, "the bigger pig now covers the cow");
  run(w, GLIDE_S, rng);
  assert.ok(!actorsOverlap(w.actors[0], w.actors[1]));
});

test("legs count below the outline, and dropping in keeps the world settling", () => {
  const rng = seeded();
  // the cow's outline clears the pig's, but the pig's legs hang into the cow's badge room
  const w = createWorld([thing("pig", 0.5, 0.4), thing("cow", 0.5, 0.4 + 0.16 + 0.07)], { rng, presets });
  setMode(w, "edit", rng);
  assert.equal(isSettling(w), true);
  const ww = createWorld([thing("pig", 0.5, 0.4, { legs: 0, preset: "float" }), thing("cow", 0.5, 0.4 + 0.16 + 0.07, { legs: 0, preset: "float" })], { rng, presets });
  setMode(ww, "edit", rng);
  assert.equal(isSettling(ww), false, "without legs there is room");
  dropActor(ww, "pig");
  assert.equal(isSettling(ww), true);
  run(ww, 2, rng);
  assert.equal(isSettling(ww), false);
});

test("a thing under the edit bar moves up out of it; one beside the bar stays", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.5, 0.9, { r: 0.06 }), thing("hen", 0.1, 0.9, { r: 0.05, legs: 0, preset: "float" })], { rng, presets });
  setMode(w, "edit", rng);
  run(w, GLIDE_S, rng);
  const [pig, hen] = w.actors;
  assert.ok(pig.y + pig.ext.bottom <= 0.9, `pig bottom ${pig.y + pig.ext.bottom}`);
  assert.ok(Math.abs(hen.x - 0.1) < 1e-9 && Math.abs(hen.y - 0.9) < 1e-9);
});

// ---------- edit mode resize (the selection ring's handle) ----------

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("resize preview: the held actor scales about its feet; the feet stay put", () => {
  const rng = seeded();
  const w = createWorld([thing("pig", 0.3, 0.6)], { rng, presets, mode: "edit" });
  run(w, 1, rng);
  const a = holdActor(w, "pig");
  assert.equal(a.scale, 1, "actors start at their own size");
  const [px, py] = footPivot(w, "pig");
  near(px, 0.3);
  near(py, 0.68);
  scaleActor(w, "pig", 1.5, a.x, a.y, px, py);
  near(a.scale, 1.5);
  near(a.x, 0.3);
  near(a.y, 0.68 - 0.08 * 1.5, 1e-12); // the anchor rises with the body
  near(a.y + a.ext.bottom * a.scale, 0.68); // drawn feet where they stood
  run(w, 0.5, rng);
  near(a.scale, 1.5); // steps leave the preview alone
  scaleActor(w, "pig", 0.5, 0.3, 0.6, px, py);
  near(a.y, 0.68 - 0.08 * 0.5);
  assert.equal(footPivot(w, "nobody"), null);
  assert.equal(scaleActor(w, "nobody", 2, 0, 0, 0, 0), null);
});

test("settleResize: the scaled actor is home, taps hit the new size, and the farm catching up ends the preview without a jump", () => {
  const rng = seeded();
  const pig = thing("pig", 0.3, 0.6), cow = thing("cow", 0.5, 0.6);
  const w = createWorld([pig, cow], { rng, presets, mode: "edit" });
  run(w, 1, rng);
  const a = holdActor(w, "pig");
  const [px, py] = footPivot(w, "pig");
  scaleActor(w, "pig", 2, a.x, a.y, px, py);
  const r = settleResize(w, "pig");
  near(r.s, 2);
  near(r.dx, 0);
  near(r.dy, 0);
  assert.deepEqual([a.homeX, a.homeY], [a.x, a.y]);
  const hit = hitTargets(w)[0];
  near(Math.min(...hit.poly.map((p) => p[0])), 0.3 - 0.16); // the outline is the new size
  near(Math.max(...hit.poly.map((p) => p[1])), 0.68);
  assert.equal(a.scale, 2, "still drawn scaled: the farm has the old outline");
  assert.equal(settleResize(w, "nobody"), null);
  // The farm gets the outline scaled about its feet (geometry/transform.js scaledThingPatch).
  const bigOutline = pig.outline.map(([x, y]) => [px + (x - px) * 2, py + (y - py) * 2]);
  const before = [a.x, a.y];
  syncWorld(w, [{ ...pig, outline: bigOutline }, cow], rng);
  assert.equal(a.scale, 1, "the preview ends: the new outline is drawn at its own size");
  near(a.x, before[0]);
  near(a.y, before[1]);
  assert.equal(isSettling(w), true, "the bigger pig now reaches the cow: they spread again");
  run(w, GLIDE_S, rng);
  assert.ok(!actorsOverlap(w.actors[0], w.actors[1]));
});

test("an unrelated farm change mid-resize keeps the preview", () => {
  const rng = seeded();
  const pig = thing("pig", 0.3, 0.6);
  const w = createWorld([pig], { rng, presets, mode: "edit" });
  const a = holdActor(w, "pig");
  scaleActor(w, "pig", 1.4, a.x, a.y, ...footPivot(w, "pig"));
  syncWorld(w, [{ ...pig, color: "red" }], rng); // same outline
  assert.equal(a.scale, 1.4);
});

// A lopsided thing (an L): its centroid, the actor's anchor, is far from its box's bottom centre.
const lopsided = (id, x, y) => ({
  id, outline: [[x, y], [x + 0.2, y], [x + 0.2, y + 0.05], [x + 0.05, y + 0.05], [x + 0.05, y + 0.2], [x, y + 0.2]],
  eyes: [{ x: x + 0.02, y: y + 0.02 }], legs: [{ x: x + 0.02, y: y + 0.19 }], motion: { kind: "preset", preset: "walk", params: {} },
});
/** Where an actor is drawn: its outline's box at `scale` about the anchor. */
const drawnBox = (a) => ({ l: a.x - a.ext.left * a.scale, r: a.x + a.ext.right * a.scale, t: a.y - a.ext.top * a.scale, b: a.y + a.ext.bottom * a.scale });
const sameBox = (p, q, eps = 1e-9) => { for (const k of ["l", "r", "t", "b"]) near(p[k], q[k], eps); };

test("resize of a lopsided thing: the preview keeps its feet at the outline's foot point, and the saved outline is drawn exactly there", () => {
  const rng = seeded();
  const pig = lopsided("pig", 0.3, 0.45);
  const w = createWorld([pig], { rng, presets, mode: "edit" });
  run(w, 1, rng);
  const a = holdActor(w, "pig");
  assert.ok(Math.abs(a.x - 0.4) > 0.02, "the anchor is off the box centre");
  const [px, py] = footPivot(w, "pig");
  const [fx, fy] = footPoint(pig.outline);
  near(px, fx);
  near(py, fy);
  scaleActor(w, "pig", 1.5, a.x, a.y, px, py);
  const shown = drawnBox(a);
  near((shown.l + shown.r) / 2, fx); // centred over its feet
  near(shown.b, fy); // feet where they stood
  near(shown.r - shown.l, 0.3);
  const r = settleResize(w, "pig");
  near(r.dx, 0);
  near(r.dy, 0);
  syncWorld(w, [{ ...pig, ...scaledThingPatch(pig, r.s) }], rng);
  assert.equal(a.scale, 1);
  sameBox(drawnBox(a), shown); // no jump when the farm has it
});

test("resize of a thing grabbed off its home (mid-glide): settleResize says how far to move it, and the saved thing lands where it was shown", () => {
  const rng = seeded();
  const cow = thing("cow", 0.32, 0.58), pig = lopsided("pig", 0.3, 0.45);
  const w = createWorld([cow, pig], { rng, presets, mode: "edit" });
  const a = w.actors[1];
  assert.ok(a.glideT >= 0, "the overlapping things glide apart");
  run(w, GLIDE_S / 2, rng);
  holdActor(w, "pig"); // stops where the finger found it, its home still where it was drawn
  const off = [a.x - a.homeX, a.y - a.homeY];
  assert.ok(Math.hypot(...off) > 0.005, `off its home by ${off}`);
  scaleActor(w, "pig", 1.3, a.x, a.y, ...footPivot(w, "pig"));
  const shown = drawnBox(a);
  const r = settleResize(w, "pig");
  near(r.s, 1.3);
  near(r.dx, off[0], 1e-12);
  near(r.dy, off[1], 1e-12);
  // The board's patch: scaled about the stored feet, then moved by (dx, dy).
  const patch = movedThingPatch({ ...pig, ...scaledThingPatch(pig, r.s) }, r.dx, r.dy);
  syncWorld(w, [cow, { ...pig, ...patch }], rng);
  assert.equal(a.scale, 1);
  sameBox(drawnBox(a), shown);
});

test("resizing a thing that is still gliding stops the glide: it stays where the resize put it", () => {
  const rng = seeded();
  const w = createWorld([thing("cow", 0.36, 0.62), thing("pig", 0.3, 0.6)], { rng, presets, mode: "edit" });
  const a = w.actors[1];
  run(w, TICK, rng);
  assert.ok(a.glideT >= 0, "gliding");
  scaleActor(w, "pig", 1.2, a.x, a.y, ...footPivot(w, "pig"));
  assert.equal(a.glideT, -1);
  const at = [a.x, a.y];
  run(w, GLIDE_S, rng);
  near(a.x, at[0]);
  near(a.y, at[1]);
});
