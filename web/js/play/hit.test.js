import { test } from "node:test";
import assert from "node:assert/strict";
import { hitTest, pointInPolygon, centroid, extents } from "./hit.js";

const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
const target = (id, cx, cy, r) => ({ id, poly: sq(cx, cy, r), x: cx, y: cy });

test("pointInPolygon on a square and a concave L", () => {
  assert.ok(pointInPolygon([0.5, 0.5], sq(0.5, 0.5, 0.1)));
  assert.ok(!pointInPolygon([0.7, 0.5], sq(0.5, 0.5, 0.1)));
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  assert.ok(pointInPolygon([0.5, 1.5], L));
  assert.ok(!pointInPolygon([1.5, 1.5], L));
});

test("the outline counts 1.3× about its anchor", () => {
  const t = [target("a", 0.5, 0.5, 0.1)];
  assert.equal(hitTest(t, [0.62, 0.5]), "a");
  assert.equal(hitTest(t, [0.629, 0.5]), "a");
  assert.equal(hitTest(t, [0.64, 0.5]), null);
  assert.equal(hitTest(t, [0.64, 0.5], { scale: 1 }), null);
  assert.equal(hitTest(t, [0.605, 0.5], { scale: 1 }), null);
});

test("a tiny thing still has the minimum radius (round on screen for a 4:3 board)", () => {
  const t = [target("bug", 0.5, 0.5, 0.005)];
  assert.equal(hitTest(t, [0.54, 0.5], { minRadius: 0.05 }), "bug");
  assert.equal(hitTest(t, [0.56, 0.5], { minRadius: 0.05 }), null);
  // 0.06 of board height is 0.045 of board width: inside a 0.05 radius.
  assert.equal(hitTest(t, [0.5, 0.56], { minRadius: 0.05 }), "bug");
  assert.equal(hitTest(t, [0.5, 0.57], { minRadius: 0.05 }), null);
});

test("overlaps: topmost (last drawn) wins, then nearest centre", () => {
  const back = target("back", 0.5, 0.5, 0.1), front = target("front", 0.55, 0.5, 0.1);
  assert.equal(hitTest([back, front], [0.52, 0.5]), "front");
  assert.equal(hitTest([front, back], [0.52, 0.5]), "back");
  const a = target("a", 0.3, 0.5, 0.002), b = target("b", 0.36, 0.5, 0.002);
  assert.equal(hitTest([a, b], [0.32, 0.5], { minRadius: 0.06 }), "a");
  assert.equal(hitTest([a, b], [0.345, 0.5], { minRadius: 0.06 }), "b");
});

test("no targets, no hit", () => {
  assert.equal(hitTest([], [0.5, 0.5], { minRadius: 1 }), null);
});

test("centroid is area weighted and extents are measured from it", () => {
  const c = centroid(sq(0.4, 0.6, 0.1));
  assert.ok(Math.abs(c[0] - 0.4) < 1e-12 && Math.abs(c[1] - 0.6) < 1e-12);
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const [lx, ly] = centroid(L);
  assert.ok(Math.abs(lx - 5 / 6) < 1e-9 && Math.abs(ly - 5 / 6) < 1e-9);
  assert.deepEqual(centroid([[0, 0], [1, 0], [2, 0]]), [1, 0], "degenerate falls back to the vertex mean");
  const e = extents(sq(0.4, 0.6, 0.1), 0.4, 0.6);
  for (const k of ["left", "right", "top", "bottom"]) assert.ok(Math.abs(e[k] - 0.1) < 1e-12);
});
