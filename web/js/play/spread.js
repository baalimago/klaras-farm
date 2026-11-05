// Spreading boxes apart (pure): edit mode moves things off each other so every thing, and the
// pencil and cross above it, can be reached with a finger (owner request after meeting 2:
// "avoid collisions of the animals by moving each outside their bounding boxes").
//
// Contract: spreadBoxes(boxes, opts) returns one {x, y} per box, in the same board coordinates
// (x across the width, y down the height, both 0..1). Boxes that overlap nothing keep their exact
// position. The rest are placed one by one, in input order: each keeps its spot if that is free,
// otherwise it goes to the nearest free spot beside the boxes already placed, on the board and
// clear of fixed obstacles (the edit bar), and never above its `floor` (a walker stays on the
// ground). It is deterministic (same input, same output) and bounded (about n^3 candidate checks,
// n <= 12). When a box fits nowhere, it goes where it overlaps least.
// crowding(box, others, opts) is the same overlap test for one box where it stands: 0 exactly when
// spreadBoxes would leave it there (play/placement.js uses it to pick a spot the spread keeps).
//
// Why greedy placement instead of pushing pairs apart: pushes along the shorter axis jam when a
// row of things is wider than the board (each push undoes the last), which is exactly the crowded
// scene this is for.

/** Board height over width (the board is 4:3); distances are measured in board widths. */
const ASPECT = 0.75;
const EPS = 1e-9;

// Room around each thing in edit mode, in board widths: its pencil and cross (52 px) sit centred
// on its top edge, at most 70 px each side of the middle. The edit bar (kf-edit-layer.css: centred,
// about 545 px of the 1094 px board, its top 76 px above the board's bottom) is an obstacle: a
// thing under it moves up. Used by the world's edit-mode spread and by placement.
export const EDIT_SPREAD = Object.freeze({
  gap: 0.015, padTop: 0.03, minHalfWidth: 0.055, margin: 0.01,
  obstacles: Object.freeze([Object.freeze({ left: 0.24, top: 0.9, right: 0.76, bottom: 1 })]),
});

/**
 * @typedef {{x: number, y: number, left: number, right: number, top: number, bottom: number, floor?: number}} SpreadBox
 *   anchor (x, y) and the extents of the thing around it, all in board coordinates; floor: the
 *   highest the anchor may be moved to (a walker's feet stay in the ground band), none by default
 * @param {SpreadBox[]} boxes
 * @typedef {{left: number, top: number, right: number, bottom: number}} SpreadObstacle
 *   a fixed rectangle no box may cover (a toolbar over the board), in board coordinates
 * @param {{gap?: number, padTop?: number, minHalfWidth?: number, margin?: number, obstacles?: SpreadObstacle[]}=} opts
 *   gap: space between neighbours, in board widths; padTop: extra room above each box (its badges),
 *   in board widths; minHalfWidth: boxes are treated as at least this wide each side of the anchor;
 *   margin: how close a moved box may come to the board edge, in board widths; obstacles: fixed
 *   rectangles that count as already placed (a box covering one moves, like a box covering a box).
 * @returns {{x: number, y: number}[]}
 */
export function spreadBoxes(boxes, { gap = 0, padTop = 0, minHalfWidth = 0, margin = 0, obstacles = [] } = {}) {
  const r = boxes.map((b) => padded(b, { gap, padTop, minHalfWidth, margin }));
  const fixed = obstacles.map((o) => paddedObstacle(o, gap));
  const placed = [...fixed];
  const waiting = [];
  r.forEach((a, i) => {
    const clear = (o, j) => j === i || overlapArea(a, a.x, a.y, o) <= EPS;
    if (r.every(clear) && fixed.every((o) => overlapArea(a, a.x, a.y, o) <= EPS)) placed.push(a);
    else waiting.push(a);
  });
  for (const a of waiting) {
    place(a, placed);
    placed.push(a);
  }
  // unmoved boxes return their input exactly (no float round trip)
  return r.map((a) => (a.moved ? { x: a.x, y: a.y / ASPECT } : { x: a.src.x, y: a.src.y }));
}

/**
 * How much `box`, where it stands, overlaps the boxes in `others` and the obstacles, padded as
 * spreadBoxes pads them (area in board widths squared). 0 means spreadBoxes leaves it there.
 * @param {SpreadBox} box
 * @param {SpreadBox[]} others
 * @param {{gap?: number, padTop?: number, minHalfWidth?: number, obstacles?: SpreadObstacle[]}=} opts
 */
