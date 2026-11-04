import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInPolygon, distanceToStroke, pickPiece, moveStroke, pathData, strokeBox, scaleStroke, resizeScale, sendToBack } from "./pieces.js";

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
  assert.equal(pathData([], true), "");
});

test("strokeBox and scaleStroke scale about the piece's centre", () => {
  const { cx, cy, box } = strokeBox(sq);
  assert.ok(Math.abs(cx - 0.2) < 1e-12 && Math.abs(cy - 0.2) < 1e-12);
  assert.ok(Math.abs(box.w - 0.2) < 1e-12);
  const big = scaleStroke(sq, 1.5);
  assert.ok(Math.abs(big[0][0] - 0.05) < 1e-12 && Math.abs(big[2][1] - 0.35) < 1e-12);
});

test("resizeScale follows the finger's distance from the centre, limited to the board", () => {
  const c = [200, 200];
  assert.ok(Math.abs(resizeScale(sq, [300, 200], [350, 200], c) - 1.5) < 1e-12);
  assert.ok(Math.abs(resizeScale(sq, [300, 200], [200, 400], c) - 2) < 1e-12, "direction does not matter; capped at the board edge");
  assert.equal(resizeScale(sq, [200, 200], [400, 400], c), 1, "a start on the centre cannot scale");
  assert.ok(resizeScale(sq, [300, 200], [200, 200], c) > 0, "never collapses to nothing");
});

test("sendToBack moves a piece first in drawing order", () => {
  const ps = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(sendToBack(ps, "c").map((p) => p.id), ["c", "a", "b"]);
  assert.equal(sendToBack(ps, "a"), ps);
  assert.equal(sendToBack(ps, "zzz"), ps);
});
