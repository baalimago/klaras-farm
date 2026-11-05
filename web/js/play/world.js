// The play world (pure): actors for the things of the current place, wandering, blinking,
// reacting, dropping in, wiggling in edit mode and sleeping. Fixed 1/60 s timestep with an
// accumulator, so it runs the same at 30, 60 or 120 fps. The world is mutated in place and the
// step allocates nothing. Time and randomness come in as arguments.
//
// Actor fields beyond the shared Actor type (types.js) are internal to play/:
//   homeX, homeY   outline centroid where the thing was drawn
//   ext            outline extents from the centroid {left, right, top, bottom}
//   outline, eyes  from the thing; motion = resolved preset; nLegs = thing.legs.length
//   move           0..1, ramps the motion in and out (no pops)
//   tx, ty         walk target; rest: seconds until the next walk
//   blinkIn        seconds until the next blink; blinkT: seconds into a blink (< 0 none)
//   stir           seconds left of a sleepy stir (tap while asleep)
//   glideT         seconds into an edit-mode spread glide (< 0 none), from (gx, gy) to (tx, ty)
//   spreadPending  the spread moved this actor and the farm has not been told yet (takeSpreadMoves)
//   scale          (shared with the renderer) 1, or the live size of a thing being resized in edit
//                  mode (scaleActor) until the farm has its new outline
import { resolveMotion, pose, newPose, restPose } from "../motion/pose.js";
import { travelSpeed, REACT_S, DROP_S, WIGGLE_S, SLEEP_SETTLE_S, jump, jumpStretch, jumpSpin, drop, dropStretch, wiggle, yawn } from "../motion/blocks.js";
import { centroid, extents, ASPECT } from "./hit.js";
import { spreadBoxes, EDIT_SPREAD } from "./spread.js";
import { LEG_MAX } from "../farm/legs.js";

export const TICK = 1 / 60;
const MAX_LEGS = 8;
/** Top of the ground band: walkers keep their feet (outline bottom) below this line. */
export const GROUND_TOP = 0.55;
const MARGIN = 0.01;
const RAMP_S = 0.25;
const MAX_ACTIVE_TICKS = 15; // at most 0.25 s of simulated motion per step (a long hitch is dropped, not replayed)
const MAX_GAP_S = 86400;
const FIRST_REST = [1, 4];
const BACK_TO_PLAY_REST = [1, 3];
const STIR_S = 0.6;
const DROP_STAGGER_S = 0.12;
/** Edit mode spreads overlapping things apart in this long a glide (the badges are re-placed at 400 ms). */
export const GLIDE_S = 0.3;
// Room around each thing in edit mode: play/spread.js EDIT_SPREAD (badges, gap, the edit bar).
// Legs hang below the outline by up to farm/legs.js LEG_MAX of the board height.
const SPREAD = EDIT_SPREAD;

const lerp = (a, b, u) => a + (b - a) * u;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const sameExtents = (e, f) => !!e && near(e.left, f.left) && near(e.right, f.right) && near(e.top, f.top) && near(e.bottom, f.bottom);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * @param {import('../types.js').Thing[]} things  drawing order
 * @param {{rng: () => number, presets?: Object<string, Object>, mode?: 'play'|'edit'|'scene', reduceMotion?: boolean}} opts
 */
export function createWorld(things, { rng, presets = {}, mode = "play", reduceMotion = false }) {
  const world = { actors: [], mode, presets, finger: false, asleep: false, acc: 0, speedFactor: reduceMotion ? 0.5 : 1 };
  syncWorld(world, things, rng);
  return world;
}

/**
 * Rebuilds the actors for `things`, reusing the actors (and positions) of surviving things.
 * New things drop in when `drop` is set (place switched), staggered in drawing order.
 */
