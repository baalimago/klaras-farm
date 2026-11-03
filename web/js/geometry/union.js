// Union of several drawn shapes into ONE simple closed outline (multi-shape drawing). Pure.
//
// A Thing has exactly one outline, so the shapes a parent draws (a body, then a head, then ears) are
// merged here and nothing downstream changes. The approach is raster based, which is robust against
// the self-intersecting, wobbly loops fingers draw:
//   1. Rasterise every polygon (even–odd, at cell centres) onto a grid of `cells` (192) across the combined
//      bounds, in an isotropic frame (x is scaled by `aspect`, so cells are square on screen).
//   2. Morphological closing (dilate, then erode, by `glue` cells): shapes that nearly touch glue
//      together without the result growing.
//   3. Connected components (4-connected). Specks are dropped. Shapes that still don't touch are glued
//      with a soft bridge: a thick capsule between the nearest boundary cells of each separate blob and
//      the blob(s) already joined, so the result is ALWAYS one piece.
//   4. Holes are filled (flood fill of the background from the border); diagonal-only "saddle" contacts
//      are filled too, so the boundary is one simple loop.
//   5. The outer boundary is traced along cell edges (crack following); the edge midpoints give 45°
//      corners, then Chaikin smoothing and Ramer–Douglas–Peucker simplification (geometry/stroke.js).
// Deterministic; about 3–4 ms for five shapes at 192 cells in Node (warm).

import { smooth, simplify, polygonArea } from "./stroke.js";

/** @typedef {import('../types.js').Point} Point */

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {Point[][]} polys  closed polygons (board units), each ≥ 3 points
 * @param {{aspect?: number, cells?: number, glue?: number, tol?: number, round?: boolean}} [opts]
 *   aspect: on-screen width of one x unit relative to one y unit (the board is 4/3);
 *   cells: grid resolution across the larger side; glue: closing radius in cells;
 *   tol: simplification tolerance as a fraction of the drawing size; round: round to 3 decimals.
 * @returns {Point[]} one simple closed polygon (empty when there is nothing to merge)
 */
export function unionOutlines(polys, { aspect = 1, cells = 192, glue = 2, tol = 0.003, round = true } = {}) {
  const list = (polys ?? []).filter((p) => Array.isArray(p) && p.length >= 3 && polygonArea(p) > 1e-12);
  if (!list.length) return [];
  if (list.length === 1) return list[0].map(([x, y]) => [x, y]);

  // Isotropic frame bounds.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of list) for (const [x, y] of p) {
    const X = x * aspect;
    if (X < x0) x0 = X;
    if (X > x1) x1 = X;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const size = Math.max(x1 - x0, y1 - y0, 1e-6);
  const cell = size / cells;
  const pad = glue + 3;
  const W = Math.ceil((x1 - x0) / cell) + 2 * pad;
  const H = Math.ceil((y1 - y0) / cell) + 2 * pad;
  const ox = x0 - pad * cell, oy = y0 - pad * cell;

  let grid = new Uint8Array(W * H);
  for (const p of list) fillPolygon(grid, W, H, p.map(([x, y]) => [(x * aspect - ox) / cell, (y - oy) / cell]));

  if (glue > 0) grid = morph(morph(grid, W, H, glue, 1), W, H, glue, 0);
  joinComponents(grid, W, H);
  fillHoles(grid, W, H);
  if (removeSaddles(grid, W, H)) fillHoles(grid, W, H);

  const loop = traceOuter(grid, W, H);
  if (loop.length < 3) return [];
  const pts = loop.map(([gx, gy]) => [(ox + gx * cell) / aspect, oy + gy * cell]);
  // simplify in the isotropic frame's scale: tolerance relative to the drawing size (board units)
  const s = smooth(simplify(closeRing(pts), cell * 0.35 / aspect), 2, true);
  let out = simplify(closeRing(s), (size * tol) / aspect);
  out = out.slice(0, -1); // closeRing duplicated the start
  if (round) out = out.map(([x, y]) => [round3(x), round3(y)]);
  return dedupe(out);
}

