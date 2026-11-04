import { test } from "node:test";
import assert from "node:assert/strict";
import { ShapeDrawing, MAX_SHAPES, DRAWING_SIZE, transformPoints, clampScale } from "./drawing.js";
import { bbox, pointInPolygon } from "../../geometry/stroke.js";

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("shapes add up to one merged outline; undo takes the last one off", () => {
  const d = new ShapeDrawing();
  assert.deepEqual(d.merged, []);
  assert.equal(d.canUndo, false);
  assert.equal(d.add(rect(0.2, 0.3, 0.3, 0.3)), true);
  assert.deepEqual(d.merged, rect(0.2, 0.3, 0.3, 0.3), "one shape is kept as drawn");
  d.add(rect(0.45, 0.2, 0.15, 0.15));
  const m = d.merged;
  assert.ok(pointInPolygon([0.3, 0.5], m) && pointInPolygon([0.55, 0.25], m));
  assert.equal(d.merged, m, "cached");
  assert.equal(d.canUndo, true);
  d.undo();
  assert.equal(d.count, 1);
  assert.deepEqual(d.merged, rect(0.2, 0.3, 0.3, 0.3));
  d.undo();
  assert.equal(d.undo(), false);
});

test("start over is a change too, and undo brings the shapes back", () => {
  const d = new ShapeDrawing([rect(0.2, 0.3, 0.3, 0.3)]);
  assert.equal(d.canUndo, false, "the starting shapes are not a change");
  assert.equal(d.clear(), true);
  assert.equal(d.count, 0);
  assert.equal(d.clear(), false, "nothing to clear");
  assert.equal(d.undo(), true);
  assert.equal(d.count, 1);
});

test("at most MAX_SHAPES shapes; degenerate strokes are refused", () => {
  const d = new ShapeDrawing();
  for (let i = 0; i < MAX_SHAPES; i++) assert.equal(d.add(rect(0.1 + i * 0.05, 0.4, 0.1, 0.1)), true);
  assert.equal(d.full, true);
  assert.equal(d.add(rect(0.5, 0.5, 0.1, 0.1)), false);
  assert.equal(d.count, MAX_SHAPES);
  assert.equal(new ShapeDrawing().add([[0, 0], [1, 1]]), false);
});

test("an existing outline becomes shape 1 at drawing size", () => {
  const d = ShapeDrawing.fromOutline(rect(0.1, 0.5, 0.16, 0.2));
  assert.equal(d.count, 1);
  const b = bbox(d.shapes[0]);
  assert.ok(near(b.h, DRAWING_SIZE.h) || near(b.w, DRAWING_SIZE.w), JSON.stringify(b));
  assert.ok(near(b.x + b.w / 2, DRAWING_SIZE.cx));
  assert.equal(ShapeDrawing.fromOutline(null).count, 0);
});

test("a shape can be moved, resized, redrawn and deleted; undo reverts each", () => {
  const d = new ShapeDrawing([rect(0.2, 0.3, 0.3, 0.3), rect(0.45, 0.2, 0.1, 0.1)]);
  assert.equal(d.transform(1, { dx: 0.1, dy: -0.05 }), true);
  const moved = bbox(d.shapes[1]);
  assert.ok(near(moved.x, 0.55) && near(moved.y, 0.15) && near(moved.w, 0.1), JSON.stringify(moved));
  assert.equal(d.transform(1, { k: 2 }), true);
  const b = bbox(d.shapes[1]);
  assert.ok(near(b.w, 0.2) && near(b.x + b.w / 2, 0.6), JSON.stringify(b));
  assert.equal(d.transform(1, {}), false, "no change is not a change");
  assert.equal(d.transform(5, { dx: 1 }), false);
  d.undo();
  d.undo();
  assert.deepEqual(d.shapes[1], rect(0.45, 0.2, 0.1, 0.1));

  assert.equal(d.replace(1, rect(0.1, 0.1, 0.1, 0.1)), true);
  assert.deepEqual(d.shapes[1], rect(0.1, 0.1, 0.1, 0.1));
  assert.equal(d.replace(1, [[0, 0]]), false);
  assert.equal(d.replace(9, rect(0, 0, 1, 1)), false);
  assert.equal(d.remove(0), true);
  assert.equal(d.count, 1);
  assert.equal(d.remove(3), false);
  d.undo();
  d.undo();
  assert.deepEqual(d.shapes, [rect(0.2, 0.3, 0.3, 0.3), rect(0.45, 0.2, 0.1, 0.1)]);
});

test("the merged drawing without one shape is cached for drag previews", () => {
  const d = new ShapeDrawing([rect(0.2, 0.3, 0.3, 0.3), rect(0.45, 0.2, 0.1, 0.1)]);
  const w = d.mergedWithout(1);
  assert.deepEqual(w, rect(0.2, 0.3, 0.3, 0.3));
  assert.equal(d.mergedWithout(1), w, "cached");
  assert.notEqual(d.mergedWithout(0), w);
  d.transform(0, { dx: 0.01 });
  assert.notEqual(d.mergedWithout(1), w, "cache dropped on change");
});

test("hit finds the smallest shape under a point", () => {
  const d = new ShapeDrawing([rect(0.2, 0.3, 0.3, 0.3), rect(0.3, 0.4, 0.05, 0.05)]);
  assert.equal(d.hit([0.25, 0.35]), 0);
  assert.equal(d.hit([0.32, 0.42]), 1);
  assert.equal(d.hit([0.9, 0.9]), -1);
  assert.equal(d.hit([0.51, 0.35], 0.02), 0, "near the edge counts");
});

test("an open stroke whose ends are in the body joins it as a new shape", () => {
  const d = new ShapeDrawing([rect(0.3, 0.4, 0.4, 0.3)]);
  const ear = [[0.45, 0.45], [0.45, 0.3], [0.55, 0.3], [0.55, 0.45]];
  assert.equal(d.addOpen(ear), true);
  assert.equal(d.count, 2);
  assert.ok(pointInPolygon([0.5, 0.33], d.merged));
  assert.equal(d.addOpen([[0.5, 0.5], [0.9, 0.1]]), false, "an end outside every shape");
  // redrawing shape 1 with an open stroke: its ends must be in another shape
  assert.equal(d.addOpen(ear, { replace: 1 }), true);
  assert.equal(d.count, 2);
  assert.equal(d.addOpen([[0.35, 0.6], [0.2, 0.8], [0.65, 0.6]], { replace: 0 }), false, "only the body holds the ends, and it is the one replaced");
  const full = new ShapeDrawing(Array.from({ length: MAX_SHAPES }, () => rect(0.3, 0.4, 0.4, 0.3)));
  assert.equal(full.addOpen(ear), false);
});

test("transformPoints scales about the shape's centre, then moves it; clampScale keeps it a sane size", () => {
  const r = rect(0.4, 0.4, 0.2, 0.2);
  const t = transformPoints(r, { k: 0.5, dx: 0.1 });
  const b = bbox(t);
  assert.ok(near(b.w, 0.1) && near(b.x + b.w / 2, 0.6) && near(b.y + b.h / 2, 0.5));
  assert.deepEqual(transformPoints(r, {}), r);
  assert.equal(clampScale(r, 1.5), 1.5);
  assert.ok(near(clampScale(r, 100), 1.2 / 0.2));
  assert.ok(near(clampScale(r, 0.01), 0.04 / 0.2));
  assert.equal(clampScale(r, NaN), 1);
});
