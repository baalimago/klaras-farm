import { test } from "node:test";
import assert from "node:assert/strict";
import { trimPoints, gainFor, validateTake, analyseTake, TAKE } from "./take.js";
import { dbfs, peak } from "./level.js";
import { take, silence, addBurst } from "../../../tests/signals.js";

const SR = 16000;
const within = (v, lo, hi, msg) => assert.ok(v >= lo && v <= hi, `${msg}: ${v} not in [${lo}, ${hi}]`);

test("trims leading and trailing silence around a burst in quiet noise, with padding", () => {
  const { startMs, endMs } = trimPoints(take({ noiseDb: -60, bursts: [[600, 1300]], totalMs: 2500 }), SR);
  within(startMs, 600 - TAKE.preMs - 15, 600 - TAKE.preMs + 15, "start");
  within(endMs, 1300 + TAKE.postMs - 15, 1300 + TAKE.postMs + 15, "end");
});

test("keeps everything between the first and the last word", () => {
  const { startMs, endMs } = trimPoints(take({ noiseDb: -55, bursts: [[300, 600], [1500, 1800]], totalMs: 3000 }), SR);
  within(startMs, 200, 300, "start");
  within(endMs, 1800, 2000, "end");
});

test("works in a noisy room (noise 25 dB below the voice)", () => {
  const { startMs, endMs } = trimPoints(take({ noiseDb: -38, amp: 0.25, bursts: [[800, 1400]], totalMs: 3000 }), SR);
  within(startMs, 650, 800, "start");
  within(endMs, 1400, 1600, "end");
});

test("uses a measured floor when the recorder supplies one", () => {
  const s = take({ noiseDb: -60, bursts: [[200, 2300]], totalMs: 2400 });
  const { startMs, endMs } = trimPoints(s, SR, { floorDb: -60 });
  within(startMs, 100, 200, "start");
  within(endMs, 2300, 2400, "end");
});

test("padding never runs past the ends", () => {
  const { startMs, endMs } = trimPoints(take({ noiseDb: -60, bursts: [[0, 900]], totalMs: 1000 }), SR);
  assert.equal(startMs, 0);
  assert.equal(endMs, 1000);
});

test("silence and plain noise trim to nothing", () => {
  assert.deepEqual(trimPoints(silence(1000, SR), SR), { startMs: 0, endMs: 0 });
  assert.deepEqual(trimPoints(take({ noiseDb: -50, bursts: [] }), SR), { startMs: 0, endMs: 0 });
  assert.deepEqual(trimPoints(new Float32Array(0), SR), { startMs: 0, endMs: 0 });
});

test("gain normalises the peak to -1 dBFS, at most +18 dB", () => {
  assert.equal(gainFor(0.5), 5);
  assert.equal(gainFor(10 ** (-1 / 20)), 0);
  assert.equal(gainFor(0.25, -3), 9);
  assert.equal(gainFor(0.001), 18, "quiet takes are capped");
  assert.equal(gainFor(1.4), -3.9, "hot takes come down");
  assert.equal(gainFor(0), 0, "silence gets no gain");
});

test("normalised peak lands at the ceiling for a real take", () => {
  const s = take({ noiseDb: -60, amp: 0.2, bursts: [[500, 900]] });
  const g = gainFor(peak(s));
  assert.ok(Math.abs(dbfs(peak(s)) + g - -1) <= 0.05);
});

test("validates takes: too short, silent, ok", () => {
  assert.equal(validateTake({ durationMs: 200, trimmedMs: 150, peak: 0.5 }), "too-short");
  assert.equal(validateTake({ durationMs: 2000, trimmedMs: 0, peak: 0.0001 }), "silent");
  assert.equal(validateTake({ durationMs: 2000, trimmedMs: 0, peak: 0.5 }), "silent");
  assert.equal(validateTake({ durationMs: 2000, trimmedMs: 900, peak: 0.002 }), "silent", "below -50 dBFS");
  assert.equal(validateTake({ durationMs: 2000, trimmedMs: 250, peak: 0.5 }), "too-short");
  assert.equal(validateTake({ durationMs: 2000, trimmedMs: 600, peak: 0.5 }), "ok");
});

test("analyseTake: a clean word passes with trim and gain", () => {
  const a = analyseTake(take({ noiseDb: -60, amp: 0.25, bursts: [[500, 1100]], totalMs: 2000 }), SR);
  assert.equal(a.verdict, "ok");
  assert.equal(a.durationMs, 2000);
  within(a.trimStartMs, 420, 460, "trimStart");
  within(a.trimEndMs, 1230, 1270, "trimEnd");
  within(a.gainDb, 10.9, 11.1, "gain");
});

test("analyseTake: a click is too short, a quiet room is silent", () => {
  assert.equal(analyseTake(addBurst(take({ noiseDb: -60, bursts: [] }), { fromMs: 900, toMs: 940, amp: 0.4, sampleRate: SR }), SR).verdict, "too-short");
  assert.equal(analyseTake(take({ noiseDb: -60, bursts: [] }), SR).verdict, "silent");
  assert.equal(analyseTake(take({ noiseDb: -60, bursts: [[0, 200]], totalMs: 200 }), SR).verdict, "too-short");
});
