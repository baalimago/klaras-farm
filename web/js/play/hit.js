// Private hit testing and outline measures for play (US-5.1). Same contract as package A's
// geometry/hit.js `hitTest(targets, pt, {scale=1.3, minRadius})`; reconcile at integration.
// Board units: x and y are 0..1 of the 4:3 board's width and height.

/** Board height / width, so distances are round on screen. */
export const ASPECT = 0.75;

/** Even-odd point in polygon. */
export function pointInPolygon(pt, poly) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * @param {{id: string, poly: [number, number][], x: number, y: number}[]} targets  drawing order (back to front); poly in board coords, (x, y) its anchor
 * @param {[number, number]} pt
 * @param {{scale?: number, minRadius?: number, aspect?: number}} [opts]  minRadius in board widths
 * @returns {string|null} topmost outline hit (scaled about the anchor), else the nearest anchor within minRadius, else null
 */
export function hitTest(targets, pt, { scale = 1.3, minRadius = 0, aspect = ASPECT } = {}) {
  const probe = [0, 0];
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    probe[0] = t.x + (pt[0] - t.x) / scale;
    probe[1] = t.y + (pt[1] - t.y) / scale;
    if (pointInPolygon(probe, t.poly)) return t.id;
  }
  let best = null, bestD = minRadius * minRadius;
  for (const t of targets) {
    const dx = pt[0] - t.x, dy = (pt[1] - t.y) * aspect;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { best = t.id; bestD = d; }
  }
  return best;
}

/** Area-weighted centroid of a closed polygon; the vertex mean when the area is ~0. */
export function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, y0] = poly[j], [x1, y1] = poly[i];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0;
    for (const [x, y] of poly) { sx += x; sy += y; }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** How far the outline reaches from (cx, cy) on each side. */
export function extents(poly, cx, cy) {
  let left = 0, right = 0, top = 0, bottom = 0;
  for (const [x, y] of poly) {
    left = Math.max(left, cx - x); right = Math.max(right, x - cx);
    top = Math.max(top, cy - y); bottom = Math.max(bottom, y - cy);
  }
  return { left, right, top, bottom };
}
