import { test } from "node:test";
import assert from "node:assert/strict";
import { translationBetween, clampDelta, translatePoints, scaleAbout, clampScale, movedThingPatch, MIN_SIDE } from "./transform.js";

const sq = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]];
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("translationBetween finds a pure move, within rounding", () => {
  assert.deepEqual(translationBetween(sq, sq), [0, 0]);
  const moved = translatePoints(sq, 0.2, -0.05);
  const [dx, dy] = translationBetween(sq, moved);
  near(dx, 0.2);
  near(dy, -0.05);
  const rounded = moved.map(([x, y]) => [Math.round(x * 1000) / 1000 + 0.0004, Math.round(y * 1000) / 1000]);
  assert.ok(translationBetween(sq, rounded), "3-decimal rounding still counts as a move");
});

test("translationBetween refuses reshaped, resized or empty strokes", () => {
  assert.equal(translationBetween(sq, scaleAbout(sq, 1.5, 0.2, 0.2)), null);
  assert.equal(translationBetween(sq, sq.slice(1)), null);
  assert.equal(translationBetween([], []), null);
  assert.equal(translationBetween(null, sq), null);
});

test("clampDelta keeps a box on the board", () => {
  const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  assert.deepEqual(clampDelta(box, 0.3, 0.3), [0.3, 0.3]);
  near(clampDelta(box, 2, 0)[0], 0.7);
  near(clampDelta(box, -1, 0)[0], -0.1);
  near(clampDelta(box, 0, 5)[1], 0.7);
  near(clampDelta(box, 0, -5)[1], -0.1);
});

test("scaleAbout scales around a centre", () => {
  const [[x, y]] = scaleAbout([[0.3, 0.2]], 2, 0.2, 0.2);
  near(x, 0.4);
  near(y, 0.2);
});

test("clampScale keeps a scaled box on the board and not too small", () => {
  const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  assert.equal(clampScale(box, 1.5, 0.2, 0.2), 1.5);
  near(clampScale(box, 10, 0.2, 0.2), 2); // left edge reaches 0 at s = 2
  near(clampScale(box, 0.001, 0.2, 0.2), MIN_SIDE / 0.2);
  const tiny = { x: 0.5, y: 0.5, w: 0.01, h: 0.01 };
  assert.ok(clampScale(tiny, 0.5, 0.505, 0.505) >= 1, "a piece already under the minimum never shrinks");
  const flat = { x: 0.2, y: 0.5, w: 0.4, h: 0 };
  assert.equal(clampScale(flat, 1.2, 0.4, 0.5), 1.2);
  const wide = { x: 0, y: 0.4, w: 1, h: 0.2 };
  assert.equal(clampScale(wide, 1.5, 0.5, 0.5), 1, "a board-wide piece cannot grow");
});

test("movedThingPatch moves outline, eyes and legs together, kept on the board", () => {
  const thing = { outline: sq, eyes: [{ x: 0.2, y: 0.15 }], legs: [{ x: 0.15, y: 0.28 }] };
  const p = movedThingPatch(thing, 0.1, 0.05);
  near(p.outline[0][0], 0.2);
  near(p.eyes[0].x, 0.3);
  near(p.eyes[0].y, 0.2);
  near(p.legs[0].x, 0.25);
  const far = movedThingPatch(thing, 5, 5);
  near(far.outline[1][0], 1);
  near(far.outline[2][1], 1);
  const noLegs = movedThingPatch({ outline: sq }, 0, 0);
  assert.deepEqual(noLegs.eyes, []);
  assert.equal("legs" in noLegs, false);
});
