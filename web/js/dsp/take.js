// Non-destructive take processing (ARCHITECTURE §8, US-4.1, US-4.4): the recorded bytes stay
// untouched; we compute trim points, a peak-normalising gain and a verdict. Pure.
import { frameLevels, noiseFloor, peak, dbfs, FLOOR_DB } from "./level.js";

export const TAKE = Object.freeze({
  frameMs: 10,
  marginDb: 10,        // speech is this far above the noise floor
  floorPercentile: 0.05,
  preMs: 60,           // keep a little air before the first loud frame (soft onsets)
  postMs: 150,         // and after the last (consonant tails, decays)
  silentDb: -50,       // nothing louder than this: silent
  minMs: 300,          // US-4.4: under 0.3 s is too short
  ceilingDb: -1,       // peak ceiling after gain
  maxGainDb: 18,
  minGainDb: -24,
});

/**
 * Where the speech starts and ends, in ms, padded. `{startMs:0, endMs:0}` when nothing in the
 * take stands out from its noise floor. `opts.floorDb` is the floor the recorder measured live.
 */
export function trimPoints(samples, sampleRate, opts = {}) {
  const o = { ...TAKE, ...opts };
  const levels = frameLevels(samples, sampleRate, o.frameMs);
  if (!levels.length) return { startMs: 0, endMs: 0 };
  let loudest = FLOOR_DB;
  for (const l of levels) if (l > loudest) loudest = l;
  let floor = noiseFloor(levels, { percentile: o.floorPercentile });
  if (Number.isFinite(opts.floorDb)) floor = Math.min(floor, opts.floorDb);
  if (loudest < o.silentDb || loudest < floor + o.marginDb) return { startMs: 0, endMs: 0 };
  const threshold = Math.min(floor + o.marginDb, loudest - 6);
  let first = -1;
  let last = -1;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] > threshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const totalMs = (samples.length / sampleRate) * 1000;
  return {
    startMs: Math.round(Math.max(0, first * o.frameMs - o.preMs)),
    endMs: Math.round(Math.min(totalMs, (last + 1) * o.frameMs + o.postMs)),
  };
}

/** Gain in dB (0.1 dB steps) that brings `peakLinear` to the ceiling, capped at +18 dB. */
export function gainFor(peakLinear, ceilingDb = TAKE.ceilingDb, { maxDb = TAKE.maxGainDb, minDb = TAKE.minGainDb } = {}) {
  if (!(peakLinear > 0)) return 0;
  const g = Math.min(maxDb, Math.max(minDb, ceilingDb - dbfs(peakLinear)));
  return Math.round(g * 10) / 10 + 0; // + 0 turns -0 into 0
}

/** US-4.4: 'ok' | 'too-short' | 'silent'. `trimmedMs` is the kept length after trimming. */
export function validateTake({ durationMs, trimmedMs, peak: p }, { minMs = TAKE.minMs, silentDb = TAKE.silentDb } = {}) {
  if (durationMs < minMs) return "too-short";
  if (trimmedMs <= 0 || dbfs(p) < silentDb) return "silent";
  if (trimmedMs < minMs) return "too-short";
  return "ok";
}

/**
 * Everything the recorder needs from decoded mono samples:
 * {durationMs, trimStartMs, trimEndMs, peak, gainDb, verdict}. Gain is computed from the kept part.
 */
export function analyseTake(samples, sampleRate, opts = {}) {
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  const { startMs, endMs } = trimPoints(samples, sampleRate, opts);
  const a = Math.floor((startMs / 1000) * sampleRate);
  const b = Math.ceil((endMs / 1000) * sampleRate);
  const p = endMs > startMs ? peak(samples, a, b) : peak(samples);
  const verdict = validateTake({ durationMs, trimmedMs: endMs - startMs, peak: p });
  return { durationMs, trimStartMs: startMs, trimEndMs: endMs, peak: p, gainDb: verdict === "ok" ? gainFor(p, opts.ceilingDb ?? TAKE.ceilingDb) : 0, verdict };
}

