import { test } from "node:test";
import assert from "node:assert/strict";
import { joinOpenStroke, thickenStroke, shapeAt, JOIN_TOL } from "./join.js";
import { polygonArea, pointInPolygon } from "./stroke.js";
import { unionOutlines } from "./union.js";

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const body = rect(0.3, 0.4, 0.4, 0.3);

// An arc that leaves the body's top edge and comes back down into it: an ear.
const ear = Array.from({ length: 21 }, (_, i) => {
  const a = Math.PI * (i / 20);
  return [0.5 - 0.08 * Math.cos(a), 0.45 - 0.15 * Math.sin(a)];
});

test("shapeAt finds the shape holding a point, or one within the tolerance", () => {
  assert.equal(shapeAt([0.5, 0.5], [body]), 0);
  assert.equal(shapeAt([0.5, 0.395], [body]), 0, "just outside the edge counts");
  assert.equal(shapeAt([0.5, 0.3], [body]), -1);
  // the smallest shape that holds the point wins
  const small = rect(0.45, 0.45, 0.1, 0.1);
  assert.equal(shapeAt([0.5, 0.5], [body, small]), 1);
  assert.equal(shapeAt([0.5, 0.5], []), -1);
  assert.equal(shapeAt([0.5, 0.5], [[[0, 0], [1, 1]]]), -1, "degenerate shapes are skipped");
  assert.ok(JOIN_TOL > 0 && JOIN_TOL < 0.05);
});

test("an open stroke that starts and ends inside a shape is closed and joins it", () => {
  const r = joinOpenStroke(ear, [body]);
  assert.ok(r, "joined");
  assert.deepEqual(r.from, 0);
  assert.deepEqual(r.to, 0);
  assert.ok(polygonArea(r.points) > 0.005);
  const merged = unionOutlines([body, r.points], { aspect: 4 / 3 });
  assert.ok(pointInPolygon([0.5, 0.35], merged), "the ear is part of the body");
  assert.ok(pointInPolygon([0.5, 0.55], merged), "the body is still there");
});

test("an open stroke from one shape to another joins them", () => {
  const head = rect(0.75, 0.2, 0.1, 0.1);
  const neck = [[0.65, 0.45], [0.7, 0.35], [0.76, 0.28], [0.8, 0.25]];
  const r = joinOpenStroke(neck, [body, head]);
  assert.ok(r);
  assert.equal(r.from, 0);
  assert.equal(r.to, 1);
  assert.ok(polygonArea(r.points) > 0, "a nearly straight stroke is thickened into a band");
  const merged = unionOutlines([body, head, r.points], { aspect: 4 / 3 });
  assert.ok(pointInPolygon([0.72, 0.33], merged));
});

test("an open stroke with an end outside every shape is not joined", () => {
  const out = [[0.5, 0.5], [0.5, 0.3], [0.9, 0.1]];
  assert.equal(joinOpenStroke(out, [body]), null);
  assert.equal(joinOpenStroke([[0.1, 0.1], [0.2, 0.2], [0.5, 0.5]], [body]), null);
  assert.equal(joinOpenStroke([[0.5, 0.5]], [body]), null, "too short");
  assert.equal(joinOpenStroke(ear, []), null, "nothing to join");
  assert.equal(joinOpenStroke(null, [body]), null);
});

test("a stroke that stays inside the shape is accepted (it changes nothing)", () => {
  const r = joinOpenStroke([[0.4, 0.5], [0.5, 0.6], [0.6, 0.5]], [body]);
  assert.ok(r);
  const merged = unionOutlines([body, r.points], { aspect: 4 / 3 });
  assert.ok(Math.abs(polygonArea(merged) - polygonArea(body)) < 0.01);
});

test("thickenStroke makes a band around a polyline", () => {
  const band = thickenStroke([[0, 0], [1, 0]], 0.1);
  assert.equal(band.length, 4);
  assert.ok(Math.abs(polygonArea(band) - 0.2) < 1e-9);
  const bent = thickenStroke([[0, 0], [0.5, 0], [0.5, 0.5], [0.5, 0.5]], 0.05);
  assert.ok(pointInPolygon([0.25, 0.01], bent));
  assert.ok(pointInPolygon([0.51, 0.25], bent));
  assert.deepEqual(thickenStroke([[0.2, 0.2]], 0.1), []);
});