/** RDP keeps the ends; a duplicated start point lets it simplify a ring. */
function closeRing(pts) {
  return pts.length ? [...pts, pts[0]] : pts;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

/** Even–odd scanline fill of one polygon (grid coords) at cell centres, OR-ed into the grid. */
function fillPolygon(grid, W, H, poly) {
  const n = poly.length;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const ys = Math.max(0, Math.floor(minY)), ye = Math.min(H - 1, Math.ceil(maxY));
  const xs = [];
  for (let row = ys; row <= ye; row++) {
    const cy = row + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = a; c <= b; c++) grid[row * W + c] = 1;
    }
  }
}

/**
 * Morphology by r passes of a 3×3 neighbourhood, alternating cross and square (an octagon of radius r).
 * `op` 1 dilates (OR), 0 erodes (AND). Cells outside the grid count as empty.
 */
function morph(src, W, H, r, op) {
  let a = src, b = new Uint8Array(W * H);
  for (let pass = 0; pass < r; pass++) {
    const square = pass % 2 === 1;
    b.fill(0);
    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const i = row + x;
        let v = op
          ? a[i] | a[i - 1] | a[i + 1] | a[i - W] | a[i + W]
          : a[i] & a[i - 1] & a[i + 1] & a[i - W] & a[i + W];
        if (square) v = op ? v | a[i - W - 1] | a[i - W + 1] | a[i + W - 1] | a[i + W + 1] : v & a[i - W - 1] & a[i - W + 1] & a[i + W - 1] & a[i + W + 1];
        b[i] = v;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/** Labels 4-connected components. @returns {{labels: Int32Array, sizes: number[]}} (labels from 1) */
function components(grid, W, H) {
  const labels = new Int32Array(W * H);
  const sizes = [0];
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!grid[i] || labels[i]) continue;
    const id = sizes.length;
    let n = 0;
    labels[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      n++;
      const x = j % W;
      if (x > 0 && grid[j - 1] && !labels[j - 1]) { labels[j - 1] = id; stack.push(j - 1); }
      if (x < W - 1 && grid[j + 1] && !labels[j + 1]) { labels[j + 1] = id; stack.push(j + 1); }
      if (j >= W && grid[j - W] && !labels[j - W]) { labels[j - W] = id; stack.push(j - W); }
      if (j < W * (H - 1) && grid[j + W] && !labels[j + W]) { labels[j + W] = id; stack.push(j + W); }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}

/**
 * Makes the grid one 4-connected piece: drops specks (< 6 cells, unless that is all there is) and
 * joins every other blob to the nearest already-joined blob with a capsule ("soft bridge") whose
 * radius grows with the smaller blob (2–8 cells).
 */
function joinComponents(grid, W, H) {
  const { labels, sizes } = components(grid, W, H);
  const n = sizes.length - 1;
  if (n <= 1) return;
  const biggest = sizes.indexOf(Math.max(...sizes.slice(1)));
  const keep = new Set();
  for (let id = 1; id <= n; id++) if (sizes[id] >= 6 || id === biggest) keep.add(id);
  for (let i = 0; i < W * H; i++) if (labels[i] && !keep.has(labels[i])) grid[i] = 0;
  if (keep.size <= 1) return;

  // Prim's algorithm on the grid: a multi-source breadth-first search (8-neighbour) from every
  // joined cell finds the nearest cell of a blob not yet joined, and remembers which joined cell it
  // came from; a capsule joins the two, and the new blob becomes a source too.
  const joined = new Uint8Array(sizes.length);
  joined[biggest] = 1;
  const src = new Int32Array(W * H);
  const seen = new Int32Array(W * H);
  const queue = new Int32Array(W * H);
  const target = new Uint8Array(sizes.length);
  for (const id of keep) target[id] = 1;
  target[biggest] = 0;
  for (let round = 1; round < keep.size; round++) {
    let head = 0, tail = 0, hit = -1;
    // seeds: boundary cells of the joined blobs (interior cells are never nearest)
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!grid[i] || !joined[labels[i]]) continue;
      seen[i] = round;
      if (grid[i - 1] && grid[i + 1] && grid[i - W] && grid[i + W]) continue;
      src[i] = i;
      queue[tail++] = i;
    }
    while (head < tail && hit < 0) {
      const j = queue[head++], x = j % W, y = (j - x) / W;
      for (let dy = -1; dy <= 1 && hit < 0; dy++) {
        const Y = y + dy;
        if (Y < 0 || Y >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          if (X < 0 || X >= W) continue;
          const q = Y * W + X;
          if (seen[q] === round) continue;
          seen[q] = round;
          src[q] = src[j];
          if (target[labels[q]] && grid[q]) { hit = q; break; }
          queue[tail++] = q;
        }
      }
    }
    if (hit < 0) break;
    const id = labels[hit], from = src[hit];
    const r = Math.max(2, Math.min(8, Math.round(Math.sqrt(sizes[id]) * 0.3)));
    capsule(grid, W, H, [from % W, Math.floor(from / W)], [hit % W, Math.floor(hit / W)], r);
    joined[id] = 1;
    target[id] = 0;
  }
}

