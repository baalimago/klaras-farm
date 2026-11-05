import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translationBetween, clampDelta, translatePoints, scaleAbout, clampScale, movedThingPatch, MIN_SIDE,
  thingSize, footPoint, clampThingScale, scaledThingPatch, THING_SCALE_MIN, THING_SCALE_MAX,
} from "./transform.js";

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

// A Medium-sized thing (fills THING_BOX one way: 0.24 wide, 0.24 high), feet at y 0.8.
const body = [[0.38, 0.56], [0.62, 0.56], [0.62, 0.8], [0.38, 0.8]];
const cow = { outline: body, eyes: [{ x: 0.56, y: 0.62, r: 1 }], legs: [{ x: 0.42, y: 0.79 }, { x: 0.58, y: 0.79 }] };

test("thingSize measures against THING_BOX by the larger side; footPoint is the bottom centre", () => {
  near(thingSize(body), 1);
  near(thingSize(scaleAbout(body, 0.5, 0.5, 0.8)), 0.5);
  near(thingSize([[0, 0], [0.12, 0], [0.12, 0.32]]), 1, 1e-9); // tall: the height decides
  assert.equal(thingSize([]), 0);
  assert.equal(thingSize(undefined), 0);
  const [x, y] = footPoint(body);
  near(x, 0.5);
  near(y, 0.8);
});

test("scaledThingPatch scales about the bottom centre: the feet stay put, eyes and legs go along", () => {
  const p = scaledThingPatch(cow, 1.5);
  const b = { x: Math.min(...p.outline.map((q) => q[0])), y: Math.min(...p.outline.map((q) => q[1])), r: Math.max(...p.outline.map((q) => q[0])), bottom: Math.max(...p.outline.map((q) => q[1])) };
  near(b.bottom, 0.8); // feet where they stood
  near((b.x + b.r) / 2, 0.5); // still centred over them
  near(b.r - b.x, 0.36);
  near(b.bottom - b.y, 0.36);
  near(p.eyes[0].x, 0.5 + 0.06 * 1.5);
  near(p.eyes[0].y, 0.8 - 0.18 * 1.5);
  assert.equal(p.eyes[0].r, 1, "other eye fields are kept");
  near(p.legs[0].x, 0.5 - 0.08 * 1.5);
  near(p.legs[1].y, 0.8 - 0.01 * 1.5);
  const noLegs = scaledThingPatch({ outline: body }, 0.8);
  assert.deepEqual(noLegs.eyes, []);
  assert.equal("legs" in noLegs, false);
});

test("clampThingScale keeps the size between the min and max of THING_BOX", () => {
  near(clampThingScale(cow, 0.01), THING_SCALE_MIN);
  near(clampThingScale(cow, 0.7), 0.7);
  // 1.8 would reach y = 0.8 - 0.432 = 0.368: still on the board
  near(clampThingScale(cow, 5), THING_SCALE_MAX);
  near(thingSize(scaledThingPatch(cow, 5).outline), THING_SCALE_MAX);
  near(thingSize(scaledThingPatch(cow, 0).outline), 1, 1e-9);
  assert.equal(clampThingScale(cow, 0), 1, "no scale is no change");
  assert.equal(clampThingScale(cow, NaN), 1);
  assert.equal(clampThingScale({ outline: [] }, 2), 1);
  // A thing already past a limit (an old drawing) is never forced to change, and may move back.
  const huge = { outline: scaleAbout(body, 2, 0.5, 0.8) };
  assert.equal(clampThingScale(huge, 1), 1);
  near(clampThingScale(huge, 1.2), 1, 1e-9);
  near(clampThingScale(huge, 0.5), 0.5);
  const tiny = { outline: scaleAbout(body, 0.2, 0.5, 0.8) };
  assert.equal(clampThingScale(tiny, 1), 1);
  near(clampThingScale(tiny, 0.5), 1);
  near(clampThingScale(tiny, 3), 3);
});

test("clampThingScale keeps a growing thing on the board", () => {
  // High up: growing about its feet (0.5, 0.3), its top reaches the board's top at 1.5.
  const high = { outline: [[0.4, 0.1], [0.6, 0.1], [0.6, 0.3], [0.4, 0.3]] };
  near(clampThingScale(high, 1.6), 1.5);
  const p = scaledThingPatch(high, 1.6);
  for (const [x, y] of p.outline) assert.ok(x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9, `on the board: ${x}, ${y}`);
  // At the right edge: it cannot grow (its right side would leave the board), but it can shrink.
  const edge = { outline: [[0.8, 0.5], [1, 0.5], [1, 0.7], [0.8, 0.7]] };
  assert.equal(clampThingScale(edge, 1.4), 1);
  near(clampThingScale(edge, 0.8), 0.8);
});
