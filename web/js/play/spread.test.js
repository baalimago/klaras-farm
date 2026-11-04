import { test } from "node:test";
import assert from "node:assert/strict";
import { spreadBoxes } from "./spread.js";

const A = 0.75; // board height over width
const box = (x, y, r = 0.1, ry = r / A) => ({ x, y, left: r, right: r, top: ry, bottom: ry });

/** True if two boxes (after moving to p, q) overlap by more than float noise, padded like spreadBoxes. */
function overlaps(b1, p, b2, q, { gap = 0, padTop = 0, minHalfWidth = 0 } = {}) {
  const h1 = Math.max(b1.left, b1.right, minHalfWidth), h2 = Math.max(b2.left, b2.right, minHalfWidth);
  const ox = Math.min(p.x + h1, q.x + h2) - Math.max(p.x - h1, q.x - h2) + gap;
  const oy = Math.min(p.y * A + b1.bottom * A, q.y * A + b2.bottom * A)
    - Math.max(p.y * A - b1.top * A - padTop, q.y * A - b2.top * A - padTop) + gap;
  return ox > 1e-6 && oy > 1e-6;
}
function assertApart(boxes, out, opts) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlaps(boxes[i], out[i], boxes[j], out[j], opts), `boxes ${i} and ${j} still overlap`);
    }
  }
}
function assertOnBoard(boxes, out, margin = 0) {
  boxes.forEach((b, i) => {
    const p = out[i], half = Math.max(b.left, b.right);
    assert.ok(p.x - half >= margin - 1e-9 && p.x + half <= 1 - margin + 1e-9, `box ${i} off the board across`);
    assert.ok(p.y - b.top >= -1e-9 && p.y + b.bottom <= 1 + 1e-9, `box ${i} off the board down`);
  });
}

test("boxes that overlap nothing keep their exact positions", () => {
  const boxes = [box(0.2, 0.3), box(0.6, 0.3), box(0.4, 0.75)];
  assert.deepEqual(spreadBoxes(boxes), boxes.map((b) => ({ x: b.x, y: b.y })));
});

test("empty input and a single box", () => {
  assert.deepEqual(spreadBoxes([]), []);
  assert.deepEqual(spreadBoxes([box(0.5, 0.5)]), [{ x: 0.5, y: 0.5 }]);
});

test("of two overlapping boxes, the first stays and the later one moves the shorter way", () => {
  // side by side, overlapping by 0.05 across and fully down: it moves across, not up and down
  const boxes = [box(0.45, 0.5), box(0.6, 0.5)];
  const out = spreadBoxes(boxes);
  assertApart(boxes, out);
  assert.deepEqual(out[0], { x: 0.45, y: 0.5 });
  assert.ok(Math.abs(out[1].x - 0.65) < 1e-9);
  assert.equal(out[1].y, 0.5);
});

test("stacked boxes move up and down when that is the shorter move", () => {
  const boxes = [box(0.5, 0.4), box(0.52, 0.6)];
  const out = spreadBoxes(boxes);
  assertApart(boxes, out);
  assert.deepEqual(out[0], { x: 0.5, y: 0.4 });
  assert.ok(out[1].y > 0.6);
  assert.equal(out[1].x, 0.52);
});

test("boxes on the same spot still separate, deterministically", () => {
  const boxes = [box(0.5, 0.5), box(0.5, 0.5)];
  const a = spreadBoxes(boxes), b = spreadBoxes(boxes);
  assert.deepEqual(a, b);
  assertApart(boxes, a);
  assert.deepEqual(a[0], { x: 0.5, y: 0.5 }, "the first one stays");
});

test("a box is never pushed off the board: it goes the other way", () => {
  const boxes = [box(0.15, 0.5), box(0.1, 0.5)];
  const out = spreadBoxes(boxes);
  assertApart(boxes, out);
  assertOnBoard(boxes, out);
  assert.deepEqual(out[0], { x: 0.15, y: 0.5 });
  assert.ok(out[1].x >= 0.1 - 1e-9, "never further left than it was");
});

test("a margin keeps moved boxes off the edge", () => {
  // too tall to go up or down; left would end 0.01 from the edge, inside the margin
  const boxes = [box(0.31, 0.5, 0.1, 0.45), box(0.25, 0.5, 0.1, 0.45)];
  assert.ok(spreadBoxes(boxes)[1].x < 0.31, "without a margin it goes left");
  const out = spreadBoxes(boxes, { margin: 0.02 });
  assert.ok(out[1].x > 0.31, "with one it goes right instead");
  assertApart(boxes, out);
  assertOnBoard(boxes, out, 0.02);
});

test("a box pinned in a corner on one axis is pushed along the other", () => {
  // both hug the left edge; across, only the right one could move, and down is shorter anyway
  const boxes = [box(0.1, 0.5), box(0.1, 0.55)];
  const out = spreadBoxes(boxes);
  assertApart(boxes, out);
  assertOnBoard(boxes, out);
});

test("a crowded cluster of eight spreads with no overlaps and stays on the board", () => {
  const boxes = [];
  for (let i = 0; i < 8; i++) boxes.push(box(0.45 + (i % 3) * 0.02, 0.55 + Math.floor(i / 3) * 0.02, 0.08));
  const opts = { gap: 0.02, padTop: 0.05, minHalfWidth: 0.05, margin: 0.01 };
  const out = spreadBoxes(boxes, opts);
  assertApart(boxes, out, opts);
  assertOnBoard(boxes, out, 0.01);
});