export function syncWorld(world, things, rng, { drop: dropNew = false } = {}) {
  const old = new Map(world.actors.map((a) => [a.thingId, a]));
  world.actors.length = 0;
  let n = 0, grew = false;
  for (const thing of things) {
    let a = old.get(thing.id);
    const [cx, cy] = centroid(thing.outline);
    if (a) {
      const reshaped = a.outline !== thing.outline;
      if (a.glideT >= 0 && near(cx, a.tx) && near(cy, a.ty)) {
        // The farm caught up with the spread (the thing's new home is where it glides to): glide on.
        fitThing(world, a, thing, cx, cy);
      } else {
        endGlide(a); // the store moved on: finish the spread first, then keep the offset
        const offX = a.x - a.homeX, offY = a.y - a.homeY;
        const before = a.ext;
        fitThing(world, a, thing, cx, cy);
        a.x = cx + offX;
        a.y = cy + offY;
        if (reshaped && !sameExtents(before, a.ext)) grew = true;
      }
      // A redrawn thing's walk target may no longer fit: rest, then pick a new one.
      if (reshaped && a.state === "moving") { a.state = "idle"; a.stateTime = 0; a.rest = lerp(FIRST_REST[0], FIRST_REST[1], rng()); }
    } else {
      a = newActor(world, thing, cx, cy, rng);
      if (dropNew) startDrop(a, n * DROP_STAGGER_S);
      n++;
    }
    writePose(a);
    world.actors.push(a);
  }
  // A thing added, resized or redrawn (or a place switched to) while editing must not land on another one.
  if ((n > 0 || grew) && world.mode === "edit") spreadActors(world);
}

function fitThing(world, a, thing, cx, cy) {
  if (a.outline !== thing.outline) a.scale = 1; // a resize preview ends when the farm has the new outline
  a.homeX = cx;
  a.homeY = cy;
  a.outline = thing.outline;
  a.ext = extents(thing.outline, cx, cy);
  a.eyes = (thing.eyes ?? []).length;
  const m = thing.motion ?? {};
  a.motion = resolveMotion(m.kind === undefined || m.kind === "preset" ? world.presets[m.preset] : undefined, m.params);
  a.nLegs = Array.isArray(thing.legs) ? Math.min(MAX_LEGS, thing.legs.length) : 0;
  if (a.pose.legs.length !== a.nLegs) restPose(a.pose, a.nLegs);
}

function newActor(world, thing, cx, cy, rng) {
  const a = {
    thingId: thing.id, x: cx, y: cy, scale: 1, facing: 1, t: 0, state: "idle", stateTime: 0, pose: newPose(0),
    homeX: cx, homeY: cy, ext: null, outline: null, eyes: 0, motion: null, nLegs: 0,
    move: 0, tx: cx, ty: cy, rest: 0, blinkIn: 0, blinkT: -1, stir: 0, glideT: -1, gx: cx, gy: cy, spreadPending: false,
  };
  fitThing(world, a, thing, cx, cy);
  a.rest = lerp(FIRST_REST[0], FIRST_REST[1], rng());
  a.blinkIn = blinkInterval(a, rng);
  settleForMode(world, a);
  return a;
}

/** A new or landed actor in the world's current mode, at rest. */
function settleForMode(world, a) {
  a.move = 0;
  a.blinkT = -1;
  if (world.asleep) { a.state = "sleep"; a.stateTime = SLEEP_SETTLE_S; }
  else if (world.mode === "edit") { a.state = "wiggle"; a.stateTime = WIGGLE_S; }
  else { a.state = "idle"; a.stateTime = 0; }
}

function blinkInterval(a, rng) {
  const b = a.motion.blink ?? {};
  return lerp(Math.max(2, num(b.intervalMin, 2.5)), Math.max(2, num(b.intervalMax, 6)), rng());
}

function restTime(a, rng) {
  const tr = a.motion.travel ?? {};
  return lerp(num(tr.restMin, 4), num(tr.restMax, 10), rng());
}

function startDrop(a, delay) {
  a.state = "drop";
  a.stateTime = -delay;
  a.move = 0;
  a.blinkT = -1;
}

// ---------- mode and events ----------

/** @param {'play'|'edit'|'scene'} mode */
export function setMode(world, mode, rng) {
  world.mode = mode;
  world.asleep = false;
  for (const a of world.actors) {
    endGlide(a);
    a.move = 0;
    a.blinkT = -1;
    a.stir = 0;
    if (a.state === "drop") continue;
    a.stateTime = 0;
    if (mode === "edit") a.state = "wiggle";
    else {
      a.state = "idle";
      a.rest = lerp(BACK_TO_PLAY_REST[0], BACK_TO_PLAY_REST[1], rng());
    }
    writePose(a);
  }
  if (mode === "edit") spreadActors(world);
}

