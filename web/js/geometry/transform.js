// Moving and resizing drawn things and scene pieces (US-2.2 scene tools, US-11.3 edit mode).
// Pure: board points in, board points out. Used by the scene tools (move, resize), by the board
// when a parent drags or resizes a thing in edit mode (movedThingPatch, scaledThingPatch), and by
// the renderer to tell a moved drawing from a redrawn one (a moved drawing keeps its cached felt sprite).
import { bbox } from "./stroke.js";

/** Smallest side, in board units, a resized piece may shrink to. */
export const MIN_SIDE = 0.02;

/**
 * If `b` is `a` moved by one offset (within `eps` per coordinate, which absorbs the store's
 * 3-decimal rounding), returns that offset [dx, dy]; otherwise null.
 * @param {import('../types.js').Point[]} a @param {import('../types.js').Point[]} b
 */
export function translationBetween(a, b, eps = 0.0015) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return null;
  const dx = b[0][0] - a[0][0];
  const dy = b[0][1] - a[0][1];
  for (let i = 1; i < a.length; i++) {
    if (Math.abs(b[i][0] - a[i][0] - dx) > eps || Math.abs(b[i][1] - a[i][1] - dy) > eps) return null;
  }
  return [dx, dy];
}

/** Limits (dx, dy) so a box {x, y, w, h} stays on the board (0..1 on both axes). */
export function clampDelta(box, dx, dy) {
  const cdx = Math.max(-box.x, Math.min(1 - box.x - box.w, dx));
  const cdy = Math.max(-box.y, Math.min(1 - box.y - box.h, dy));
  return [cdx, cdy];
}

/** Points moved by (dx, dy). */
export function translatePoints(points, dx, dy) {
  return points.map(([x, y]) => [x + dx, y + dy]);
}

/** Points scaled by `s` about (cx, cy). */
export function scaleAbout(points, s, cx, cy) {
  return points.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
}

/**
 * The scale factor nearest to `s` that keeps a box scaled about (cx, cy) on the board and its
 * smaller side at least MIN_SIDE.
 */
export function clampScale(box, s, cx, cy) {
  const side = Math.min(box.w, box.h);
  let lo = side > 0 ? Math.min(1, MIN_SIDE / side) : 1;
  let hi = Infinity;
  const limit = (dist, room) => {
    if (dist > 1e-9) hi = Math.min(hi, room / dist);
  };
  limit(cx - box.x, cx);
  limit(box.x + box.w - cx, 1 - cx);
  limit(cy - box.y, cy);
  limit(box.y + box.h - cy, 1 - cy);
  if (hi < lo) lo = hi;
  return Math.max(lo, Math.min(hi, s));
}

/**
 * A thing moved by (dx, dy), limited so its outline stays on the board.
 * Returns the patch for `store.updateThing`: {outline, eyes, legs} (legs only when the thing has them).
 * @param {{outline: import('../types.js').Point[], eyes?: {x:number,y:number}[], legs?: {x:number,y:number}[]}} thing
 */
export function movedThingPatch(thing, dx, dy) {
  const [cdx, cdy] = clampDelta(bbox(thing.outline), dx, dy);
  const move = (list) => (list ?? []).map((p) => ({ ...p, x: p.x + cdx, y: p.y + cdy }));
  const patch = { outline: translatePoints(thing.outline, cdx, cdy), eyes: move(thing.eyes) };
  if (Array.isArray(thing.legs)) patch.legs = move(thing.legs);
  return patch;
}

// ---------- resizing a thing (edit mode scale tool) ----------

/** The standard thing box (a new thing fills it one way), in board units: a thing's size is measured against it. */
export const THING_BOX = Object.freeze({ w: 0.24, h: 0.32 });
/** A resized thing fills between these fractions of THING_BOX (its larger side decides). */
export const THING_SCALE_MIN = 0.4;
export const THING_SCALE_MAX = 1.8;

/** How big an outline is next to THING_BOX: 1 fills it one way. 0 for an empty outline. */
export function thingSize(outline) {
  if (!Array.isArray(outline) || outline.length === 0) return 0;
  const b = bbox(outline);
  return Math.max(b.w / THING_BOX.w, b.h / THING_BOX.h);
}

/** The bottom centre of an outline's box [x, y]: a thing is resized about it, so its feet stay put. */
export function footPoint(outline) {
  const b = bbox(outline);
  return [b.x + b.w / 2, b.y + b.h];
}

/**
 * The scale factor nearest to `s` that keeps a thing, scaled about its foot point, between
 * THING_SCALE_MIN and THING_SCALE_MAX of THING_BOX and on the board. A thing already outside the
 * size limits is never forced to change: it may stay as it is, or move towards them.
 * @param {{outline: import('../types.js').Point[]}} thing
 */
export function clampThingScale(thing, s) {
  const size = thingSize(thing?.outline);
  if (!(size > 0) || !Number.isFinite(s) || s <= 0) return 1;
  const lo = Math.min(1, THING_SCALE_MIN / size);
  const hi = Math.max(1, THING_SCALE_MAX / size);
  const k = Math.max(lo, Math.min(hi, s));
  const [px, py] = footPoint(thing.outline);
  return clampScale(bbox(thing.outline), k, px, py);
}

/**
 * A thing resized by `s` (clamped by clampThingScale) about its foot point: the patch for
 * `store.updateThing`, {outline, eyes, legs} (legs only when the thing has them). Eyes and legs
 * scale with the body, so they stay where they were drawn on it.
 * @param {{outline: import('../types.js').Point[], eyes?: {x:number,y:number}[], legs?: {x:number,y:number}[]}} thing
 */
export function scaledThingPatch(thing, s) {
  const k = clampThingScale(thing, s);
  const [px, py] = footPoint(thing.outline);
  const point = (p) => ({ ...p, x: px + (p.x - px) * k, y: py + (p.y - py) * k });
  const patch = { outline: scaleAbout(thing.outline, k, px, py), eyes: (thing.eyes ?? []).map(point) };
  if (Array.isArray(thing.legs)) patch.legs = thing.legs.map(point);
  return patch;
}
