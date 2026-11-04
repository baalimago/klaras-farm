// Pure helpers for scene tools: hit testing and moving scene pieces.
// Pieces are in board coordinates (0..1 on both axes of the 4:3 board); hit tests measure in
// client pixels so a yarn line is as easy to hit horizontally as vertically.
import { bbox } from "../../geometry/stroke.js";
import { clampScale, scaleAbout } from "../../geometry/transform.js";

/** @param {[number, number]} pt @param {[number, number][]} poly */
export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance in pixels from a board point to a polyline (closed when `closed`). */
export function distanceToStroke([x, y], stroke, { width, height }, closed = false) {
  let best = Infinity;
  const n = stroke.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = stroke[i];
    const b = stroke[(i + 1) % n];
    best = Math.min(best, segDist(x * width, y * height, a[0] * width, a[1] * height, b[0] * width, b[1] * height));
  }
  if (n === 1) best = Math.hypot((x - stroke[0][0]) * width, (y - stroke[0][1]) * height);
  return best;
}

/**
 * Topmost piece under a board point, or null. Shapes hit inside or within `tolPx` of their edge;
 * yarn hits within `tolPx` of the line.
 */
export function pickPiece(pieces, pt, size, tolPx = 22) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (!p.stroke?.length) continue;
    if (p.kind === "shape" && p.stroke.length >= 3 && pointInPolygon(pt, p.stroke)) return p;
    if (distanceToStroke(pt, p.stroke, size, p.kind === "shape") <= tolPx) return p;
  }
  return null;
}

/** Moves a stroke by (dx, dy), limited so the piece's bounding box stays on the board. */
export function moveStroke(stroke, dx, dy) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of stroke) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cdx = Math.max(-minX, Math.min(1 - maxX, dx));
  const cdy = Math.max(-minY, Math.min(1 - maxY, dy));
  return stroke.map(([x, y]) => [x + cdx, y + cdy]);
}

/** Centre {x, y} and box {x, y, w, h} of a stroke, in board units. */
export function strokeBox(stroke) {
  const b = bbox(stroke);
  return { box: b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

/**
 * Resize by dragging a handle: the scale is how far the finger is from the piece's centre now,
 * over how far it was when the drag began (measured on screen, so x and y count the same),
 * limited so the piece stays on the board and not too small. Points are client pixels.
 */
export function resizeScale(stroke, startPx, nowPx, centrePx) {
  const d0 = Math.hypot(startPx[0] - centrePx[0], startPx[1] - centrePx[1]);
  if (d0 < 1) return 1;
  const s = Math.hypot(nowPx[0] - centrePx[0], nowPx[1] - centrePx[1]) / d0;
  const { box, cx, cy } = strokeBox(stroke);
  return clampScale(box, s, cx, cy);
}

/** A stroke scaled by `s` about its own centre. */
export function scaleStroke(stroke, s) {
  const { cx, cy } = strokeBox(stroke);
  return scaleAbout(stroke, s, cx, cy);
}

/** Pieces with `id` moved to the back (first in drawing order). Same array when it already is. */
export function sendToBack(pieces, id) {
  const i = pieces.findIndex((p) => p.id === id);
  if (i <= 0) return pieces;
  return [pieces[i], ...pieces.slice(0, i), ...pieces.slice(i + 1)];
}

/** SVG path data for a stroke in a 0..1 viewBox. */
export function pathData(stroke, closed) {
  if (!stroke.length) return "";
  return stroke.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(4)} ${y.toFixed(4)}`).join(" ") + (closed ? " Z" : "");
}