/**
 * Edit mode: things that overlap glide apart (spread.js), so each one, and its pencil and cross,
 * can be reached. Each moved actor is marked spreadPending: the engine hands the moves to the
 * board (takeSpreadMoves), which saves them like drags, so the layout sticks.
 */
export function spreadActors(world) {
  const boxes = world.actors.map((a) => actorBox(a, a.x, a.y));
  const to = spreadBoxes(boxes, SPREAD);
  world.actors.forEach((a, i) => {
    const { x, y } = to[i];
    if (x === a.x && y === a.y) return;
    a.gx = a.x;
    a.gy = a.y;
    a.tx = x;
    a.ty = y;
    a.glideT = 0;
    a.spreadPending = true;
  });
}

/**
 * The room an actor takes at (x, y), as play/spread.js boxes it: its outline, legs below, and for
 * a walker a floor so a spread never lifts its feet out of the ground band.
 */
function actorBox(a, x, y) {
  const mode = a.motion?.travel?.mode;
  const walker = mode === "ground" || mode === "hop";
  return {
    x, y, left: a.ext.left, right: a.ext.right, top: a.ext.top,
    bottom: a.ext.bottom + (a.nLegs > 0 ? LEG_MAX : 0),
    ...(walker ? { floor: GROUND_TOP - a.ext.bottom } : {}),
  };
}

/**
 * Where the things of the world stand now, as spread boxes (play/placement.js places a new thing
 * clear of them): a gliding actor counts where it glides to.
 * @returns {import('./spread.js').SpreadBox[]}
 */
export function standingBoxes(world) {
  return world.actors.map((a) => (a.glideT >= 0 ? actorBox(a, a.tx, a.ty) : actorBox(a, a.x, a.y)));
}

/**
 * The spread moves the farm has not been told about yet, as drag results {thingId, dx, dy} from
 * each thing's home to where it glides, which becomes its home (as settleActor does for a drop);
 * clears the marks. A thing picked up since is left out:
 * its drop saves it.
 */
export function takeSpreadMoves(world) {
  const moves = [];
  for (const a of world.actors) {
    if (!a.spreadPending) continue;
    a.spreadPending = false;
    const x = a.glideT >= 0 ? a.tx : a.x, y = a.glideT >= 0 ? a.ty : a.y;
    const dx = x - a.homeX, dy = y - a.homeY;
    if (dx === 0 && dy === 0) continue;
    // Like settleActor: the target is home now, so the store catching up moves nothing.
    a.homeX = x;
    a.homeY = y;
    a.outline = a.outline.map(([px, py]) => [px + dx, py + dy]);
    moves.push({ thingId: a.thingId, dx, dy });
  }
  return moves;
}

/** True while things glide apart or drop in: their badges would land in the wrong place. */
export function isSettling(world) {
  for (const a of world.actors) if (a.glideT >= 0 || a.state === "drop") return true;
  return false;
}

/** Jumps a gliding actor to where it was going. */
function endGlide(a) {
  if (a.glideT < 0) return;
  a.x = a.tx;
  a.y = a.ty;
  a.glideT = -1;
}

/**
 * Edit mode: a parent picked a thing up. It stops wiggling and holds a still rest pose, so the
 * sprite is exactly where placeActor puts it (the drag tracks the finger 1:1). Returns the actor or null.
 */
export function holdActor(world, thingId) {
  const a = actorFor(world, thingId);
  if (!a) return null;
  a.glideT = -1; // stays exactly where the finger found it
  a.spreadPending = false; // its drop saves where it ends up
  a.state = "wiggle";
  a.stateTime = WIGGLE_S;
  a.move = 0;
  a.blinkT = -1;
  writePose(a);
  return a;
}

/** Puts a held actor's anchor at (x, y), board coordinates. No clamping: the drag follows the finger. */
export function placeActor(world, thingId, x, y) {
  const a = actorFor(world, thingId);
  if (!a) return null;
  a.glideT = -1;
  a.x = x;
  a.y = y;
  a.tx = x;
  a.ty = y;
  return a;
}

/**
 * The thing was put down where it is: that is its new home. Returns how far the home moved
 * [dx, dy]; the caller moves the thing's outline by the same amount, and syncWorld then finds
 * the actor already in place (no jump when the store catches up).
 */
