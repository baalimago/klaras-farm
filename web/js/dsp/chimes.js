// Feedback sounds as data (ux-flows "audio feedback"): soft, felt-like notes synthesised by
// io/audio.js with oscillators and envelopes. No audio files. Pure.
//
// Note: {wave, at, freq, toFreq?, slide?, attack, decay, gain, partials?, filter?, toFilter?}
//   wave: 'sine' | 'triangle' | 'noise'; times in seconds; gain is linear before the chime bus.
//   Envelope: linear attack to `gain`, then exponential decay to silence over `decay`.
//   partials: [[frequency ratio, relative gain], ...] extra sines for a gentle bell colour.
//   filter: low-pass cutoff in Hz (sweeps to toFilter over the note).
import { dbfs } from "./level.js";

/** Chime bus level relative to the voice bus. */
export const CHIME_BUS_DB = -8;

const C5 = 523.25, E5 = 659.25, G5 = 783.99, B5 = 987.77, D5 = 587.33, A5 = 880, G6 = 1567.98, D6 = 1174.66;

/** One soft editing note: sine, faint octave, 4 ms attack. */
function soft(freq, at, decay, gain) {
  return { wave: "sine", at, freq, attack: 0.004, decay, gain, partials: [[2, 0.08]] };
}

export const CHIMES = Object.freeze({
  // A tap on a thing without a recording: a soft two-note music-box ding.
  tap: [
    { wave: "sine", at: 0, freq: G5, attack: 0.008, decay: 0.45, gain: 0.42, partials: [[2, 0.18], [3, 0.05]] },
    { wave: "sine", at: 0.07, freq: B5, attack: 0.008, decay: 0.4, gain: 0.3, partials: [[2, 0.12]] },
  ],
  // Edit mode: three rising notes in; three falling notes out.
  enter: [
    { wave: "triangle", at: 0, freq: C5, attack: 0.01, decay: 0.32, gain: 0.4, filter: 2400 },
    { wave: "triangle", at: 0.11, freq: E5, attack: 0.01, decay: 0.32, gain: 0.4, filter: 2400 },
    { wave: "triangle", at: 0.22, freq: G5, attack: 0.01, decay: 0.45, gain: 0.42, filter: 2400 },
  ],
  leave: [
    { wave: "triangle", at: 0, freq: G5, attack: 0.01, decay: 0.32, gain: 0.4, filter: 2400 },
    { wave: "triangle", at: 0.11, freq: E5, attack: 0.01, decay: 0.32, gain: 0.4, filter: 2400 },
    { wave: "triangle", at: 0.22, freq: C5, attack: 0.01, decay: 0.45, gain: 0.42, filter: 2400 },
  ],
  // Recording starts: a short blip; stops: a lower blip.
  start: [{ wave: "sine", at: 0, freq: A5, attack: 0.005, decay: 0.12, gain: 0.45, partials: [[2, 0.1]] }],
  stop: [{ wave: "sine", at: 0, freq: D5, attack: 0.005, decay: 0.14, gain: 0.45, partials: [[2, 0.1]] }],
  // Saved: a felt "plink" as the thing drops in (a small pitch drop and a soft thump).
  plink: [
    { wave: "sine", at: 0, freq: G6, toFreq: D6, slide: 0.06, attack: 0.003, decay: 0.32, gain: 0.36, partials: [[2, 0.15]] },
    { wave: "sine", at: 0, freq: 196, toFreq: 130, slide: 0.08, attack: 0.004, decay: 0.12, gain: 0.3 },
  ],
  // Delete (after confirming): a soft "poof" of filtered noise.
  poof: [{ wave: "noise", at: 0, freq: 0, attack: 0.02, decay: 0.4, gain: 0.4, filter: 1800, toFilter: 250 }],
  // Hold complete: a rounded "pop".
  "hold-done": [{ wave: "sine", at: 0, freq: 660, toFreq: 220, slide: 0.07, attack: 0.002, decay: 0.11, gain: 0.5 }],
  // Find it, right answer: a bright four-note music-box run (C E G C).
  yay: [
    { wave: "sine", at: 0, freq: C5, attack: 0.006, decay: 0.35, gain: 0.34, partials: [[2, 0.14]] },
    { wave: "sine", at: 0.09, freq: E5, attack: 0.006, decay: 0.35, gain: 0.34, partials: [[2, 0.14]] },
    { wave: "sine", at: 0.18, freq: G5, attack: 0.006, decay: 0.4, gain: 0.36, partials: [[2, 0.14]] },
    { wave: "sine", at: 0.27, freq: 1046.5, attack: 0.006, decay: 0.5, gain: 0.36, partials: [[2, 0.12], [3, 0.04]] },
  ],

  // ---- Editing (parent): one quiet family of short felt "pocks". Every note is a sine with the
  // same faint octave partial, a 4 ms attack and a short decay, on C-major pentatonic pitches, so
  // the sounds feel like one set. Rising = something starts or goes forward; falling = it lands,
  // goes back or is undone. Kept well under the child's `tap` chime.
  select: [soft(E5, 0, 0.12, 0.24)],
  pick: [{ ...soft(D5, 0, 0.14, 0.24), toFreq: A5, slide: 0.05 }],
  drop: [
    { ...soft(A5, 0, 0.16, 0.24), toFreq: D5, slide: 0.05 },
    { wave: "sine", at: 0, freq: 180, toFreq: 120, slide: 0.06, attack: 0.004, decay: 0.08, gain: 0.18 },
  ],
  tool: [{ wave: "triangle", at: 0, freq: D6, attack: 0.004, decay: 0.06, gain: 0.16, filter: 2200 }],
  colour: [soft(G5, 0, 0.14, 0.2), soft(D6, 0.05, 0.18, 0.18)],
  add: [soft(C5, 0, 0.16, 0.24), soft(G5, 0.07, 0.22, 0.24)],
  undo: [soft(G5, 0, 0.12, 0.22), soft(D5, 0.06, 0.16, 0.22)],
  next: [soft(E5, 0, 0.1, 0.2), soft(A5, 0.05, 0.14, 0.2)],
  back: [soft(A5, 0, 0.1, 0.2), soft(E5, 0.05, 0.14, 0.2)],
  toggle: [{ wave: "triangle", at: 0, freq: A5, attack: 0.004, decay: 0.09, gain: 0.18, filter: 2400 }],
  save: [soft(C5, 0, 0.22, 0.18), soft(E5, 0.04, 0.22, 0.18), soft(G5, 0.08, 0.26, 0.2)],
});