export function crowding(box, others, { gap = 0, padTop = 0, minHalfWidth = 0, obstacles = [] } = {}) {
  const pad = { gap, padTop, minHalfWidth, margin: 0 };
  const a = padded(box, pad);
  let hit = 0;
  for (const o of others) hit += overlapArea(a, a.x, a.y, padded(o, pad));
  for (const o of obstacles) hit += overlapArea(a, a.x, a.y, paddedObstacle(o, gap));
  return hit;
}

/** A box in board widths on both axes (so "nearest" means nearest on screen), padded, with its limits. */
function padded(b, { gap, padTop, minHalfWidth, margin }) {
  const half = Math.max(b.left, b.right, minHalfWidth); // the sprite mirrors when it turns
  const top = b.top * ASPECT, bottom = b.bottom * ASPECT;
  const yLo = Math.max(top + margin, Number.isFinite(b.floor) ? b.floor * ASPECT : -Infinity), yHi = ASPECT - bottom - margin;
  const xLo = half + margin, xHi = 1 - half - margin;
  return {
    src: b, moved: false, x0: b.x, y0: b.y * ASPECT, x: b.x, y: b.y * ASPECT,
    // padded edges around the anchor: the gap, and the badges above
    l: half + gap / 2, rt: half + gap / 2, t: top + padTop + gap / 2, b: bottom + gap / 2,
    xLo: xLo <= xHi ? xLo : (xLo + xHi) / 2, xHi: xLo <= xHi ? xHi : (xLo + xHi) / 2,
    yLo: yLo <= yHi ? yLo : (yLo + yHi) / 2, yHi: yLo <= yHi ? yHi : (yLo + yHi) / 2,
  };
}

function paddedObstacle(o, gap) {
  return {
    x: (o.left + o.right) / 2, y: ((o.top + o.bottom) / 2) * ASPECT,
    l: (o.right - o.left) / 2 + gap / 2, rt: (o.right - o.left) / 2 + gap / 2,
    t: ((o.bottom - o.top) / 2) * ASPECT + gap / 2, b: ((o.bottom - o.top) / 2) * ASPECT + gap / 2,
  };
}

/** Overlap area of box a (anchored at x, y) with box o where o now is; 0 when apart. */
function overlapArea(a, x, y, o) {
  const ox = Math.min(x + a.rt, o.x + o.rt) - Math.max(x - a.l, o.x - o.l);
  const oy = Math.min(y + a.b, o.y + o.b) - Math.max(y - a.t, o.y - o.t);
  return ox > EPS && oy > EPS ? ox * oy : 0;
}

/** Moves a to the nearest free spot among its own and spots flush beside the placed boxes. */
function place(a, placed) {
  // Its own spot first (it may be free now that only some boxes are placed), on the board.
  const xs = [a.x0, a.xLo, a.xHi], ys = [a.y0, a.yLo, a.yHi];
  for (const o of placed) {
    xs.push(o.x - o.l - a.rt, o.x + o.rt + a.l);
    ys.push(o.y - o.t - a.b, o.y + o.b + a.t);
  }
  let best = null, bestD = Infinity, bestHit = Infinity;
  for (const cx of xs) {
    const x = clamp(cx, a.xLo, a.xHi, a.x0);
    for (const cy of ys) {
      const y = clamp(cy, a.yLo, a.yHi, a.y0);
      let hit = 0;
      for (const o of placed) hit += overlapArea(a, x, y, o);
      const d = (x - a.x0) ** 2 + (y - a.y0) ** 2;
      // free beats overlapping; then nearest; the first found wins a tie (deterministic)
      if (hit < bestHit - EPS || (Math.abs(hit - bestHit) <= EPS && d < bestD - EPS)) {
        best = [x, y]; bestD = d; bestHit = hit;
      }
    }
  }
  a.moved = Math.abs(best[0] - a.x0) > EPS || Math.abs(best[1] - a.y0) > EPS;
  a.x = best[0];
  a.y = best[1];
}

/** Clamps onto the board; a box already beyond an edge may stay there but never goes further out. */
function clamp(v, lo, hi, from) {
  const l = Math.min(lo, from), h = Math.max(hi, from);
  return v < l ? l : v > h ? h : v;
}
