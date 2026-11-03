import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simplify, smooth, pathLength, closeGap, polygonArea, signedArea, centroid, bbox, pointInPolygon, snapInside,
  fitOutline, translate, toBoard, fromBoard, fitRect, distToSegment,
} from "./stroke.js";

// Small deterministic rng for property-style tests.
function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const circle = (cx, cy, r, n = 64, from = 0, to = Math.PI * 2) =>
  Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * i) / (n - 1);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

const wobblyLoop = (rng, n = 80) => {
  const cx = 0.3 + rng() * 0.4, cy = 0.3 + rng() * 0.4, r = 0.05 + rng() * 0.15;
  const p1 = rng() * 6, p2 = rng() * 6;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.2 * Math.sin(a * 2 + p1) + 0.1 * Math.sin(a * 3 + p2);
    return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
  });
};

test("simplify keeps endpoints and stays within tolerance of the original", () => {
  const rng = rngFrom(7);
  for (let run = 0; run < 50; run++) {
    const pts = Array.from({ length: 100 }, (_, i) => [i / 100, 0.5 + (rng() - 0.5) * 0.02 + Math.sin(i / 10) * 0.1]);
    const tol = 0.002 + rng() * 0.01;
    const out = simplify(pts, tol);
    assert.deepEqual(out[0], pts[0]);
    assert.deepEqual(out.at(-1), pts.at(-1));
    assert.ok(out.length <= pts.length);
    // every original point lies within tol of the simplified polyline
    for (const p of pts) {
      let d = Infinity;
      for (let i = 0; i < out.length - 1; i++) d = Math.min(d, distToSegment(p, out[i], out[i + 1]));
      assert.ok(d <= tol + 1e-9, `point off by ${d} > ${tol}`);
    }
  }
});

test("simplify reduces a straight line to two points", () => {
  const pts = Array.from({ length: 20 }, (_, i) => [i / 19, i / 19]);
  assert.equal(simplify(pts, 0.001).length, 2);
  assert.deepEqual(simplify([[0, 0]], 1), [[0, 0]]);
});

test("smooth (Chaikin) keeps open endpoints and doubles points per iteration", () => {
  const pts = [[0, 0], [0.5, 1], [1, 0]];
  const out = smooth(pts, 1);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out.at(-1), [1, 0]);
  assert.equal(out.length, 2 + 2 * (pts.length - 1) - 0); // endpoints + 2 per segment, minus shared
  const closed = smooth([[0, 0], [1, 0], [1, 1], [0, 1]], 2, true);
  assert.equal(closed.length, 16);
  assert.ok(Math.abs(polygonArea(closed)) < 1 && Math.abs(polygonArea(closed)) > 0.5);
});

test("pathLength of open and closed squares", () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.equal(pathLength(sq), 3);
  assert.equal(pathLength(sq, true), 4);
  assert.equal(pathLength([]), 0);
});

test("closeGap closes a near-closed circle (gap < 8% of length)", () => {
  const pts = circle(0.5, 0.5, 0.2, 80, 0, Math.PI * 2 * 0.96); // 4% gap
  const r = closeGap(pts);
  assert.equal(r.closed, true);
  assert.equal(r.gap, null);
  assert.ok(r.points.length >= 3);
});

test("closeGap rejects a big gap and reports both ends", () => {
  const pts = circle(0.5, 0.5, 0.2, 80, 0, Math.PI * 2 * 0.8); // 20% gap
  const r = closeGap(pts);
  assert.equal(r.closed, false);
  assert.deepEqual(r.gap.a, pts[0]);
  assert.deepEqual(r.gap.b, pts.at(-1));
});

test("closeGap property: random gaps below/above the threshold", () => {
  const rng = rngFrom(11);
  for (let run = 0; run < 200; run++) {
    const frac = rng() * 0.3; // fraction of the circle left open
    const pts = circle(0.5, 0.5, 0.05 + rng() * 0.2, 120, rng() * 6, 0);
    const n = pts.length;
    const a0 = rng() * 6;
    const arc = circle(0.5, 0.5, 0.15, n, a0, a0 + Math.PI * 2 * (1 - frac));
    const len = pathLength(arc);
    const gap = Math.hypot(arc[0][0] - arc.at(-1)[0], arc[0][1] - arc.at(-1)[1]);
    const r = closeGap(arc);
    if (gap < 0.07 * (len + gap)) assert.equal(r.closed, true, `gap ${gap / len}`);
    if (gap > 0.09 * len) assert.equal(r.closed, false, `gap ${gap / len}`);
    void pts;
  }
});