export function settleActor(world, thingId) {
  const a = actorFor(world, thingId);
  if (!a) return null;
  const dx = a.x - a.homeX, dy = a.y - a.homeY;
  a.homeX = a.x;
  a.homeY = a.y;
  // Taps hit the thing where it now is, even before the store has the moved outline.
  a.outline = a.outline.map(([x, y]) => [x + dx, y + dy]);
  return [dx, dy];
}

/**
 * Where a held actor is resized about, board coordinates [x, y]: the bottom centre of its outline
 * where it is now (geometry/transform.js footPoint), so its feet stay put. Null for no such thing.
 */
export function footPivot(world, thingId) {
  const a = actorFor(world, thingId);
  if (!a) return null;
  return [a.x + (a.ext.right - a.ext.left) / 2, a.y + a.ext.bottom];
}

/**
 * Edit mode resize preview: the held actor drawn `k` times its size about the pivot (px, py), its
 * anchor at (x0, y0) before the resize. Number writes only; the renderer scales the cached sprite,
 * its eyes and legs by `scale`, so the store is not touched until the release.
 */
export function scaleActor(world, thingId, k, x0, y0, px, py) {
  const a = actorFor(world, thingId);
  if (!a) return null;
  a.glideT = -1;
  a.scale = k;
  a.x = a.tx = px + (x0 - px) * k;
  a.y = a.ty = py + (y0 - py) * k;
  return a;
}

/**
 * The resize was let go: the scaled actor is the thing's new home. Returns {s, dx, dy}: the caller
 * writes the thing scaled by `s` about its foot point (geometry/transform.js scaledThingPatch),
 * then moved by (dx, dy) (non-zero only if the actor was off its home when picked up). The actor
 * keeps drawing its old sprite at `scale` until the farm has the new outline (fitThing resets it),
 * and its extents stay the old ones so that syncWorld sees the size change and spreads again.
 */
export function settleResize(world, thingId) {
  const a = actorFor(world, thingId);
  if (!a) return null;
  const k = a.scale;
  const px = a.homeX + (a.ext.right - a.ext.left) / 2, py = a.homeY + a.ext.bottom;
  const dx = a.x - (px + (a.homeX - px) * k), dy = a.y - (py + (a.homeY - py) * k);
  a.outline = a.outline.map(([x, y]) => [px + (x - px) * k + dx, py + (y - py) * k + dy]);
  a.homeX = a.x;
  a.homeY = a.y;
  return { s: k, dx, dy };
}

export function actorFor(world, thingId) {
  for (const a of world.actors) if (a.thingId === thingId) return a;
  return null;
}

/** Tap reaction: the thing stops and jumps; while asleep it only stirs. Returns the actor or null. */
export function react(world, thingId) {
  const a = actorFor(world, thingId);
  if (!a) return null;
  if (world.asleep) { a.stir = STIR_S; return a; }
  a.state = "react";
  a.stateTime = 0;
  a.move = 0;
  a.blinkT = -1;
  return a;
}

/** A newly added thing falls in from above. */
export function dropActor(world, thingId, delay = 0) {
  const a = actorFor(world, thingId);
  if (a) startDrop(a, delay);
  return a;
}

/** The sleep timer fired (US-5.4): everyone yawns and falls asleep. */
export function sleepAll(world) {
  world.asleep = true;
  for (const a of world.actors) {
    a.state = "sleep";
    a.stateTime = 0;
    a.move = 0;
    a.blinkT = -1;
    a.stir = 0;
  }
}

// ---------- stepping ----------

/**
 * Advances the world by dt seconds of real time (idle gaps included; they are skipped cheaply).
 * @param {{fingerDown?: boolean}} input
 */
export function step(world, dt, input, rng) {
  world.finger = !!input?.fingerDown;
  if (dt > 0) world.acc += Math.min(dt, MAX_GAP_S);
  let n = Math.floor(world.acc / TICK + 1e-9);
  world.acc = Math.max(0, world.acc - n * TICK);
  let active = 0;
  while (n > 0) {
    if (isIdle(world)) {
      const k = Math.min(n, Math.floor(idleGapS(world) / TICK) - 1);
      if (k > 0) { advanceIdle(world, k * TICK); n -= k; continue; }
    }
    if (active++ >= MAX_ACTIVE_TICKS) break;
    tick(world, TICK, rng);
    n--;
  }
  for (const a of world.actors) writePose(a);
}

