import { test } from "node:test";
import assert from "node:assert/strict";
import { bbox, centroid, pointInPolygon, snapInside, fitOutline, polygonArea } from "./shape.js";

const sq = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]];
const ell = Array.from({ length: 40 }, (_, i) => [0.5 + 0.2 * Math.cos((i / 40) * 2 * Math.PI), 0.5 + 0.1 * Math.sin((i / 40) * 2 * Math.PI)]);
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("bbox, area and centroid of a square", () => {
  const b = bbox(sq);
  assert.ok(near(b.x, 0.4) && near(b.y, 0.4) && near(b.w, 0.2) && near(b.h, 0.2));
  assert.ok(near(Math.abs(polygonArea(sq)), 0.04));
  const [cx, cy] = centroid(sq);
  assert.ok(near(cx, 0.5) && near(cy, 0.5));
});

test("pointInPolygon", () => {
  assert.equal(pointInPolygon([0.5, 0.5], sq), true);
  assert.equal(pointInPolygon([0.7, 0.5], sq), false);
});

test("snapInside keeps inside points and moves outside points strictly inside, near the edge", () => {
  assert.deepEqual(snapInside([0.45, 0.5], sq), [0.45, 0.5]);
  for (const pt of [[0.9, 0.5], [0, 0], [0.5, 1], [0.1, 0.45]]) {
    const s = snapInside(pt, ell);
    assert.ok(pointInPolygon(s, ell), `snapped ${pt} → ${s}`);
  }
  const s = snapInside([0.9, 0.5], sq);
  assert.ok(pointInPolygon(s, sq) && s[0] > 0.55);
});

test("fitOutline scales to the box, keeps aspect and centres on the spot", () => {
  const big = [[0, 0], [0.8, 0], [0.8, 0.4], [0, 0.4]];
  const out = fitOutline(big, { maxW: 0.2, maxH: 0.3, cx: 0.3, cy: 0.6 });
  const b = bbox(out);
  assert.ok(near(b.w, 0.2));
  assert.ok(near(b.h, 0.1));
  assert.ok(near(b.x + b.w / 2, 0.3) && near(b.y + b.h / 2, 0.6));
});

test("fitOutline keeps the thing on the board", () => {
  const out = fitOutline(sq, { maxW: 0.2, maxH: 0.2, cx: 0.98, cy: 0.99 });
  for (const [x, y] of out) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
});
