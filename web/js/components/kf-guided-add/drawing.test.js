import { test } from "node:test";
import assert from "node:assert/strict";
import { ShapeDrawing, MAX_SHAPES, DRAWING_SIZE } from "./drawing.js";
import { bbox, pointInPolygon } from "../../geometry/stroke.js";

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

test("shapes add up to one merged outline; undo takes the last one off", () => {
  const d = new ShapeDrawing();
  assert.deepEqual(d.merged, []);
  assert.equal(d.add(rect(0.2, 0.3, 0.3, 0.3)), true);
  assert.deepEqual(d.merged, rect(0.2, 0.3, 0.3, 0.3), "one shape is kept as drawn");
  d.add(rect(0.45, 0.2, 0.15, 0.15));
  const m = d.merged;
  assert.ok(pointInPolygon([0.3, 0.5], m) && pointInPolygon([0.55, 0.25], m));
  assert.equal(d.merged, m, "cached");
  d.undo();
  assert.equal(d.count, 1);
  assert.deepEqual(d.merged, rect(0.2, 0.3, 0.3, 0.3));
  d.clear();
  assert.equal(d.count, 0);
  assert.equal(d.undo(), false);
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
  assert.ok(Math.abs(b.h - DRAWING_SIZE.h) < 1e-9 || Math.abs(b.w - DRAWING_SIZE.w) < 1e-9, JSON.stringify(b));
  assert.ok(Math.abs(b.x + b.w / 2 - DRAWING_SIZE.cx) < 1e-9);
  assert.equal(ShapeDrawing.fromOutline(null).count, 0);
});