function tick(world, h, rng) {
  const finger = world.finger, play = world.mode === "play" && !world.asleep;
  for (const a of world.actors) {
    if (a.glideT >= 0) glide(a, h);
    switch (a.state) {
      case "react":
        a.stateTime += h;
        if (a.stateTime >= REACT_S) { a.state = "idle"; a.stateTime = 0; a.rest = restTime(a, rng); }
        break;
      case "drop":
        a.stateTime += h;
        if (a.stateTime >= DROP_S) { settleForMode(world, a); a.rest = lerp(FIRST_REST[0], FIRST_REST[1], rng()); }
        break;
      case "wiggle":
        a.stateTime = Math.min(WIGGLE_S, a.stateTime + h);
        break;
      case "sleep":
        a.stateTime = Math.min(SLEEP_SETTLE_S, a.stateTime + h);
        a.stir = Math.max(0, a.stir - h);
        break;
      case "idle":
        a.stateTime += h;
        if (a.move > 0) { a.move = Math.max(0, a.move - h / RAMP_S); a.t += h; }
        if (play && !finger) {
          a.rest -= h;
          if (a.rest <= 0) startWalk(world, a, rng);
        }
        break;
      case "moving":
        a.stateTime += h;
        if (finger || !play) {
          if (a.move > 0) { a.move = Math.max(0, a.move - h / RAMP_S); a.t += h; }
        } else {
          a.move = Math.min(1, a.move + h / RAMP_S);
          a.t += h;
          walk(world, a, h, rng);
        }
        break;
    }
    if (play && a.eyes > 0 && (a.state === "idle" || a.state === "moving")) {
      if (a.blinkT >= 0) {
        a.blinkT += h;
        if (a.blinkT >= num(a.motion.blink?.duration, 0.18)) { a.blinkT = -1; a.blinkIn = blinkInterval(a, rng); }
      } else if (!finger) {
        a.blinkIn -= h;
        if (a.blinkIn <= 0) a.blinkT = 0;
      }
    }
  }
}

function glide(a, h) {
  a.glideT += h;
  const u = Math.min(1, a.glideT / GLIDE_S), e = u * u * (3 - 2 * u);
  a.x = lerp(a.gx, a.tx, e);
  a.y = lerp(a.gy, a.ty, e);
  if (u >= 1) a.glideT = -1;
}

/** Only called while isIdle and with no timer crossing zero: timers advance, nothing else. */
function advanceIdle(world, s) {
  const running = world.mode === "play" && !world.asleep && !world.finger;
  for (const a of world.actors) {
    if (a.state === "idle") {
      a.stateTime += s;
      if (running) { a.rest -= s; if (a.eyes > 0) a.blinkIn -= s; }
    }
  }
}

function xBounds(a) {
  const half = Math.max(a.ext.left, a.ext.right); // the sprite mirrors when it turns
  const lo = half + MARGIN, hi = 1 - half - MARGIN;
  return lo <= hi ? [lo, hi] : [0.5, 0.5];
}

function yBounds(a) {
  const range = num(a.motion.travel?.rangeY, 0);
  let lo = Math.max(a.ext.top + MARGIN, a.homeY - range);
  let hi = Math.min(1 - a.ext.bottom - MARGIN, a.homeY + range);
  const mode = a.motion.travel?.mode;
  if (mode === "ground" || mode === "hop") {
    lo = Math.max(lo, GROUND_TOP - a.ext.bottom);
    hi = Math.max(hi, Math.min(lo, 1 - a.ext.bottom - MARGIN));
  }
  return lo <= hi ? [lo, hi] : [hi, hi];
}

function startWalk(world, a, rng) {
  a.rest = restTime(a, rng);
  const tr = a.motion.travel ?? {};
  if (travelSpeed(tr) * world.speedFactor <= 0) return;
  const [xlo, xhi] = xBounds(a);
  const dist = lerp(num(tr.distMin, 0.08), num(tr.distMax, 0.2), rng());
  const nearLeft = a.x - xlo < dist, nearRight = xhi - a.x < dist;
  const dir = nearLeft && !nearRight ? 1 : nearRight && !nearLeft ? -1 : rng() < 0.5 ? -1 : 1;
  const [ylo, yhi] = yBounds(a);
  a.tx = clamp(a.x + dir * dist, xlo, xhi);
  a.ty = lerp(ylo, yhi, rng());
  if (Math.abs(a.tx - a.x) < 1e-3 && Math.abs(a.ty - a.y) < 1e-3) return;
  if (a.tx !== a.x) a.facing = a.tx > a.x ? 1 : -1;
  a.state = "moving";
  a.stateTime = 0;
}

