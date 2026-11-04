import { test } from "node:test";
import assert from "node:assert/strict";
import { unionOutlines } from "./union.js";
import { polygonArea, bbox, pointInPolygon } from "./stroke.js";
import { validateSnapshot } from "../farm/snapshot.js";
import { aSnapshot, aPlace, aThing } from "../../../tests/builders.js";

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const circle = (cx, cy, r, n = 48, ry = r) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]);

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Closed simple polygon: ≥ 3 distinct finite points, no two non-adjacent edges cross. */
function assertSimple(poly) {
  assert.ok(poly.length >= 3, "at least 3 points");
  assert.ok(poly.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    assert.ok(!segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]), `edges ${i} and ${j} cross`);
  }
  assert.ok(polygonArea(poly) > 0);
}

const near = (a, b, rel) => Math.abs(a - b) <= rel * b;

test("a single shape passes through unchanged", () => {
  const sq = rect(0.1, 0.1, 0.2, 0.2);
  assert.deepEqual(unionOutlines([sq]), sq);
  assert.deepEqual(unionOutlines([]), []);
});

test("two overlapping squares merge into one outline with the union's area", () => {
  const out = unionOutlines([rect(0.2, 0.2, 0.2, 0.2), rect(0.3, 0.3, 0.2, 0.2)]);
  assertSimple(out);
  const want = 0.04 + 0.04 - 0.01;
  assert.ok(near(polygonArea(out), want, 0.04), `area ${polygonArea(out)} vs ${want}`);
  const b = bbox(out);
  assert.ok(Math.abs(b.x - 0.2) < 0.01 && Math.abs(b.x + b.w - 0.5) < 0.01 && Math.abs(b.y - 0.2) < 0.01 && Math.abs(b.y + b.h - 0.5) < 0.01, JSON.stringify(b));
  assert.ok(pointInPolygon([0.25, 0.25], out) && pointInPolygon([0.45, 0.45], out) && !pointInPolygon([0.45, 0.25], out));
  assert.ok(out.length <= 120, `${out.length} points`);
});

test("touching shapes become one piece", () => {
  const out = unionOutlines([rect(0.1, 0.1, 0.2, 0.2), rect(0.3, 0.15, 0.1, 0.1)]);
  assertSimple(out);
  assert.ok(near(polygonArea(out), 0.05, 0.04), `area ${polygonArea(out)}`);
  assert.ok(pointInPolygon([0.35, 0.2], out) && pointInPolygon([0.2, 0.2], out));
});

test("disjoint shapes are glued with a bridge into one outline", () => {
  const a = circle(0.2, 0.5, 0.08), b = circle(0.6, 0.5, 0.08);
  const out = unionOutlines([a, b]);
  assertSimple(out);
  assert.ok(pointInPolygon([0.2, 0.5], out) && pointInPolygon([0.6, 0.5], out));
  assert.ok(pointInPolygon([0.4, 0.5], out), "bridge between them");
  assert.ok(!pointInPolygon([0.4, 0.42], out), "the bridge is a neck, not a hull");
  const sum = polygonArea(a) + polygonArea(b);
  assert.ok(polygonArea(out) > sum * 0.95 && polygonArea(out) < sum * 1.4, `area ${polygonArea(out)} vs ${sum}`);
});

test("three scattered shapes all end up in one piece", () => {
  const out = unionOutlines([circle(0.2, 0.2, 0.05), circle(0.8, 0.25, 0.05), circle(0.5, 0.8, 0.05)]);
  assertSimple(out);
  for (const p of [[0.2, 0.2], [0.8, 0.25], [0.5, 0.8]]) assert.ok(pointInPolygon(p, out), String(p));
});

test("a small shape inside a big one gives the big one", () => {
  const big = circle(0.5, 0.5, 0.2), small = circle(0.5, 0.5, 0.05);
  const out = unionOutlines([big, small]);
  assertSimple(out);
  assert.ok(near(polygonArea(out), polygonArea(big), 0.04), `area ${polygonArea(out)} vs ${polygonArea(big)}`);
});

test("a ring (a hole) is filled", () => {
  // two U shapes forming a square ring around (0.5, 0.5)
  const top = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.5], [0.62, 0.5], [0.62, 0.38], [0.38, 0.38], [0.38, 0.5], [0.3, 0.5]];
  const bottom = top.map(([x, y]) => [x, 1 - y]).reverse();
  const out = unionOutlines([top, bottom]);
  assertSimple(out);
  assert.ok(pointInPolygon([0.5, 0.5], out), "hole filled");
  assert.ok(near(polygonArea(out), 0.16, 0.04), `area ${polygonArea(out)}`);
});

test("self-intersecting scribbles still give a simple outline; aspect keeps the bridge round on screen", () => {
  const bow = [[0.1, 0.1], [0.3, 0.3], [0.3, 0.1], [0.1, 0.3]];
  const out = unionOutlines([bow, circle(0.4, 0.2, 0.06)], { aspect: 4 / 3 });
  assertSimple(out);
});

test("deterministic, valid in a snapshot, and fast", () => {
  const shapes = [circle(0.5, 0.55, 0.2, 80, 0.15), circle(0.66, 0.35, 0.08, 60), circle(0.6, 0.25, 0.03, 30), circle(0.72, 0.25, 0.03, 30), circle(0.3, 0.7, 0.04, 30)];
  const a = unionOutlines(shapes, { aspect: 4 / 3 });
  const b = unionOutlines(shapes, { aspect: 4 / 3 });
  assert.deepEqual(a, b);
  assertSimple(a);
  const snap = aSnapshot().withPlace(aPlace().withThing(aThing({ outline: a }))).build();
  assert.deepEqual(validateSnapshot(snap), { ok: true });
  const t0 = process.hrtime.bigint();
  const N = 20;
  for (let i = 0; i < N; i++) unionOutlines(shapes, { aspect: 4 / 3 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  // The time budget only means something without coverage instrumentation, which slows code
  // unpredictably (npm test); npm run test:fast and CI's plain runs check it.
  const instrumented = process.env.NODE_V8_COVERAGE || process.execArgv.some((a) => a.includes("coverage"));
  if (!instrumented) assert.ok(ms < 15, `union of 5 shapes took ${ms.toFixed(2)} ms`);
  console.log(`# union of 5 shapes: ${ms.toFixed(2)} ms, ${a.length} points`);
});

test("property: random wobbly shapes always merge into one simple outline", () => {
  let s = 7;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 40; k++) {
    const n = 2 + Math.floor(rng() * 5);
    const shapes = Array.from({ length: n }, () => {
      const cx = 0.2 + rng() * 0.6, cy = 0.2 + rng() * 0.6, r = 0.03 + rng() * 0.15, p = rng() * 6;
      return Array.from({ length: 60 }, (_, i) => {
        const a = (i / 60) * 2 * Math.PI, q = 1 + 0.25 * Math.sin(3 * a + p);
        return [cx + r * q * Math.cos(a), cy + r * q * Math.sin(a)];
      });
    });
    const out = unionOutlines(shapes, { aspect: 4 / 3 });
    assertSimple(out);
    for (const sh of shapes) {
      const c = sh.reduce((m, [x, y]) => [m[0] + x / sh.length, m[1] + y / sh.length], [0, 0]);
      assert.ok(pointInPolygon(c, out), `case ${k}: shape centre inside`);
    }
  }
});
