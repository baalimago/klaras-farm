// Stroke and polygon geometry. Pure: points are [x, y] arrays, usually board coordinates (0..1).
// The board is 4:3, so one unit of y is 3/4 the on-screen length of one unit of x; functions here
// work in plain board units unless they take an `aspect` option.

/** @typedef {import('../types.js').Point} Point */

export const BOARD_ASPECT = 4 / 3;

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Distance from p to the segment a–b. */
export function distToSegment(p, a, b) {
  const [q] = nearestOnSegment(p, a, b);
  return dist(p, q);
}

/** Nearest point to p on segment a–b, and its parameter t. @returns {[Point, number]} */
export function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return [[a[0] + dx * t, a[1] + dy * t], t];
}

/** Ramer–Douglas–Peucker. Keeps the first and last point. Iterative (no recursion depth limits). */
export function simplify(points, tol) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i], points[s], points[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0 && max > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Chaikin corner cutting. Open strokes keep their endpoints; closed ones wrap around. */
export function smooth(points, iterations = 1, closed = false) {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const out = closed ? [] : [pts[0]];
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

export function pathLength(points, closed = false) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += dist(points[i - 1], points[i]);
  if (closed && points.length > 2) L += dist(points[points.length - 1], points[0]);
  return L;
}

/** Shoelace area, positive for counter-clockwise in a y-up frame (clockwise on screen). */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Absolute polygon area. */
export function polygonArea(poly) {
  return Math.abs(signedArea(poly));
}

/** Area centroid; the vertex mean when the area is (near) zero. */
export function centroid(poly) {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-12) {
    let x = 0, y = 0;
    for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

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

/** Even–odd ray casting. */
export function pointInPolygon(pt, poly) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from pt to the polygon's boundary, and the nearest boundary point. */
export function nearestOnPolygon(pt, poly) {
  let best = Infinity, q = poly[0], edge = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [c] = nearestOnSegment(pt, poly[i], poly[(i + 1) % n]);
    const d = dist(pt, c);
    if (d < best) { best = d; q = c; edge = i; }
  }
  return { d: best, point: q, edge };
}

/**
 * The nearest point strictly inside the polygon, at least `margin` from its edge when the shape is
 * thick enough there (eye stamping, US-3.2). Points already that far inside are returned unchanged.
 */
export function snapInside(pt, poly, { margin = 0.01 } = {}) {
  const { d, point: q, edge } = nearestOnPolygon(pt, poly);
  if (pointInPolygon(pt, poly) && d >= margin) return pt;
  const a = poly[edge], b = poly[(edge + 1) % poly.length];
  const ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1;
  // inward normal: depends on winding
  const s = signedArea(poly) > 0 ? 1 : -1;
  const nx = (-ey / el) * s, ny = (ex / el) * s;
  for (let m = margin; m > margin / 64; m /= 2) {
    const c = [q[0] + nx * m, q[1] + ny * m];
    if (pointInPolygon(c, poly) && nearestOnPolygon(c, poly).d >= m * 0.5) return c;
  }
  // Corner or sliver: walk from q toward the centroid, then fall back to a scan.
  const c = centroid(poly);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const p = [q[0] + (c[0] - q[0]) * t, q[1] + (c[1] - q[1]) * t];
    if (pointInPolygon(p, poly)) return p;
  }
  return deepestPoint(poly);
}

/** A point well inside the polygon (coarse grid search for the point farthest from the edge). */
export function deepestPoint(poly, steps = 24) {
  const b = bbox(poly);
  let best = centroid(poly), bestD = pointInPolygon(best, poly) ? nearestOnPolygon(best, poly).d : -1;
  for (let i = 1; i < steps; i++) for (let j = 1; j < steps; j++) {
    const p = [b.x + (b.w * i) / steps, b.y + (b.h * j) / steps];
    if (!pointInPolygon(p, poly)) continue;
    const d = nearestOnPolygon(p, poly).d;
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * Scales an outline uniformly so its bounding box fits maxW × maxH (board units) and centres it on
 * (cx, cy) (default: its current centre). Uniform scaling in board units keeps the on-screen aspect.
 */
export function fitOutline(points, { maxW, maxH, cx, cy } = {}) {
  const b = bbox(points);
  const k = Math.min(maxW / (b.w || 1e-9), maxH / (b.h || 1e-9));
  const ox = b.x + b.w / 2, oy = b.y + b.h / 2;
  const tx = cx ?? ox, ty = cy ?? oy;
  return points.map(([x, y]) => [tx + (x - ox) * k, ty + (y - oy) * k]);
}

export function translate(points, dx, dy) {
  return points.map(([x, y]) => [x + dx, y + dy]);
}

/** Client px → board coords, for a board drawn into `rect` ({left, top, width, height}). */
export function toBoard(clientX, clientY, rect) {
  return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height];
}

/** Board coords → client px. */
export function fromBoard(x, y, rect) {
  return [rect.left + x * rect.width, rect.top + y * rect.height];
}

/** The largest `aspect` rect centred in a container: letterboxed, never cropped (US-7.7). */
export function fitRect(containerW, containerH, aspect = BOARD_ASPECT, left = 0, top = 0) {
  let width = containerW, height = containerW / aspect;
  if (height > containerH) { height = containerH; width = containerH * aspect; }
  return { left: left + (containerW - width) / 2, top: top + (containerH - height) / 2, width, height };
}

/**
 * Closes a drawn outline (US-3.1). If the ends are within `maxGapRatio` of the stroke length (or the
 * stroke overshoots past its start), the loop is closed and any overshoot trimmed. Otherwise the
 * stroke is reported open with both ends, so the UI can highlight them.
 * @returns {{closed: boolean, points: Point[], gap: null | {a: Point, b: Point}}}
 */
export function closeGap(points, { maxGapRatio = 0.08 } = {}) {
  const n = points.length;
  const open = { closed: false, points, gap: n ? { a: points[0], b: points[n - 1] } : null };
  if (n < 4) return open;
  const L = pathLength(points);
  if (L === 0) return open;
  // cumulative length, to search only the first and last 15% for the closing pair
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + dist(points[i - 1], points[i]);
  let bi = 0, bj = n - 1, best = dist(points[0], points[n - 1]);
  for (let i = 0; i < n && cum[i] <= L * 0.15; i++) {
    for (let j = n - 1; j > i && L - cum[j] <= L * 0.15; j--) {
      if (cum[j] - cum[i] < L * 0.5) continue;
      const d = dist(points[i], points[j]);
      if (d < best) { best = d; bi = i; bj = j; }
    }
  }
  const loop = points.slice(bi, bj + 1);
  const loopLen = cum[bj] - cum[bi];
  if (best > maxGapRatio * (loopLen + best)) return open;
  // drop a duplicated closing point
  if (loop.length > 3 && dist(loop[0], loop[loop.length - 1]) < 1e-9) loop.pop();
  if (loop.length < 3) return open;
  // a back-and-forth scribble has no area to fill
  if (polygonArea(loop) < 0.01 * loopLen * loopLen) return open;
  return { closed: true, points: loop, gap: null };
}
