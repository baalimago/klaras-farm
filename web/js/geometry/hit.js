// Tap hit testing (US-5.1). Pure.
import { pointInPolygon, BOARD_ASPECT } from "./stroke.js";

/**
 * @typedef {Object} HitTarget
 * @property {string} id
 * @property {import('../types.js').Point[]} poly   the outline where it is now, board coordinates
 * @property {number} x                              its centre (anchor), board coordinates
 * @property {number} y
 */

/**
 * Which thing a tap at `pt` hits.
 *  1. A point on a drawing: the topmost drawing (last in `targets`, which is drawing order).
 *  2. Otherwise, among targets whose hit area contains the point, the nearest centre. The hit area is
 *     the drawing scaled `scale`× about its centre, plus a circle of `minRadius` around the centre.
 *  3. Otherwise null.
 * `minRadius` is in board-width units (the caller converts CSS px: px / boardCssWidth). Distances are
 * measured on screen, so y is scaled by 1/aspect (the board is 4:3).
 * @param {HitTarget[]} targets
 * @param {import('../types.js').Point} pt
 * @param {{scale?: number, minRadius?: number, aspect?: number}} [opts]
 * @returns {string|null}
 */
export function hitTest(targets, pt, { scale = 1.3, minRadius = 0, aspect = BOARD_ASPECT } = {}) {
  for (let i = targets.length - 1; i >= 0; i--) {
    if (pointInPolygon(pt, targets[i].poly)) return targets[i].id;
  }
  let best = null, bestD = Infinity;
  const ky = 1 / aspect;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const dx = pt[0] - t.x, dy = pt[1] - t.y;
    const d = Math.hypot(dx, dy * ky);
    // inverse-scale the point about the centre instead of scaling the polygon
    const inScaled = pointInPolygon([t.x + dx / scale, t.y + dy / scale], t.poly);
    if ((inScaled || d <= minRadius) && d < bestD) {
      best = t.id;
      bestD = d;
    }
  }
  return best;
}
