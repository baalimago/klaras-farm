import { test } from "node:test";
import assert from "node:assert/strict";
import { hitTest } from "./hit.js";

const box = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
const target = (id, cx, cy, r) => ({ id, poly: box(cx, cy, r), x: cx, y: cy });

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test("a point inside a drawing hits it", () => {
  assert.equal(hitTest([target("a", 0.5, 0.5, 0.1)], [0.52, 0.48]), "a");
});

test("misses return null", () => {
  assert.equal(hitTest([target("a", 0.5, 0.5, 0.05)], [0.9, 0.9]), null);
  assert.equal(hitTest([], [0.5, 0.5]), null);
});

test("the hit area is 1.3× the drawing", () => {
  const t = [target("a", 0.5, 0.5, 0.1)];
  assert.equal(hitTest(t, [0.614, 0.5]), "a"); // inside 1.3× (0.63)
  assert.equal(hitTest(t, [0.64, 0.5]), null);
  assert.equal(hitTest(t, [0.64, 0.5], { scale: 1.5 }), "a");
});

test("small things get at least minRadius (in board-width units, aspect-corrected)", () => {
  const t = [target("a", 0.5, 0.5, 0.01)];
  assert.equal(hitTest(t, [0.55, 0.5], { minRadius: 0.06 }), "a");
  // vertical distance 0.07 board units is 0.0525 in width units at 4:3
  assert.equal(hitTest(t, [0.5, 0.57], { minRadius: 0.06 }), "a");
  assert.equal(hitTest(t, [0.5, 0.6], { minRadius: 0.06 }), null);
});

test("topmost (last in drawing order) wins when the point is on both drawings", () => {
  const t = [target("back", 0.5, 0.5, 0.1), target("front", 0.55, 0.5, 0.1)];
  assert.equal(hitTest(t, [0.52, 0.5]), "front");
});

test("a drawing beats a neighbour's expanded margin", () => {
  const t = [target("a", 0.4, 0.5, 0.1), target("b", 0.62, 0.5, 0.1)];
  // 0.505 is inside a's drawing and inside b's 1.3× margin (0.49)
  assert.equal(hitTest(t, [0.505, 0.5]), "a");
});

test("in overlapping margins only, the nearest centre wins", () => {
  const t = [target("a", 0.3, 0.5, 0.1), target("b", 0.54, 0.5, 0.1)];
  assert.equal(hitTest(t, [0.415, 0.5]), "a");
  assert.equal(hitTest(t, [0.425, 0.5]), "b");
});

test("property: any point strictly inside exactly one drawing hits that one", () => {
  const rng = rngFrom(9);
  for (let run = 0; run < 300; run++) {
    const ts = Array.from({ length: 4 }, (_, i) => target(`t${i}`, 0.1 + i * 0.25, 0.3 + rng() * 0.4, 0.03 + rng() * 0.05));
    const i = Math.floor(rng() * 4);
    const t = ts[i];
    const r = t.poly[1][0] - t.x;
    const p = [t.x + (rng() - 0.5) * r * 1.9, t.y + (rng() - 0.5) * r * 1.9];
    assert.equal(hitTest(ts, p, { minRadius: 0.05 }), t.id);
  }
});
