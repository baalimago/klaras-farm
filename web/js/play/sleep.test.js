import { test } from "node:test";
import assert from "node:assert/strict";
import { createSleep, tickSleep, sleepRemainingS } from "./sleep.js";

test("default-style timer falls asleep after its minutes of play, exactly once", () => {
  const s = createSleep(8);
  assert.equal(sleepRemainingS(s), 480);
  assert.equal(tickSleep(s, 479), false);
  assert.equal(s.asleep, false);
  assert.equal(tickSleep(s, 1), true, "fires on the step that crosses the limit");
  assert.equal(s.asleep, true);
  assert.equal(tickSleep(s, 100), false, "fires once");
  assert.equal(sleepRemainingS(s), Infinity);
});

test("0 minutes is off", () => {
  const s = createSleep(0);
  assert.equal(tickSleep(s, 1e6), false);
  assert.equal(sleepRemainingS(s), Infinity);
});

test("bad input is treated as off", () => {
  for (const m of [undefined, null, -3, NaN, "8"]) assert.equal(sleepRemainingS(createSleep(m)), Infinity);
});

test("paused timers do not advance", () => {
  const s = createSleep(5);
  s.paused = true;
  tickSleep(s, 1000);
  assert.equal(sleepRemainingS(s), Infinity, "no wake needed while paused");
  s.paused = false;
  assert.equal(sleepRemainingS(s), 300);
});

test("a fresh timer restarts the count (edit mode, settings change)", () => {
  const s = createSleep(5);
  tickSleep(s, 299);
  const t = createSleep(5);
  assert.equal(sleepRemainingS(t), 300);
});
