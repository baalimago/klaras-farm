// The sounds of unwrapping, synthesized (no audio files): a crackly rip that follows the speed of
// the pull, a little pop when a finger pokes in, and a chime when the present is open.
//
// Contract: `unlock()` must be called synchronously inside the pointer handler (iPad only starts
// audio on a gesture). One rip voice at a time, so mashing never piles sounds up. Every method
// swallows its own failures: a missing or refused AudioContext only means silence.

const RIP_MAX_GAIN = 0.5;

export class RipSound {
  /** @param {{context?: AudioContext}} [opts] a host's own context, or one is made on unlock */
  constructor({ context } = {}) {
    this.ctx = context ?? null;
    this.ownsContext = !context;
    this.noise = null;
    this.voice = null;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      this.noise ??= crackle(this.ctx);
    } catch {
      this.ctx = null;
    }
  }

  /** Start the rip voice for a new tear (silent until the finger moves). */
  start() {
    this.stop();
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1400;
      band.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(band).connect(gain).connect(ctx.destination);
      src.start(0, Math.random() * this.noise.duration);
      this.voice = { src, band, gain };
    } catch {
      this.voice = null;
    }
  }

  /** @param {number} pxPerMs how fast the finger pulls */
  speed(pxPerMs) {
    const v = this.voice;
    if (!v) return;
    try {
      const t = this.ctx.currentTime;
      const k = Math.min(1, pxPerMs / 2.2);
      v.gain.gain.setTargetAtTime(RIP_MAX_GAIN * k, t, 0.02);
      v.band.frequency.setTargetAtTime(1100 + 2600 * k, t, 0.04);
    } catch {}
  }

  stop() {
    const v = this.voice;
    this.voice = null;
    if (!v) return;
    try {
      const t = this.ctx.currentTime;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.03);
      v.src.stop(t + 0.2);
    } catch {}
  }

  /** A short paper pop where a finger pokes in. */
  pop() {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.45, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.connect(band).connect(gain).connect(ctx.destination);
      src.start(t, Math.random() * (this.noise.duration - 0.1), 0.1);
    } catch {}
  }

  /** A rising four-note chime: the present is open. */
  chime() {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + 0.02;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const t = t0 + i * 0.11;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.75);
      });
    } catch {}
  }

  /** Let the audio hardware go once the chime has played (only a context this made). */
  close(afterMs = 1200) {
    this.stop();
    const ctx = this.ctx;
    if (!ctx || !this.ownsContext) return;
    setTimeout(() => ctx.close?.().catch(() => {}), afterMs);
  }
}

/** Noise in little crackly grains, like paper fibres giving way. */
function crackle(ctx) {
  const seconds = 1.5;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  const grain = Math.floor(ctx.sampleRate * 0.004);
  let amp = 0;
  for (let i = 0; i < data.length; i++) {
    if (i % grain === 0) amp = Math.random() ** 2.5;
    data[i] = (Math.random() * 2 - 1) * amp;
  }
  return buf;
}
