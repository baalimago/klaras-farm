// Joining a stroke onto shapes already drawn (Draw step and Redraw; playtests 2 and 3). Pure.
//
// A stroke whose two ends are far apart is normally refused as "open". But parents draw an ear, a horn
// or a head over the body, and the body closes the loop. So an open stroke that touches a drawn shape
// (any part of it inside, within JOIN_TOL of an edge, or crossing one) is accepted here and turned into
// a closed polygon: the stroke plus the straight segment back to its start. Playtest 3: it must not
// matter where it starts or ends ("you need to start inside and end inside" was not discoverable).
// When it touches two shapes, that polygon (or, for a nearly straight stroke, a band around the
// stroke) bridges them, so union.js glues them into one outline. `touches` also tells the drawing
// whether a closed shape touches the others (a shape drawn apart is refused, see drawing.js).

import { pointInPolygon, nearestOnPolygon, polygonArea, pathLength, bbox } from "./stroke.js";

/** @typedef {import('../types.js').Point} Point */

/** How far outside a shape (board units) a stroke end may stop and still count as inside it. */
export const JOIN_TOL = 0.04;

/** A closed stroke thinner than this fraction of its length squared is treated as a line. */
const THIN = 0.02;

/**
 * Index of the smallest shape holding `pt` (or within `tol` of its edge), or -1.
 * The smallest wins so an ear drawn inside a big body can still be picked.
 * @param {Point} pt
 * @param {Point[][]} shapes
 */
export function shapeAt(pt, shapes, tol = JOIN_TOL) {
  let best = -1, bestArea = Infinity;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (!Array.isArray(s) || s.length < 3) continue;
    if (!pointInPolygon(pt, s) && nearestOnPolygon(pt, s).d > tol) continue;
    const a = polygonArea(s);
    if (a < bestArea) { bestArea = a; best = i; }
  }
  return best;
}

/** Orientation of c against the line a→b: 1, -1, or 0 when collinear. */
function orient(a, b, c) {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 1e-15 ? 1 : v < -1e-15 ? -1 : 0;
}

/** True when segments ab and cd cross (touching at a point counts; collinear overlaps are caught by the distance test). */
function segmentsCross(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

/** The segments of a polyline, closed back to the start when `closed`. */
function segments(points, closed) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]]);
  if (closed && points.length > 2) out.push([points[points.length - 1], points[0]]);
  return out;
}

/** Two boxes grown by tol overlap (a cheap reject before the exact tests). */
function boxesNear(a, b, tol) {
  return a.x - tol <= b.x + b.w && b.x - tol <= a.x + a.w && a.y - tol <= b.y + b.h && b.y - tol <= a.y + a.h;
}

/**
 * Whether a stroke (or a closed shape) touches `shape`: a point of it is inside the shape or within
 * `tol` of its edge, one of its segments crosses an edge, or, when `closed`, it holds the shape.
 * @param {Point[]} points
 * @param {Point[]} shape  a closed polygon
 * @param {{tol?: number, closed?: boolean}} [opts]
 */
export function touches(points, shape, { tol = JOIN_TOL, closed = false } = {}) {
  if (!Array.isArray(points) || !points.length || !Array.isArray(shape) || shape.length < 3) return false;
  if (!boxesNear(bbox(points), bbox(shape), tol)) return false;
  for (const p of points) if (pointInPolygon(p, shape) || nearestOnPolygon(p, shape).d <= tol) return true;
  if (closed && points.length >= 3 && pointInPolygon(shape[0], points)) return true;
  const edges = segments(shape, true);
  for (const [a, b] of segments(points, closed)) for (const [c, d] of edges) if (segmentsCross(a, b, c, d)) return true;
  return false;
}

/** Indexes of the shapes `points` touches (see touches). */
export function touchedShapes(points, shapes, opts) {
  const out = [];
  (shapes ?? []).forEach((s, i) => { if (touches(points, s, opts)) out.push(i); });
  return out;
}

/**
 * Closes an open stroke that touches the shapes drawn so far.
 * @param {Point[]} points  the open stroke (board units)
 * @param {Point[][]} shapes  the shapes drawn so far (null entries are skipped)
 * @returns {null | {points: Point[], from: number, to: number}}  a closed polygon to add as a shape,
 *   and the shapes the stroke starts and ends in (-1 for an end outside every shape); null when the
 *   stroke touches no shape.
 */
export function joinOpenStroke(points, shapes, { tol = JOIN_TOL } = {}) {
  if (!Array.isArray(points) || points.length < 2 || !shapes?.length) return null;
  const from = shapeAt(points[0], shapes, tol);
  const to = shapeAt(points[points.length - 1], shapes, tol);
  if ((from < 0 || to < 0) && !touchedShapes(points, shapes, { tol }).length) return null;
  const L = pathLength(points, true);
  const closed = points.map(([x, y]) => [x, y]);
  // A line (a neck from body to head, or a there-and-back stroke) has no area to fill: give it width.
  if (closed.length < 3 || polygonArea(closed) < THIN * L * L) {
    return { points: thickenStroke(points, Math.max(0.012, pathLength(points) * 0.06)), from, to };
  }
  return { points: closed, from, to };
}

/**
 * A band of half-width `w` around a polyline, as one closed polygon (left side out, right side back).
 * @param {Point[]} points
 * @returns {Point[]}  [] when the polyline has no length
 */
export function thickenStroke(points, w) {
  const pts = [];
  for (const p of points) {
    const q = pts[pts.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p);
  }
  if (pts.length < 2) return [];
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    // average the normals of the segments either side of the point
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * w, ny = (dx / l) * w;
    left.push([pts[i][0] + nx, pts[i][1] + ny]);
    right.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  return [...left, ...right.reverse()];
}
