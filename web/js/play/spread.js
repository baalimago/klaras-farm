// Spreading boxes apart (pure): edit mode moves things off each other so every thing, and the
// pencil and cross above it, can be reached with a finger (owner request after meeting 2:
// "avoid collisions of the animals by moving each outside their bounding boxes").
//
// Contract: spreadBoxes(boxes, opts) returns one {x, y} per box, in the same board coordinates
// (x across the width, y down the height, both 0..1). Boxes that overlap nothing keep their exact
// position. The rest are placed one by one, in input order: each keeps its spot if that is free,
// otherwise it goes to the nearest free spot beside the boxes already placed, on the board. It is
// deterministic (same input, same output) and bounded (about n^3 candidate checks, n <= 12). When
// a box fits nowhere, it goes where it overlaps least.
//
// Why greedy placement instead of pushing pairs apart: pushes along the shorter axis jam when a
// row of things is wider than the board (each push undoes the last), which is exactly the crowded
// scene this is for.

/** Board height over width (the board is 4:3); distances are measured in board widths. */
const ASPECT = 0.75;
const EPS = 1e-9;

/**
 * @typedef {{x: number, y: number, left: number, right: number, top: number, bottom: number}} SpreadBox
 *   anchor (x, y) and the extents of the thing around it, all in board coordinates
 * @param {SpreadBox[]} boxes
 * @param {{gap?: number, padTop?: number, minHalfWidth?: number, margin?: number, bottomInset?: number}=} opts
 *   gap: space between neighbours, in board widths; padTop: extra room above each box (its badges),
 *   in board widths; minHalfWidth: boxes are treated as at least this wide each side of the anchor;
 *   margin: how close a moved box may come to the board edge, in board widths; bottomInset: extra
 *   room a moved box keeps from the bottom edge (a toolbar there), in board widths.
 * @returns {{x: number, y: number}[]}
 */
export function spreadBoxes(boxes, { gap = 0, padTop = 0, minHalfWidth = 0, margin = 0, bottomInset = 0 } = {}) {
  // Board widths on both axes, so "nearest" means nearest on screen.
  const r = boxes.map((b) => {
    const half = Math.max(b.left, b.right, minHalfWidth); // the sprite mirrors when it turns
    const top = b.top * ASPECT, bottom = b.bottom * ASPECT;
    const yLo = top + margin, yHi = ASPECT - bottom - margin - bottomInset;
    const xLo = half + margin, xHi = 1 - half - margin;
    return {
      src: b, moved: false, x0: b.x, y0: b.y * ASPECT, x: b.x, y: b.y * ASPECT,
      // padded edges around the anchor: the gap, and the badges above
      l: half + gap / 2, rt: half + gap / 2, t: top + padTop + gap / 2, b: bottom + gap / 2,
      xLo: xLo <= xHi ? xLo : (xLo + xHi) / 2, xHi: xLo <= xHi ? xHi : (xLo + xHi) / 2,
      yLo: yLo <= yHi ? yLo : (yLo + yHi) / 2, yHi: yLo <= yHi ? yHi : (yLo + yHi) / 2,
    };
  });
  const placed = [];
  const waiting = [];
  r.forEach((a, i) => {
    if (r.every((o, j) => j === i || overlapArea(a, a.x, a.y, o) <= EPS)) placed.push(a);
    else waiting.push(a);
  });
  for (const a of waiting) {
    place(a, placed);
    placed.push(a);
  }
  // unmoved boxes return their input exactly (no float round trip)
  return r.map((a) => (a.moved ? { x: a.x, y: a.y / ASPECT } : { x: a.src.x, y: a.src.y }));
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
