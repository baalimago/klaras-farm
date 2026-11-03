import { test } from "node:test";
import assert from "node:assert/strict";
import { rms, dbfs, fromDb, noiseFloor, frameLevels, peak, meterLevel, FLOOR_DB } from "./level.js";
import { silence, addNoise, addBurst, seeded } from "../../../tests/signals.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (±${tol})`);

test("rms of a full-scale sine is 1/sqrt(2), of silence 0", () => {
  const s = addBurst(silence(1000), { fromMs: 0, toMs: 1000, amp: 1, freq: 500 });
  near(rms(s, 800, 15200), Math.SQRT1_2, 0.002);
  assert.equal(rms(silence(100)), 0);
  assert.equal(rms(new Float32Array(0)), 0);
  assert.equal(rms(s, 50, 50), 0, "empty range");
});

test("dbfs and fromDb are inverse; zero and negatives clamp to the floor", () => {
  near(dbfs(1), 0, 1e-9);
  near(dbfs(0.5), -6.0206, 1e-3);
  near(fromDb(-6.0206), 0.5, 1e-4);
  near(dbfs(fromDb(-37)), -37, 1e-9);
  assert.equal(dbfs(0), FLOOR_DB);
  assert.equal(dbfs(-1), FLOOR_DB);
  assert.equal(dbfs(1e-20), FLOOR_DB);
});

test("noise floor ignores occasional loud frames (median by default, percentile on request)", () => {
  const levels = [-62, -61, -60, -59, -58, -20, -18];
  assert.equal(noiseFloor(levels), -59);
  assert.equal(noiseFloor(levels, { percentile: 0 }), -62);
  assert.equal(noiseFloor(levels, { percentile: 1 }), -18);
  assert.equal(noiseFloor([]), FLOOR_DB);
  assert.deepEqual(levels, [-62, -61, -60, -59, -58, -20, -18], "input untouched");
});

test("frame levels measure white noise at its RMS level", () => {
  const s = addNoise(silence(1000), -40, seeded(3));
  const levels = frameLevels(s, 16000, 10);
  assert.equal(levels.length, 100);
  near(noiseFloor(Array.from(levels)), -40, 1);
});

test("peak finds the largest magnitude in a range", () => {
  const s = silence(100);
  s[10] = -0.8;
  s[500] = 0.3;
  assert.equal(peak(s), Math.fround(0.8));
  assert.equal(peak(s, 100, 1000), Math.fround(0.3));
  assert.equal(peak(s, 0, 0), 0);
});

test("meter level maps dB onto 0..1", () => {
  assert.equal(meterLevel(-100), 0);
  assert.equal(meterLevel(0), 1);
  assert.equal(meterLevel(5), 1);
  near(meterLevel(-30), 0.5, 1e-9);
});