test("closeGap trims an overshoot past the start", () => {
  const pts = circle(0.5, 0.5, 0.2, 100, 0, Math.PI * 2 * 1.1);
  const r = closeGap(pts);
  assert.equal(r.closed, true);
  // trimmed loop length ≈ circumference, not 110%
  const L = pathLength(r.points, true);
  assert.ok(Math.abs(L - 2 * Math.PI * 0.2) < 0.05, `length ${L}`);
});

test("closeGap refuses a back-and-forth scribble with no area", () => {
  const pts = [...Array.from({ length: 20 }, (_, i) => [0.2 + i * 0.02, 0.5]), ...Array.from({ length: 20 }, (_, i) => [0.6 - i * 0.02, 0.501])];
  assert.equal(closeGap(pts).closed, false);
  assert.equal(closeGap([[0, 0], [0.1, 0]]).closed, false);
});

test("polygonArea, signedArea, centroid, bbox", () => {
  const sq = [[0, 0], [2, 0], [2, 1], [0, 1]];
  assert.equal(polygonArea(sq), 2);
  assert.equal(signedArea(sq), 2);
  assert.equal(signedArea([...sq].reverse()), -2);
  assert.deepEqual(centroid(sq), [1, 0.5]);
  assert.deepEqual(bbox(sq), { x: 0, y: 0, w: 2, h: 1 });
  assert.deepEqual(centroid([[1, 1], [1, 1], [1, 1]]), [1, 1]);
});

test("pointInPolygon on a concave shape", () => {
  const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]];
  assert.equal(pointInPolygon([0.5, 2], u), true);
  assert.equal(pointInPolygon([1.5, 2], u), false);
  assert.equal(pointInPolygon([1.5, 0.5], u), true);
  assert.equal(pointInPolygon([4, 1], u), false);
});

test("snapInside property: result is always strictly inside, inside points stay put", () => {
  const rng = rngFrom(3);
  for (let run = 0; run < 100; run++) {
    const poly = wobblyLoop(rng);
    const b = bbox(poly);
    for (let k = 0; k < 10; k++) {
      const p = [b.x - 0.1 + rng() * (b.w + 0.2), b.y - 0.1 + rng() * (b.h + 0.2)];
      const q = snapInside(p, poly);
      assert.ok(pointInPolygon(q, poly), `snapped ${q} not inside`);
      if (pointInPolygon(p, poly)) {
        let edge = Infinity;
        for (let i = 0; i < poly.length; i++) edge = Math.min(edge, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
        if (edge > 0.02) assert.deepEqual(q, p);
      }
    }
  }
});

test("snapInside works in a thin concave notch", () => {
  const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]];
  const q = snapInside([1.5, 2.5], u, { margin: 0.1 });
  assert.ok(pointInPolygon(q, u));
});

test("fitOutline scales to fit and centres, keeping aspect", () => {
  const pts = [[0, 0], [0.4, 0], [0.4, 0.2], [0, 0.2]];
  const out = fitOutline(pts, { maxW: 0.2, maxH: 0.2, cx: 0.5, cy: 0.5 });
  const b = bbox(out);
  assert.ok(Math.abs(b.w - 0.2) < 1e-9);
  assert.ok(Math.abs(b.h - 0.1) < 1e-9);
  assert.ok(Math.abs(b.x + b.w / 2 - 0.5) < 1e-9 && Math.abs(b.y + b.h / 2 - 0.5) < 1e-9);
  assert.deepEqual(translate([[1, 1]], 0.5, -1), [[1.5, 0]]);
});

test("toBoard/fromBoard round-trip in a 4:3 rect", () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 };
  assert.deepEqual(toBoard(100, 50, rect), [0, 0]);
  assert.deepEqual(toBoard(900, 650, rect), [1, 1]);
  const rng = rngFrom(5);
  for (let i = 0; i < 50; i++) {
    const x = rng(), y = rng();
    const [cx, cy] = fromBoard(x, y, rect);
    const [bx, by] = toBoard(cx, cy, rect);
    assert.ok(Math.abs(bx - x) < 1e-12 && Math.abs(by - y) < 1e-12);
  }
});

test("fitRect letterboxes a 4:3 board in portrait and landscape, never cropping", () => {
  const land = fitRect(1180, 820);
  assert.ok(Math.abs(land.width / land.height - 4 / 3) < 1e-9);
  assert.equal(land.height, 820);
  assert.ok(land.width <= 1180);
  const port = fitRect(820, 1180);
  assert.equal(port.width, 820);
  assert.ok(port.height <= 1180);
  assert.ok(Math.abs(port.top - (1180 - port.height) / 2) < 1e-9);
});
