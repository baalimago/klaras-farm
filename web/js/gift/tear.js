// Tearing paper, as pure geometry. A finger pokes a hole, then drags: the tear follows the finger
// as a strip with ragged edges, narrow where it started and full width after a short pull. Every
// step returns pieces to cut out of the paper: `cut` is the hole, `rim` a slightly larger ragged
// outline whose border shows the paper's white back (painted on the paper that is left).
//
// Coverage keeps a coarse grid of the viewport (normalized, so it survives a rotation) to say how
// much of the paper is gone without reading pixels back from the GPU.
//
// Points are CSS pixels. `rng` is injected (a function returning [0, 1)), so tests are exact.

/** @typedef {{x: number, y: number}} Pt */
/** @typedef {{cut: Pt[], rim: Pt[]}} Piece */
/**
 * @typedef {{start: Pt, last: Pt, dir: Pt|null, half: number, width: number, travelled: number,
 *   left: Pt[], right: Pt[], rimLeft: Pt[], rimRight: Pt[]}} Tear
 *   half: full half-width of the strip; width: the current half-width (it ramps up from the poke)
 */

export const GRID_COLS = 40;
export const GRID_ROWS = 30;

/** Half-width of a full strip for a viewport: big enough for a toddler's pull to clear a lot. */
export function tearSize(w, h) {
  return Math.max(28, Math.min(w, h) * 0.08);
}

/** The white border of a tear, in px. */
function rimWidth(half) {
  return Math.max(3, half * 0.07);
}

/** A ragged round hole of radius about `r` at (x, y). */
export function poke(x, y, r, rng) {
  return blob(x, y, r, rimWidth(r * 1.6), rng, 11);
}

/**
 * Start a tear where the finger came down: a small poke hole, and a tear with no strip yet.
 * @returns {{tear: Tear, pieces: Piece[]}}
 */
export function startTear(x, y, half, rng) {
  const tear = { start: { x, y }, last: { x, y }, dir: null, half, width: half * RAMP_FROM, travelled: 0, left: [], right: [], rimLeft: [], rimRight: [] };
  return { tear, pieces: [poke(x, y, half * 0.55, rng)] };
}

const RAMP_FROM = 0.45;

/**
 * Pull the tear towards (x, y). It advances in even steps, so a fast flick and a slow drag make the
 * same kind of edge; a move shorter than one step changes nothing yet.
 * @param {Tear} tear
 * @returns {{tear: Tear, pieces: Piece[]}}  a new tear (the old one is not changed)
 */
export function tearTo(tear, x, y, rng) {
  const step = Math.max(8, tear.half * 0.3);
  const rim = rimWidth(tear.half);
  const pieces = [];
  const left = [], right = [], rimLeft = [], rimRight = [];
  let { last, dir, travelled, width } = tear;
  for (;;) {
    const dx = x - last.x, dy = y - last.y;
    const d = Math.hypot(dx, dy);
    if (d < step) break;
    const u = { x: dx / d, y: dy / d };
    const n = { x: -u.y, y: u.x };
    const p = { x: last.x + u.x * step, y: last.y + u.y * step };
    travelled += step;
    width = tear.half * Math.min(1, RAMP_FROM + travelled / (tear.half * 3));
    const wl = width * wobble(rng), wr = width * wobble(rng);
    const L = along(p, n, wl), R = along(p, n, -wr);
    const RL = along(p, n, wl + rim * fibre(rng)), RR = along(p, n, -(wr + rim * fibre(rng)));
    const prevL = left.at(-1) ?? tear.left.at(-1) ?? along(last, n, width * 0.6);
    const prevR = right.at(-1) ?? tear.right.at(-1) ?? along(last, n, -width * 0.6);
    const prevRL = rimLeft.at(-1) ?? tear.rimLeft.at(-1) ?? along(last, n, width * 0.6 + rim);
    const prevRR = rimRight.at(-1) ?? tear.rimRight.at(-1) ?? along(last, n, -(width * 0.6 + rim));
    pieces.push({ cut: [prevL, L, R, prevR], rim: [prevRL, RL, RR, prevRR] });
    pieces.push(blob(p.x, p.y, width * 0.92, rim, rng, 9)); // fills the wedge on the outside of a turn
    left.push(L); right.push(R); rimLeft.push(RL); rimRight.push(RR);
    last = p;
    dir = u;
  }
  if (!pieces.length) return { tear, pieces };
  const next = {
    ...tear, last, dir, travelled, width,
    left: tear.left.concat(left), right: tear.right.concat(right),
    rimLeft: tear.rimLeft.concat(rimLeft), rimRight: tear.rimRight.concat(rimRight),
  };
  return { tear: next, pieces };
}

/** The strip torn off so far, as one outline (null before the first step). */
export function stripOf(tear) {
  if (!tear.left.length) return null;
  return [tear.start, ...tear.left, ...tear.right.slice().reverse()];
}

function along(p, n, k) {
  return { x: p.x + n.x * k, y: p.y + n.y * k };
}

function wobble(rng) {
  return 0.82 + rng() * 0.36;
}

function fibre(rng) {
  return 0.5 + rng() * 1.4;
}

function blob(cx, cy, r, rim, rng, sides) {
  const cut = [], ring = [];
  const a0 = rng() * Math.PI * 2;
  for (let i = 0; i < sides; i++) {
    const a = a0 + (i + (rng() - 0.5) * 0.5) * ((Math.PI * 2) / sides);
    const rr = r * (0.78 + rng() * 0.36);
    const c = Math.cos(a), s = Math.sin(a);
    cut.push({ x: cx + c * rr, y: cy + s * rr });
    const ro = rr + rim * fibre(rng);
    ring.push({ x: cx + c * ro, y: cy + s * ro });
  }
  return { cut, rim: ring };
}

// ------------------------------------------------------------------ coverage

/** @typedef {{cols: number, rows: number, cells: Uint8Array, count: number}} Coverage */

/** @returns {Coverage} */
export function createCoverage(cols = GRID_COLS, rows = GRID_ROWS) {
  return { cols, rows, cells: new Uint8Array(cols * rows), count: 0 };
}

/**
 * Mark the cells whose centre lies inside `poly` (px, in a w × h viewport) as torn away.
 * Changes `cov` in place (a grid per cut would be wasteful) and returns its new count.
 */
export function cover(cov, poly, w, h) {
  if (poly.length < 3 || w <= 0 || h <= 0) return cov.count;
  const cw = w / cov.cols, ch = h / cov.rows;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const c0 = Math.max(0, Math.floor(minX / cw)), c1 = Math.min(cov.cols - 1, Math.floor(maxX / cw));
  const r0 = Math.max(0, Math.floor(minY / ch)), r1 = Math.min(cov.rows - 1, Math.floor(maxY / ch));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * cov.cols + c;
      if (cov.cells[i]) continue;
      if (!inside((c + 0.5) * cw, (r + 0.5) * ch, poly)) continue;
      cov.cells[i] = 1;
      cov.count++;
    }
  }
  return cov.count;
}

/** The share of the paper torn away, 0 to 1. */
export function clearedFraction(cov) {
  return cov.count / (cov.cols * cov.rows);
}

/** Even-odd point in polygon. */
export function inside(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Scale points from one viewport size to another (a rotation or resize keeps the tears in place). */
export function scalePoints(points, sx, sy) {
  return points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}
