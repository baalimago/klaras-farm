// Synthetic audio for DSP tests: seeded noise, sine bursts, silence. Deterministic.

export function seeded(seed = 7) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Float32Array of `ms` milliseconds at `sampleRate`. */
export function silence(ms, sampleRate = 16000) {
  return new Float32Array(Math.round((ms / 1000) * sampleRate));
}

/** Adds uniform white noise with the given RMS level (dBFS) in place. */
export function addNoise(samples, rmsDb, rng = seeded()) {
  // uniform in [-a, a] has RMS a/sqrt(3)
  const a = 10 ** (rmsDb / 20) * Math.sqrt(3);
  for (let i = 0; i < samples.length; i++) samples[i] += (rng() * 2 - 1) * a;
  return samples;
}

/** Adds a sine burst with peak amplitude `amp` from `fromMs` to `toMs` (5 ms raised-cosine edges). */
export function addBurst(samples, { fromMs, toMs, freq = 440, amp = 0.5, sampleRate = 16000 }) {
  const a = Math.round((fromMs / 1000) * sampleRate);
  const b = Math.min(samples.length, Math.round((toMs / 1000) * sampleRate));
  const edge = Math.round(0.005 * sampleRate);
  for (let i = a; i < b; i++) {
    const k = i - a;
    const env = k < edge ? 0.5 - 0.5 * Math.cos((Math.PI * k) / edge) : b - i < edge ? 0.5 - 0.5 * Math.cos((Math.PI * (b - i)) / edge) : 1;
    samples[i] += amp * env * Math.sin((2 * Math.PI * freq * k) / sampleRate);
  }
  return samples;
}

/** A take: `totalMs` of noise at `noiseDb` with bursts [[from, to], ...]. */
export function take({ totalMs = 2000, noiseDb = -60, bursts = [[500, 1100]], amp = 0.3, freq = 300, sampleRate = 16000, seed = 7 } = {}) {
  const s = addNoise(silence(totalMs, sampleRate), noiseDb, seeded(seed));
  for (const [fromMs, toMs] of bursts) addBurst(s, { fromMs, toMs, amp, freq, sampleRate });
  return s;
}
