import { test } from "node:test";
import assert from "node:assert/strict";
import { joinOpenStroke, thickenStroke, shapeAt, touches, touchedShapes, JOIN_TOL } from "./join.js";
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

test("an open stroke that touches no shape is not joined", () => {
  assert.equal(joinOpenStroke([[0.1, 0.1], [0.2, 0.2], [0.1, 0.3]], [body]), null, "far from the body");
  assert.equal(joinOpenStroke([[0.5, 0.5]], [body]), null, "too short");
  assert.equal(joinOpenStroke(ear, []), null, "nothing to join");
  assert.equal(joinOpenStroke(null, [body]), null);
  assert.equal(joinOpenStroke([[0.1, 0.1], [0.2, 0.2]], [null, body]), null, "empty slots are skipped");
});

test("playtest 3: a stroke drawn over the body joins it wherever it starts and ends", () => {
  // a horn that starts outside, crosses into the body and ends inside
  const horn = [[0.55, 0.15], [0.58, 0.25], [0.6, 0.35], [0.62, 0.5]];
  const r = joinOpenStroke(horn, [body]);
  assert.ok(r, "joined");
  assert.equal(r.from, -1, "it starts outside every shape");
  assert.equal(r.to, 0);
  const merged = unionOutlines([body, r.points], { aspect: 4 / 3 });
  assert.ok(pointInPolygon([0.585, 0.26], merged), "the horn is part of the body");
  // ends outside on both sides, crossing the body in between (no vertex inside: segments cross)
  const strike = [[0.2, 0.3], [0.8, 0.8], [0.9, 0.3]];
  const s = joinOpenStroke(strike, [body]);
  assert.ok(s, "a stroke across the body joins it");
  assert.deepEqual([s.from, s.to], [-1, -1]);
  // a head drawn as a loop that starts and stops just outside the body, not closed
  const head = Array.from({ length: 25 }, (_, i) => {
    const a = Math.PI * (0.6 + 1.6 * (i / 24));
    return [0.78 + 0.1 * Math.cos(a), 0.38 + 0.1 * Math.sin(a)];
  });
  const hd = joinOpenStroke(head, [body]);
  assert.ok(hd, "the head joins");
  assert.ok(polygonArea(hd.points) > 0.01, "as a shape with area, not a band");
});

test("an open stroke that ends in the body still joins as before", () => {
  const out = [[0.5, 0.5], [0.5, 0.3], [0.9, 0.1]];
  const r = joinOpenStroke(out, [body]);
  assert.ok(r);
  assert.deepEqual([r.from, r.to], [0, -1]);
});

test("touches: inside, near an edge, crossing, holding, or apart", () => {
  assert.equal(touches(rect(0.4, 0.45, 0.1, 0.1), body, { closed: true }), true, "inside");
  assert.equal(touches(rect(0.71, 0.45, 0.1, 0.1), body, { closed: true }), true, "within the tolerance");
  assert.equal(touches(rect(0.8, 0.45, 0.1, 0.1), body, { closed: true }), false, "apart");
  assert.equal(touches(rect(0.1, 0.1, 0.8, 0.8), body, { closed: true }), true, "holds the body");
  assert.equal(touches(rect(0.1, 0.1, 0.8, 0.8), body), false, "an open stroke around it does not hold it");
  // a long thin bar whose corners are all outside but which crosses the body
  assert.equal(touches([[0.2, 0.5], [0.8, 0.5], [0.8, 0.52], [0.2, 0.52]].map(([x, y]) => [x * 3 - 1, y]), body, { closed: true }), true);
  assert.equal(touches([[0.1, 0.55], [0.9, 0.55]], body, { tol: 0 }), true, "a segment crossing it");
  assert.equal(touches([], body), false);
  assert.equal(touches([[0.5, 0.5]], [[0, 0], [1, 1]]), false, "degenerate shape");
  assert.deepEqual(touchedShapes(rect(0.65, 0.35, 0.2, 0.1), [body, rect(0.8, 0.3, 0.1, 0.1), rect(0.0, 0.0, 0.05, 0.05)], { closed: true }), [0, 1]);
  assert.deepEqual(touchedShapes([[0.5, 0.5]], null), []);
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

test("a perfectly straight neck, or a there-and-back stroke (no area at all), is thickened into a band", () => {
  const head = rect(0.75, 0.15, 0.1, 0.1);
  const straight = [[0.65, 0.45], [0.8, 0.2]];
  for (const stroke of [straight, [...straight, [0.65, 0.45]]]) {
    const r = joinOpenStroke(stroke, [body, head]);
    assert.ok(r, "joined");
    assert.ok(Math.abs(polygonArea(r.points)) > 1e-4, `a band with area (${polygonArea(r.points)})`);
  }
});
