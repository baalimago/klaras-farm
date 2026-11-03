// Private geometry fallback for F1, used only when package A's geometry/stroke.js is missing.
// Same names and signatures as geometry/stroke.js (IMPLEMENTATION.md, package A); see geometry.js.
// Points are [x, y] in board coordinates.

export function bbox(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Signed area (shoelace). */
export function polygonArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return a / 2;
}

export function centroid(points) {
  const a = polygonArea(points);
  if (Math.abs(a) < 1e-12) {
    const n = points.length || 1;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const f = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    cx += (points[j][0] + points[i][0]) * f;
    cy += (points[j][1] + points[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearestOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return [ax + t * dx, ay + t * dy];
}

/** Nearest point strictly inside the polygon (inside points are returned unchanged). */
export function snapInside(pt, poly) {
  if (pointInPolygon(pt, poly)) return [pt[0], pt[1]];
  let best = poly[0], bestD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const q = nearestOnSegment(pt, poly[j], poly[i]);
    const d = (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2;
    if (d < bestD) (bestD = d), (best = q);
  }
  // Step from the edge towards the centroid until strictly inside, keeping a small margin.
  const c = centroid(poly);
  const b = bbox(poly);
  const margin = Math.max(b.w, b.h) * 0.06;
  const dx = c[0] - best[0], dy = c[1] - best[1];
  const dist = Math.hypot(dx, dy) || 1;
  for (let k = 1; k <= 40; k++) {
    const t = Math.min(1, (margin * k) / 4 / dist);
    const q = [best[0] + dx * t, best[1] + dy * t];
    if (pointInPolygon(q, poly) && (k >= 4 || t >= 1)) return q;
    if (t >= 1) break;
  }
  return pointInPolygon(c, poly) ? c : [best[0], best[1]];
}

/** Scales an outline to fit maxW × maxH (keeping its aspect) and centres it on (cx, cy), inside the board. */
export function fitOutline(points, { maxW, maxH, cx, cy }) {
  const b = bbox(points);
  const k = Math.min(maxW / (b.w || 1e-6), maxH / (b.h || 1e-6));
  const w = b.w * k, h = b.h * k;
  const ox = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const oy = Math.min(Math.max(cy - h / 2, 0), 1 - h);
  return points.map(([x, y]) => [ox + (x - b.x) * k, oy + (y - b.y) * k]);
}