/** The editing sounds (parent UI). Each edit action plays exactly one of these, or `poof` for a delete. */
export const EDIT_CHIMES = Object.freeze(["select", "pick", "drop", "tool", "colour", "add", "undo", "next", "back", "toggle", "save"]);

/** A second chime of the same kind within this many seconds is skipped (mash-safe: a burst of taps is one sound). */
export const CHIME_REPEAT_S = 0.04;

/** True when a chime of a kind last started at `lastAt` (seconds, or undefined) may start again at `now`. */
export function chimeAllowed(lastAt, now, gap = CHIME_REPEAT_S) {
  return lastAt === undefined || now - lastAt >= gap || now < lastAt;
}

export const CHIME_KINDS = Object.freeze(Object.keys(CHIMES));

/** The soft tone that rises with the hold ring (US-11.1): over `rise` seconds from freq to toFreq. */
export const HOLD_TONE = Object.freeze({ wave: "sine", freq: 330, toFreq: 495, rise: 1.0, attack: 0.08, release: 0.06, gain: 0.14 });

/** Silence threshold the exponential decay ramps to. */
export const SILENT = 0.0001;

/** Envelope value of one note at time t (seconds since the chime started). */
export function envelopeAt(note, t) {
  const u = t - note.at;
  if (u < 0) return 0;
  if (u < note.attack) return (note.gain * u) / note.attack;
  const d = (u - note.attack) / note.decay;
  if (d >= 1) return 0;
  return note.gain * (SILENT / note.gain) ** d;
}

/** Length of a chime in seconds. */
export function chimeDuration(kind) {
  return Math.max(...CHIMES[kind].map((n) => n.at + n.attack + n.decay));
}

/**
 * Upper bound of a chime's peak in dBFS at the output: all partials in phase at the
 * envelope's highest point, after the chime bus gain.
 */
export function chimePeakDb(kind) {
  const notes = CHIMES[kind];
  let worst = 0;
  for (let t = 0; t <= chimeDuration(kind); t += 0.001) {
    let sum = 0;
    for (const n of notes) sum += envelopeAt(n, t) * (1 + (n.partials ?? []).reduce((a, [, g]) => a + g, 0));
    if (sum > worst) worst = sum;
  }
  return dbfs(worst) + CHIME_BUS_DB;
}
