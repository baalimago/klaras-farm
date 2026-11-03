import { test } from "node:test";
import assert from "node:assert/strict";
import { initialHold, nextHold, HOLD } from "./hold.js";

const VW = 1180;
const VH = 820;
const down = (fields = {}) => ({ type: "down", x: 500, y: 400, t: 1000, width: 20, height: 20, vw: VW, vh: VH, pointerId: 1, ...fields });
const run = (events, opts) => events.reduce((s, e) => nextHold(s, e, opts), initialHold());

test("nothing shows for the first 0.5 s, then the ring fills until armed at 1.5 s", () => {
  let s = nextHold(initialHold(), down());
  assert.equal(s.phase, "pending");
  s = nextHold(s, { type: "tick", t: 1400 });
  assert.equal(s.phase, "pending");
  assert.equal(s.progress, 0);
  s = nextHold(s, { type: "tick", t: 1500 });
  assert.equal(s.phase, "showing");
  assert.equal(s.progress, 0);
  s = nextHold(s, { type: "tick", t: 2000 });
  assert.equal(s.phase, "showing");
  assert.equal(s.progress, 0.5);
  s = nextHold(s, { type: "tick", t: 2499 });
  assert.equal(s.phase, "showing");
  s = nextHold(s, { type: "tick", t: 2500 });
  assert.equal(s.phase, "armed");
  assert.equal(s.progress, 1);
});

test("release, cancel, a second touch or moving more than 10 px cancels silently", () => {
  for (const e of [
    { type: "up", pointerId: 1 },
    { type: "cancel", pointerId: 1 },
    { type: "second-pointer", pointerId: 2 },
    { type: "move", x: 511, y: 400, pointerId: 1 },
    { type: "move", x: 508, y: 408, pointerId: 1 },
    { type: "down", ...down({ pointerId: 2 }) },
  ]) {
    const s = run([down(), { type: "tick", t: 1700 }, e]);
    assert.equal(s.phase, "cancelled", JSON.stringify(e));
    assert.equal(s.progress, 0);
  }
});

test("small wobbles and other pointers' moves are ignored", () => {
  const s = run([down(), { type: "move", x: 506, y: 406, pointerId: 1 }, { type: "move", x: 900, y: 100, pointerId: 7 }, { type: "tick", t: 2500 }]);
  assert.equal(s.phase, "armed");
});

test("a palm never holds, at the start or when the contact grows", () => {
  assert.equal(run([down({ width: 200, height: 180 })]).phase, "cancelled");
  assert.equal(run([down(), { type: "move", x: 500, y: 400, width: 190, height: 170, pointerId: 1 }]).phase, "cancelled");
});

test("a big iPad fingertip (up to ~90 px contact) is a finger, not a palm", () => {
  assert.equal(run([down({ width: 90, height: 90 })]).phase, "pending");
  assert.equal(run([down({ width: 120, height: 40 })]).phase, "pending");
});

test("never starts in the bottom 40 px or within 20 px of the side edges", () => {
  assert.equal(run([down({ y: VH - 39 })]).phase, "cancelled");
  assert.equal(run([down({ x: 19 })]).phase, "cancelled");
  assert.equal(run([down({ x: VW - 19 })]).phase, "cancelled");
  assert.equal(run([down({ y: VH - 41, x: 21 })]).phase, "pending");
});

test("an armed hold stays armed; release only marks it released", () => {
  let s = run([down(), { type: "tick", t: 2600 }]);
  s = nextHold(s, { type: "move", x: 600, y: 400, pointerId: 1 });
  assert.equal(s.phase, "armed");
  s = nextHold(s, { type: "up", pointerId: 1 });
  assert.equal(s.phase, "armed");
  assert.equal(s.released, true);
});

test("events after the end and ticks while idle change nothing", () => {
  const idle = initialHold();
  assert.equal(nextHold(idle, { type: "tick", t: 5000 }), idle);
  assert.equal(nextHold(idle, { type: "up", pointerId: 1 }), idle);
  const cancelled = run([down(), { type: "up", pointerId: 1 }]);
  assert.equal(nextHold(cancelled, { type: "tick", t: 9000 }), cancelled);
});

test("holdMs scales the phases (flag), keeping the silent first third", () => {
  const opts = { holdMs: 300 };
  let s = run([down(), { type: "tick", t: 1099 }], opts);
  assert.equal(s.phase, "pending");
  s = nextHold(s, { type: "tick", t: 1200 }, opts);
  assert.equal(s.phase, "showing");
  s = nextHold(s, { type: "tick", t: 1300 }, opts);
  assert.equal(s.phase, "armed");
  assert.equal(HOLD.holdMs, 1500);
  assert.equal(HOLD.showMs, 500);
});