function capsule(grid, W, H, [ax, ay], [bx, by], r) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const xa = Math.max(0, Math.min(ax, bx) - r), xb = Math.min(W - 1, Math.max(ax, bx) + r);
  const ya = Math.max(0, Math.min(ay, by) - r), yb = Math.min(H - 1, Math.max(ay, by) + r);
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const ex = x - (ax + dx * t), ey = y - (ay + dy * t);
    if (ex * ex + ey * ey <= r * r) grid[y * W + x] = 1;
  }
}

/** Fills every empty cell not 4-connected to the border. */
function fillHoles(grid, W, H) {
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;
  const push = (i) => { if (!grid[i] && !seen[i]) { seen[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top) {
    const j = stack[--top], x = j % W;
    if (x > 0) push(j - 1);
    if (x < W - 1) push(j + 1);
    if (j >= W) push(j - W);
    if (j < W * (H - 1)) push(j + W);
  }
  for (let i = 0; i < W * H; i++) if (!grid[i] && !seen[i]) grid[i] = 1;
}

/** Fills 2×2 blocks that touch only diagonally, so the boundary never pinches at a corner. */
function removeSaddles(grid, W, H) {
  let any = false;
  for (let pass = 0, changed = true; changed && pass < 8; pass++) {
    changed = false;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const a = grid[i], b = grid[i + 1], c = grid[i + W], d = grid[i + W + 1];
      if (a && d && !b && !c) { grid[i + 1] = grid[i + W] = 1; changed = true; }
      else if (b && c && !a && !d) { grid[i] = grid[i + W + 1] = 1; changed = true; }
    }
    any ||= changed;
  }
  return any;
}

/**
 * Traces the boundary of the (single, hole-free, saddle-free) region along cell edges, clockwise on
 * screen, and returns the midpoints of the edges (grid coords).
 */
function traceOuter(grid, W, H) {
  const V = W + 1;
  const next = new Int32Array(V * (H + 1)).fill(-1);
  let start = -1;
  const filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!filled(x, y)) continue;
    if (!filled(x, y - 1)) { next[y * V + x] = y * V + x + 1; if (start < 0) start = y * V + x; }
    if (!filled(x + 1, y)) next[y * V + x + 1] = (y + 1) * V + x + 1;
    if (!filled(x, y + 1)) next[(y + 1) * V + x + 1] = (y + 1) * V + x;
    if (!filled(x - 1, y)) next[(y + 1) * V + x] = y * V + x;
  }
  if (start < 0) return [];
  const out = [];
  let v = start, dir = 0;
  for (let guard = 0; guard < V * (H + 1); guard++) {
    const w = next[v];
    if (w < 0) break;
    const d = w - v;
    // midpoints along a straight run are collinear: keep only the ones next to a turn
    if (d !== dir || next[w] - w !== d) out.push([((v % V) + (w % V)) / 2, (Math.floor(v / V) + Math.floor(w / V)) / 2]);
    dir = d;
    v = w;
    if (v === start) break;
  }
  return out;
}
