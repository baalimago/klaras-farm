// Joining an open stroke onto shapes already drawn (Draw step and Redraw; playtest 2). Pure.
//
// A stroke whose two ends are far apart is normally refused as "open". But parents draw an ear or a
// head by starting inside the body, going out and coming back in: the body closes the loop. So an open
// stroke whose start and end both lie inside (or within JOIN_TOL of) a drawn shape is accepted here and
// turned into a closed polygon: the stroke plus the straight segment back to its start. When both ends
// sit in different shapes, that polygon (or, for a nearly straight stroke, a band around the stroke)
// bridges them, so union.js glues them into one outline.

import { pointInPolygon, nearestOnPolygon, polygonArea, pathLength } from "./stroke.js";

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

/**
 * Closes an open stroke on the shapes its ends lie in.
 * @param {Point[]} points  the open stroke (board units)
 * @param {Point[][]} shapes  the shapes drawn so far
 * @returns {null | {points: Point[], from: number, to: number}}  a closed polygon to add as a shape,
 *   and the shapes the stroke starts and ends in; null when an end is outside every shape.
 */
export function joinOpenStroke(points, shapes, { tol = JOIN_TOL } = {}) {
  if (!Array.isArray(points) || points.length < 2 || !shapes?.length) return null;
  const from = shapeAt(points[0], shapes, tol);
  if (from < 0) return null;
  const to = shapeAt(points[points.length - 1], shapes, tol);
  if (to < 0) return null;
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
