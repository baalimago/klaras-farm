import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInPolygon, distanceToStroke, pickPiece, moveStroke, pathData } from "./pieces.js";

const sq = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]];
const size = { width: 800, height: 600 };

test("pointInPolygon", () => {
  assert.equal(pointInPolygon([0.2, 0.2], sq), true);
  assert.equal(pointInPolygon([0.35, 0.2], sq), false);
});

test("distanceToStroke measures in pixels", () => {
  const line = [[0, 0.5], [1, 0.5]];
  assert.ok(Math.abs(distanceToStroke([0.5, 0.51], line, size) - 6) < 1e-9);
  assert.ok(Math.abs(distanceToStroke([0.2, 0.2], sq, size, true) - 60) < 1e-9);
});

test("pickPiece returns the topmost hit, yarn within tolerance, else null", () => {
  const pieces = [
    { id: "a", kind: "shape", stroke: sq },
    { id: "b", kind: "shape", stroke: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]] },
    { id: "y", kind: "yarn", stroke: [[0.5, 0.8], [0.9, 0.8]] },
  ];
  assert.equal(pickPiece(pieces, [0.25, 0.25], size).id, "b");
  assert.equal(pickPiece(pieces, [0.15, 0.15], size).id, "a");
  assert.equal(pickPiece(pieces, [0.7, 0.81], size).id, "y");
  assert.equal(pickPiece(pieces, [0.7, 0.7], size), null);
});

test("moveStroke translates and keeps the piece on the board", () => {
  assert.deepEqual(moveStroke(sq, 0.1, 0).map(([x]) => +x.toFixed(3)), [0.2, 0.4, 0.4, 0.2]);
  const far = moveStroke(sq, 5, -5);
  assert.equal(Math.max(...far.map((p) => p[0])), 1);
  assert.equal(Math.min(...far.map((p) => p[1])), 0);
});

test("pathData", () => {
  assert.equal(pathData([[0, 0], [1, 0.5]], false), "M0.0000 0.0000 L1.0000 0.5000");
  assert.match(pathData(sq, true), / Z$/);
});
