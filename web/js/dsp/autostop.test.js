import { test } from "node:test";
import assert from "node:assert/strict";
import { autoStopInit, autoStopStep, AUTO_STOP } from "./autostop.js";
import { frameLevels } from "./level.js";
import { take } from "../../../tests/signals.js";

const FRAME = 30; // ms, like the recorder's analyser polling

/** Feeds a synthetic take through the reducer in 30 ms frames; returns the final state. */
function run(samples, opts) {
  const levels = frameLevels(samples, 16000, FRAME);
  let s = autoStopInit(opts);
  for (let i = 0; i < levels.length && !s.stop; i++) s = autoStopStep(s, (i + 1) * FRAME, levels[i]);
  return s;
}

test("measures the noise floor in the first 300 ms", () => {
  const s = run(take({ noiseDb: -50, bursts: [[600, 1000]], totalMs: 1000 }));
  assert.ok(Math.abs(s.floorDb - -50) < 1.5, `floor ${s.floorDb}`);
  assert.equal(s.stop, null, "still listening");
});

test("stops about 800 ms after speech ends", () => {
  const s = run(take({ noiseDb: -55, bursts: [[500, 1200]], totalMs: 4000 }));
  assert.equal(s.stop, "silence");
  assert.ok(s.heardAt >= 450 && s.heardAt <= 560, `heard at ${s.heardAt}`);
  const after = s.stopAtMs - 1200;
  assert.ok(after >= AUTO_STOP.silenceMs - 10 && after <= AUTO_STOP.silenceMs + 2 * FRAME, `stopped ${after} ms after speech`);
});

test("pauses shorter than 800 ms inside a phrase don't stop it", () => {
  const s = run(take({ noiseDb: -55, bursts: [[400, 800], [1300, 1700], [2300, 2600]], totalMs: 5000 }));
  assert.equal(s.stop, "silence");
  assert.ok(s.stopAtMs > 2600 + 700, `stopped at ${s.stopAtMs}`);
});

test("never stops on silence before any speech; the 5 s cap ends it", () => {
  const s = run(take({ noiseDb: -60, bursts: [], totalMs: 6000 }));
  assert.equal(s.stop, "cap");
  assert.equal(s.stopAtMs, 5010);
  assert.equal(s.heardAt, null);
});

test("speech that runs into the cap stops at 5 s", () => {
  const s = run(take({ noiseDb: -55, bursts: [[300, 6000]], totalMs: 6000 }));
  assert.equal(s.stop, "cap");
  assert.ok(s.stopAtMs >= 5000 && s.stopAtMs < 5000 + FRAME);
});

test("speech that starts during calibration still counts (floor is capped)", () => {
  const s = run(take({ noiseDb: -55, bursts: [[0, 900]], amp: 0.3, totalMs: 3000 }));
  assert.equal(s.stop, "silence");
  assert.ok(s.floorDb <= AUTO_STOP.maxFloorDb);
  assert.ok(s.heardAt !== null && s.heardAt <= 300, `heard at ${s.heardAt}`);
});

test("digital silence (a muted mic) gets a sane floor, so a beep still counts", () => {
  const s = run(take({ noiseDb: -140, bursts: [[500, 560]], totalMs: 2000 }));
  assert.equal(s.floorDb, AUTO_STOP.minFloorDb);
  assert.equal(s.stop, "silence");
});

test("a stopped state is final and the reducer is pure", () => {
  const s0 = autoStopInit({ capMs: 100 });
  const s1 = autoStopStep(s0, 120, -60);
  assert.equal(s1.stop, "cap");
  assert.equal(s0.stop, null, "input untouched");
  assert.equal(autoStopStep(s1, 200, -10), s1);
});
