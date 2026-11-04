import { test } from "node:test";
import assert from "node:assert/strict";
import { travel, travelSpeed, MAX_SPEED, bob, squash, tilt, legs, blink, jump, jumpStretch, drop, wiggle, yawn, REACT_S, DROP_S, SLEEP_SETTLE_S } from "./blocks.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("travelSpeed is a fraction of the 40 CSS px/s cap and is clamped", () => {
  near(travelSpeed({ speed: 1 }), MAX_SPEED);
  near(travelSpeed({ speed: 0.5 }), MAX_SPEED / 2);
  near(travelSpeed({ speed: 7 }), MAX_SPEED);
  near(travelSpeed({ speed: -1 }), 0);
  near(travelSpeed(undefined), 0);
  // 40 CSS px/s on the largest board (13" iPad landscape, 1366 px wide).
  assert.ok(MAX_SPEED * 1366 <= 40);
});

test("travel: ground and water stay on the line, hop leaves the ground once per step", () => {
  near(travel(0.3, { mode: "ground" }), 0);
  near(travel(0.3, { mode: "water" }), 0);
  const p = { mode: "hop", height: 0.04, rate: 2 };
  near(travel(0, p), 0);
  near(travel(0.25, p), -0.04); // top of the first hop
  near(travel(0.5, p), 0, 1e-12); // lands
  for (let t = 0; t < 2; t += 0.01) assert.ok(travel(t, p) <= 1e-12, "never below ground");
});

test("bob: bounce is up-only with one bounce per step; sine is symmetric", () => {
  const b = { shape: "bounce", amp: 0.01, rate: 2 };
  near(bob(0, b), 0);
  near(bob(0.25, b), -0.01);
  near(bob(0.5, b), 0, 1e-12);
  const s = { shape: "sine", amp: 0.01, rate: 0.5 };
  near(bob(0, s), 0);
  near(bob(0.5, s), 0.01);
  near(bob(1.5, s), -0.01);
  near(bob(1, undefined), 0);
});

test("squash is widest on contact (t = k/rate) and tallest mid-step", () => {
  const p = { amp: 0.06, rate: 2 };
  near(squash(0, p), 0.06);
  near(squash(0.25, p), -0.06);
  near(squash(0.5, p), 0.06);
  near(squash(1, {}), 0);
});

test("tilt is a sine of amp and rate", () => {
  near(tilt(0.5, { amp: 0.1, rate: 0.5 }), 0.1);
  near(tilt(0, { amp: 0.1, rate: 0.5 }), 0);
  near(tilt(1, undefined), 0);
});

test("legs alternate: neighbours swing opposite, spread on contact, vertical mid-step", () => {
  const p = { count: 4, swing: 0.5, rate: 2 };
  near(legs(0, p, 0), 0.5);
  near(legs(0, p, 1), -0.5);
  near(legs(0, p, 2), 0.5);
  near(legs(0.25, p, 0), 0, 1e-12);
  for (let t = 0; t < 1; t += 0.05) near(legs(t, p, 0) + legs(t, p, 1), 0, 1e-12);
});

test("legs together (hoppers): all legs swing the same way, straight on landing, tucked mid-hop", () => {
  const p = { swing: 0.4, rate: 1.5, together: 1 };
  near(legs(0, p, 0), 0, 1e-12);
  near(legs(0, p, 1), 0, 1e-12);
  near(legs(1 / 1.5, p, 0), 0, 1e-12); // lands once per 1/rate s, like travel's hop
  near(legs(1 / 3, p, 0), 0.4);
  for (let t = 0; t < 1; t += 0.05) {
    near(legs(t, p, 0), legs(t, p, 1), 1e-12);
    near(legs(t, p, 3), legs(t, p, 0), 1e-12);
    assert.ok(legs(t, p, 0) >= 0, "never swings forward");
    // the hop leaves the ground exactly when the legs tuck
    near(-travel(t, { mode: "hop", height: 1, rate: 1.5 }), legs(t, p, 0) / 0.4, 1e-12);
  }
  assert.equal(legs(0.2, { swing: 0.4, rate: 1.5, together: 0 }, 1), -legs(0.2, { swing: 0.4, rate: 1.5 }, 0), "together: 0 alternates");
});

test("blink closes and reopens the eyes over its duration; open otherwise", () => {
  const p = { duration: 0.2 };
  near(blink(-1, p), 1);
  near(blink(0, p), 1);
  near(blink(0.1, p), 0);
  near(blink(0.05, p), 0.5);
  near(blink(0.2, p), 1);
  near(blink(5, p), 1);
});

test("jump: two hops, the second lower, back on the ground well within 3 s", () => {
  assert.ok(REACT_S <= 3);
  near(jump(0), 0);
  let top1 = 0, top2 = 0;
  for (let t = 0; t <= REACT_S; t += 0.005) {
    const y = jump(t);
    assert.ok(y <= 1e-12);
    if (t < REACT_S / 2) top1 = Math.min(top1, y); else top2 = Math.min(top2, y);
  }
  assert.ok(top1 < top2 && top2 < 0, "second hop lower");
  near(jump(REACT_S), 0, 1e-12);
  near(jump(REACT_S + 1), 0);
  near(jumpStretch(REACT_S + 1), 0);
  assert.ok(jumpStretch(REACT_S / 4) < 0, "tall in the air");
});

test("drop falls from above and lands at 0 by DROP_S", () => {
  assert.ok(drop(0) < -0.2);
  near(drop(DROP_S), 0, 1e-12);
  near(drop(DROP_S + 1), 0);
  for (let t = 0; t < DROP_S; t += 0.01) assert.ok(drop(t) <= 1e-12);
});

test("wiggle decays to still", () => {
  assert.ok(Math.abs(wiggle(0.125)) > 0.01);
  near(wiggle(2), 0);
  near(wiggle(10), 0);
});

test("yawn: stretch, eyes close, then a still sleeping pose", () => {
  const out = { sx: 1, sy: 1, eyeOpen: 1 };
  yawn(0.8, out);
  assert.ok(out.sy > 1.03, "stretched in the yawn");
  yawn(SLEEP_SETTLE_S, out);
  near(out.eyeOpen, 0);
  const a = { ...out };
  yawn(SLEEP_SETTLE_S + 30, out);
  assert.deepEqual(out, a, "still after settling");
});