function walk(world, a, h, rng) {
  const stepLen = travelSpeed(a.motion.travel) * world.speedFactor * a.move * h;
  const ux = a.tx - a.x, uy = (a.ty - a.y) * ASPECT;
  const len = Math.sqrt(ux * ux + uy * uy);
  if (len <= stepLen || len < 1e-9) {
    a.x = a.tx;
    a.y = a.ty;
    a.state = "idle";
    a.stateTime = 0;
    a.rest = restTime(a, rng);
    return;
  }
  a.x += (ux / len) * stepLen;
  a.y += (uy / len) * stepLen / ASPECT;
}

// ---------- poses ----------

const MOTION_STATE = { move: 0, blinkT: -1 };

function writePose(a) {
  const p = a.pose, st = a.stateTime;
  switch (a.state) {
    case "idle":
    case "moving":
      MOTION_STATE.move = a.move;
      MOTION_STATE.blinkT = a.blinkT;
      pose(a.motion, a.t, MOTION_STATE, p);
      return;
    case "react": {
      restPose(p, a.nLegs);
      p.dy = jump(st);
      const s = jumpStretch(st);
      p.sx = 1 + s; p.sy = 1 - s;
      if (a.motion.travel?.mode === "water") p.rot = jumpSpin(st);
      return;
    }
    case "drop": {
      restPose(p, a.nLegs);
      p.dy = drop(st);
      const s = dropStretch(st);
      p.sx = 1 + s; p.sy = 1 - s;
      return;
    }
    case "wiggle":
      restPose(p, a.nLegs);
      p.rot = wiggle(st);
      return;
    case "sleep":
      restPose(p, a.nLegs);
      yawn(st, p);
      if (a.stir > 0) p.rot = wiggle(STIR_S - a.stir, 0.04, 2, STIR_S);
      return;
  }
}

// ---------- idling ----------

/** True when nothing moves, so the renderer can stop its loop. */
export function isIdle(world) {
  for (const a of world.actors) {
    if (a.glideT >= 0) return false;
    switch (a.state) {
      case "react":
      case "drop":
        return false;
      case "wiggle":
        if (a.stateTime < WIGGLE_S) return false;
        break;
      case "sleep":
        if (a.stateTime < SLEEP_SETTLE_S || a.stir > 0) return false;
        break;
      case "idle":
        if (a.move > 0 || a.blinkT >= 0) return false;
        break;
      case "moving":
        if (!(world.finger || world.mode !== "play") || a.move > 0) return false;
        break;
    }
  }
  return true;
}

/** Seconds until an idle world starts moving by itself (a wander or a blink); Infinity if never. */
function idleGapS(world) {
  if (world.mode !== "play" || world.asleep || world.finger) return Infinity;
  let gap = Infinity;
  for (const a of world.actors) {
    if (a.state !== "idle") continue;
    if (travelSpeed(a.motion.travel) * world.speedFactor > 0 && a.rest < gap) gap = a.rest;
    if (a.eyes > 0 && a.blinkIn < gap) gap = a.blinkIn;
  }
  return Math.max(0, gap);
}

/** Milliseconds until the next wander or blink starts (Infinity: nothing scheduled). */
export function nextWakeMs(world) {
  const s = idleGapS(world);
  if (s === Infinity) return Infinity;
  // The timer fires on the tick that takes it to 0 or below.
  return Math.ceil(Math.max(1, Math.ceil(s / TICK - 1e-9)) * TICK * 1000);
}

/** Hit targets in drawing order, at the things' current positions. Allocates: call on taps only. */
export function hitTargets(world) {
  return world.actors.map((a) => {
    const ox = a.x - a.homeX + a.pose.dx, oy = a.y - a.homeY + a.pose.dy;
    return { id: a.thingId, poly: a.outline.map(([x, y]) => [x + ox, y + oy]), x: a.x + a.pose.dx, y: a.y + a.pose.dy };
  });
}
