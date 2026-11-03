// Levels: RMS, peak, dBFS conversions and a robust noise-floor estimate. Pure.

/** The quietest level we report; digital silence maps here instead of -Infinity. */
export const FLOOR_DB = -100;

const clampRange = (n, start, end) => [Math.max(0, start | 0), Math.min(n, end | 0)];

/** Root mean square of samples[start, end). 0 for an empty range. */
export function rms(samples, start = 0, end = samples.length) {
  const [a, b] = clampRange(samples.length, start, end);
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (b - a));
}

/** Largest |sample| in samples[start, end). */
export function peak(samples, start = 0, end = samples.length) {
  const [a, b] = clampRange(samples.length, start, end);
  let p = 0;
  for (let i = a; i < b; i++) {
    const v = samples[i] < 0 ? -samples[i] : samples[i];
    if (v > p) p = v;
  }
  return p;
}

/** Linear amplitude → dBFS, clamped at FLOOR_DB. */
export function dbfs(x) {
  return x > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(x)) : FLOOR_DB;
}

/** dB → linear amplitude. */
export function fromDb(db) {
  return 10 ** (db / 20);
}

/**
 * Noise floor of a list of frame levels (dBFS): a low percentile, so that short loud
 * events (a word, a beep) don't lift it. Median by default.
 */
export function noiseFloor(levels, { percentile = 0.5 } = {}) {
  if (!levels.length) return FLOOR_DB;
  const sorted = Array.from(levels).sort((a, b) => a - b);
  const i = Math.round(Math.min(1, Math.max(0, percentile)) * (sorted.length - 1));
  return sorted[i];
}

/** RMS level in dBFS per frame of `frameMs`. The last partial frame is dropped. */
export function frameLevels(samples, sampleRate, frameMs = 10) {
  const size = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  const n = Math.floor(samples.length / size);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) out[f] = dbfs(rms(samples, f * size, (f + 1) * size));
  return out;
}

/** dBFS → 0..1 for a level meter. */
export function meterLevel(db, { minDb = -60, maxDb = 0 } = {}) {
  return Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
}