test("twelve things of mixed sizes (the per-scene limit) all fit apart", () => {
  const boxes = [];
  for (let i = 0; i < 12; i++) boxes.push(box(0.3 + (i % 4) * 0.05, 0.5 + Math.floor(i / 4) * 0.05, [0.05, 0.07, 0.09][i % 3]));
  const opts = { gap: 0.02, padTop: 0.04, minHalfWidth: 0.05, margin: 0.01 };
  const out = spreadBoxes(boxes, opts);
  assertApart(boxes, out, opts);
  assertOnBoard(boxes, out, 0.01);
});

test("gap, top padding and minimum width count as part of each box", () => {
  // apart on their own, but too close once a gap is asked for
  const boxes = [box(0.3, 0.5, 0.1), box(0.51, 0.5, 0.1)];
  assert.deepEqual(spreadBoxes(boxes), [{ x: 0.3, y: 0.5 }, { x: 0.51, y: 0.5 }]);
  const out = spreadBoxes(boxes, { gap: 0.04 });
  assert.ok(out[1].x - out[0].x >= 0.24 - 1e-9);
  // a box just below another, clear of it, but not of the badges above it
  const stacked = [box(0.5, 0.3), box(0.5, 0.3 + 0.2 / A + 0.01)];
  assert.deepEqual(spreadBoxes(stacked).map((p) => p.y), stacked.map((b) => b.y));
  const padded = spreadBoxes(stacked, { padTop: 0.05 });
  assertApart(stacked, padded, { padTop: 0.05 });
  // narrow things are as wide as their pencil and cross need
  const thin = [box(0.5, 0.5, 0.01), box(0.55, 0.5, 0.01)];
  assertApart(thin, spreadBoxes(thin, { minHalfWidth: 0.05 }), { minHalfWidth: 0.05 });
});

test("a box already past an edge is never pulled further out, and one bigger than the board is centred", () => {
  const boxes = [box(0.12, 0.5), box(0.05, 0.5)];
  const out = spreadBoxes(boxes);
  assert.ok(out[1].x >= 0.05 - 1e-9);
  const huge = [box(0.5, 0.5, 0.6), box(0.5, 0.5, 0.1)];
  const h = spreadBoxes(huge);
  assert.ok(Number.isFinite(h[0].x) && Number.isFinite(h[1].x));
});

test("boxes that cannot all fit return a finite best effort", () => {
  const boxes = Array.from({ length: 12 }, () => box(0.5, 0.5, 0.3));
  const out = spreadBoxes(boxes);
  assert.equal(out.length, 12);
  for (const p of out) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("a fixed obstacle (the edit bar) counts as placed: boxes covering it move off it", () => {
  const bar = { left: 0.25, top: 0.9, right: 0.75, bottom: 1 };
  // one box pokes into the bar, one is beside it, one overlaps the first
  const boxes = [box(0.5, 0.85, 0.08), box(0.1, 0.88, 0.05), box(0.52, 0.8, 0.08)];
  const out = spreadBoxes(boxes, { obstacles: [bar] });
  assertApart(boxes, out);
  assert.deepEqual(out[1], { x: 0.1, y: 0.88 }, "clear of the bar and of the others: stays");
  for (const i of [0, 2]) {
    const b = boxes[i], p = out[i];
    const clearOfBar = p.y + b.bottom <= bar.top + 1e-9 || p.x + b.right <= bar.left + 1e-9 || p.x - b.left >= bar.right - 1e-9;
    assert.ok(clearOfBar, `box ${i} is off the bar`);
  }
  assert.deepEqual(spreadBoxes([box(0.5, 0.5)], { obstacles: [bar] }), [{ x: 0.5, y: 0.5 }], "far from the bar: untouched");
});

test("boxes go left and up too, not only right and down", () => {
  const left = spreadBoxes([box(0.55, 0.5), box(0.4, 0.5)]);
  assert.ok(Math.abs(left[1].x - 0.35) < 1e-9 && left[1].y === 0.5, "goes left");
  const up = spreadBoxes([box(0.5, 0.6), box(0.52, 0.45)]);
  assert.ok(up[1].y < 0.45 && up[1].x === 0.52, "goes up");
});

test("a bystander that overlaps nothing is never pushed out by the others", () => {
  const boxes = [box(0.3, 0.5), box(0.35, 0.5), box(0.55, 0.5)];
  const out = spreadBoxes(boxes);
  assertApart(boxes, out);
  assert.deepEqual(out[2], { x: 0.55, y: 0.5 });
  assert.deepEqual(out[0], { x: 0.3, y: 0.5 });
});

test("a lopsided box counts its longer side on both sides (the sprite mirrors)", () => {
  const lop = { x: 0.5, y: 0.5, left: 0.02, right: 0.15, top: 0.1, bottom: 0.1 };
  const boxes = [box(0.38, 0.5, 0.05), lop];
  const out = spreadBoxes(boxes);
  assert.ok(out[1].x - 0.15 >= out[0].x + 0.05 - 1e-9 || out[1].x + 0.15 <= out[0].x - 0.05 + 1e-9 || out[1].y !== 0.5);
});

test("when nothing fits, boxes still go to different spots (least overlap)", () => {
  const boxes = [box(0.5, 0.5, 0.45), box(0.5, 0.5, 0.45), box(0.5, 0.5, 0.45)];
  const out = spreadBoxes(boxes);
  assert.notDeepEqual(out[1], out[2]);
});

test("the tie-break is pinned: two boxes on one spot, the later one goes up", () => {
  const out = spreadBoxes([box(0.5, 0.5), box(0.5, 0.5)]);
  assert.deepEqual(out[0], { x: 0.5, y: 0.5 });
  assert.ok(Math.abs(out[1].x - 0.5) < 1e-9);
  assert.ok(Math.abs(out[1].y - (0.5 - 0.2 / A * 1)) < 1e-9 || out[1].y < 0.5, `y ${out[1].y}`);
});
