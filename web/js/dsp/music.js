// Background music as data: a slow, generated music-box lullaby (original, no audio files).
// Pure. io/music.js schedules one bar at a time through the same note synth as the chimes.
//
// Shape: 3/4 at 56 bpm, C major, an eight-bar loop of chords (C Am F G | C Am Dm G).
// Each bar has a soft low root, a filtered pad on the chord and a sparse music-box melody
// that walks the pentatonic scale and lands on chord tones. A seed makes it repeatable, and
// every eight bars the melody is drawn afresh so it never sounds like a short loop.
// Notes use the chime note shape: {wave, at, freq, attack, decay, gain, partials?, filter?}.

/** Music bus level relative to full scale, and how far it dips while a voice plays. */
export const MUSIC_BUS_DB = -16;
export const MUSIC_DUCK_DB = -14;
export const MUSIC_FADE_S = 2.5;

export const BPM = 56;
export const BEATS_PER_BAR = 3;
export const BAR_S = (60 / BPM) * BEATS_PER_BAR;

const midi = (m) => 440 * 2 ** ((m - 69) / 12);

// Chords as MIDI notes around middle C (C4 = 60). Root first.
export const PROGRESSION = Object.freeze([
  [60, 64, 67], // C
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [55, 59, 62], // G
  [60, 64, 67], // C
  [57, 60, 64], // Am
  [50, 53, 57], // Dm
  [55, 59, 62], // G
]);

// Melody range: C5..A5 plus D6, the soft middle of a music box (no shrill highs).
const SCALE = Object.freeze([72, 74, 76, 79, 81, 84, 86]); // C D E G A C D (pentatonic)

// Rhythm cells in beats (3/4): which eighth-note slots carry a melody note.
const RHYTHMS = Object.freeze([
  [0, 1, 2],
  [0, 2],
  [0, 1.5, 2],
  [0, 1, 1.5, 2],
  [0],
  [0, 2.5],
]);

/** A seeded generator (LCG) so a phrase can be rebuilt bar by bar. */
export function seededRng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** The notes for one bar (times relative to the bar start, in seconds). */
export function musicBar(bar, seed = 1) {
  const chord = PROGRESSION[((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length];
  const phrase = Math.floor(bar / PROGRESSION.length);
  const inPhrase = ((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length;
  const beat = 60 / BPM;
  const notes = [];

  // Low root: a warm sine an octave down, ringing through the bar.
  notes.push({ wave: "sine", at: 0, freq: midi(chord[0] - 12), attack: 0.08, decay: BAR_S * 0.95, gain: 0.32 });

  // Pad: the chord, triangle through a low-pass, swelling in slowly.
  for (const m of chord) notes.push({ wave: "triangle", at: 0.02, freq: midi(m), attack: 0.9, decay: BAR_S * 1.1, gain: 0.07, filter: 900 });

  // Melody: rebuilt from the phrase seed so each bar is independent of play history.
  const rng = seededRng(seed * 7919 + phrase * 104729 + 1);
  // Walk the whole phrase up to this bar to keep the melody line continuous.
  let idx = 2 + Math.floor(rng() * 3);
  let rhythm = null;
  for (let b = 0; b <= inPhrase; b++) {
    rhythm = b === PROGRESSION.length - 1 ? [0] : RHYTHMS[Math.floor(rng() * RHYTHMS.length)];
    const steps = rhythm.map(() => Math.round((rng() - 0.5) * 3));
    const rests = rhythm.map((_, i) => i > 0 && rng() < 0.3);
    if (b < inPhrase) {
      for (const s of steps) idx = clamp(idx + s, 0, SCALE.length - 1);
      continue;
    }
    rhythm.forEach((at, i) => {
      idx = clamp(idx + steps[i], 0, SCALE.length - 1);
      let m = SCALE[idx];
      // Strong beat and phrase end: land on the nearest chord tone (any octave).
      if (at === 0) m = nearestChordTone(m, chord);
      if (rests[i]) return;
      const last = b === PROGRESSION.length - 1;
      notes.push({
        wave: "sine",
        at: at * beat,
        freq: midi(m),
        attack: 0.006,
        decay: last ? BAR_S * 0.9 : 1.4,
        gain: at === 0 ? 0.2 : 0.14,
        partials: [[2, 0.12], [3, 0.03]],
      });
    });
  }
  return notes;
}

function nearestChordTone(m, chord) {
  let best = m, dist = Infinity;
  for (const c of chord) {
    for (let o = -2; o <= 2; o++) {
      const t = (c % 12) + 12 * (Math.floor(m / 12) + o);
      const d = Math.abs(t - m);
      if (t >= 72 && t <= 88 && d < dist) { best = t; dist = d; }
    }
  }
  return best;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
