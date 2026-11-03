import { test } from "node:test";
import assert from "node:assert/strict";
import { spreadLegs, edgeBelow, footY, legLength, legacyLegCount, cleanLegs, HIP_INSET } from "./legs.js";

const sq = [[0.4, 0.5], [0.6, 0.5], [0.6, 0.7], [0.4, 0.7]];
// A U shape: two feet below a body, a gap between them (x 0.45…0.55, y 0.6…0.7).
const u = [[0.4, 0.5], [0.6, 0.5], [0.6, 0.7], [0.55, 0.7], [0.55, 0.6], [0.45, 0.6], [0.45, 0.7], [0.4, 0.7]];

test("a leg leaves the body at the first edge below its hip", () => {
  assert.ok(Math.abs(edgeBelow(sq, 0.5, 0.55) - 0.7) < 1e-12);
  assert.ok(Math.abs(edgeBelow(u, 0.5, 0.55) - 0.6) < 1e-12, "over the gap: the gap's top edge");
  assert.ok(Math.abs(edgeBelow(u, 0.42, 0.55) - 0.7) < 1e-12);
});

test("every leg shows the same length below the body, scaled to the thing's height", () => {
  assert.equal(legLength(sq), 34 / 600, "capped for a big thing");
  assert.ok(Math.abs(legLength([[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]) - 0.035) < 1e-12, "35 % of a small thing's height");
  const high = footY(sq, { x: 0.45, y: 0.55 }), low = footY(sq, { x: 0.55, y: 0.69 });
  assert.ok(Math.abs(high - low) < 1e-12, "a hip placed high still reaches the same foot line");
  assert.ok(Math.abs(high - (0.7 + legLength(sq) - HIP_INSET)) < 1e-12);
});

test("spread legs sit just above the bottom, across the middle of the width", () => {
  assert.deepEqual(spreadLegs(sq, 1), [{ x: 0.5, y: 0.695 }]);
  assert.deepEqual(spreadLegs(sq, 2).map((l) => l.x), [0.444, 0.556]);
  assert.equal(spreadLegs(sq, 0).length, 0);
});

test("legacy leg counts: walk 2, scuttle 6, others 0, a legs.count override wins, at most 8", () => {
  assert.equal(legacyLegCount({ preset: "walk", params: {} }), 2);
  assert.equal(legacyLegCount({ preset: "scuttle" }), 6);
  assert.equal(legacyLegCount({ preset: "float", params: {} }), 0);
  assert.equal(legacyLegCount({ preset: "float", params: { "legs.count": 3 } }), 3);
  assert.equal(legacyLegCount({ preset: "walk", params: { "legs.count": 40 } }), 8);
  assert.equal(legacyLegCount(undefined), 0);
});

test("cleanLegs rounds, drops junk and keeps at most 8", () => {
  assert.deepEqual(cleanLegs([{ x: 0.12345, y: 0.5 }, { x: "a", y: 1 }, null]), [{ x: 0.123, y: 0.5 }]);
  assert.equal(cleanLegs(Array.from({ length: 10 }, () => ({ x: 0.5, y: 0.6 }))).length, 8);
  assert.deepEqual(cleanLegs(undefined), []);
});
