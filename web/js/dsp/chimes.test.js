import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIMES, CHIME_KINDS, CHIME_BUS_DB, HOLD_TONE, EDIT_CHIMES, CHIME_REPEAT_S, envelopeAt, chimePeakDb, chimeDuration, chimeAllowed } from "./chimes.js";
import { dbfs } from "./level.js";

const VOICE_PEAK_DB = -1; // takes are normalised to a -1 dBFS peak (take.js)

test("every chime kind the app uses is defined", () => {
  for (const k of ["tap", "enter", "leave", "start", "stop", "plink", "poof", "hold-done"]) assert.ok(CHIMES[k]?.length, k);
  assert.deepEqual([...CHIME_KINDS].sort(), Object.keys(CHIMES).sort());
});

test("US-5.2: every chime peaks at least 6 dB below a normalised voice clip", () => {
  for (const k of CHIME_KINDS) {
    const p = chimePeakDb(k);
    assert.ok(p <= VOICE_PEAK_DB - 6, `${k} peaks at ${p.toFixed(1)} dBFS`);
    assert.ok(p > -30, `${k} is still audible (${p.toFixed(1)} dBFS)`);
  }
  assert.ok(dbfs(HOLD_TONE.gain) + CHIME_BUS_DB <= VOICE_PEAK_DB - 6, "hold tone");
});

test("chimes are short and soft-edged (no instant attacks that click)", () => {
  for (const k of CHIME_KINDS) {
    assert.ok(chimeDuration(k) <= 0.8, `${k} lasts ${chimeDuration(k)} s`);
    for (const n of CHIMES[k]) assert.ok(n.attack >= 0.002, `${k} attack`);
  }
});

test("entering edit mode rises, leaving falls; the stop blip is lower than the start blip", () => {
  const freqs = (k) => CHIMES[k].map((n) => n.freq);
  const e = freqs("enter");
  const l = freqs("leave");
  assert.equal(e.length, 3);
  assert.ok(e[0] < e[1] && e[1] < e[2]);
  assert.ok(l[0] > l[1] && l[1] > l[2]);
  assert.ok(CHIMES.stop[0].freq < CHIMES.start[0].freq);
});

test("envelope: silent before the note, peaks after the attack, decays away", () => {
  const n = { at: 0.1, attack: 0.01, decay: 0.3, gain: 0.5 };
  assert.equal(envelopeAt(n, 0.05), 0);
  assert.ok(Math.abs(envelopeAt(n, 0.11) - 0.5) < 1e-9);
  assert.ok(envelopeAt(n, 0.2) < 0.5);
  assert.ok(envelopeAt(n, 0.41) < 0.001);
  assert.equal(envelopeAt(n, 1), 0);
});

test("editing sounds: one quiet, short family, all defined", () => {
  const tapPeak = chimePeakDb("tap");
  for (const k of EDIT_CHIMES) {
    assert.ok(CHIMES[k]?.length, k);
    assert.ok(chimeDuration(k) <= 0.35, `${k} is short (${chimeDuration(k)} s)`);
    assert.ok(chimePeakDb(k) < tapPeak, `${k} is quieter than the child's tap`);
    for (const n of CHIMES[k]) {
      assert.ok(n.attack >= 0.002 && n.attack <= 0.01, `${k} attack`);
      assert.ok(n.freq >= 100 && n.freq <= 1200, `${k} stays in the soft register`);
    }
  }
});

test("editing sounds: forward and pick-up rise; back, drop and undo fall", () => {
  const dir = (k) => {
    const [a, b] = CHIMES[k];
    if (b && b.wave === a.wave && b.at > a.at) return Math.sign(b.freq - a.freq);
    return Math.sign((a.toFreq ?? a.freq) - a.freq);
  };
  for (const k of ["next", "pick", "add"]) assert.equal(dir(k), 1, k);
  for (const k of ["back", "drop", "undo"]) assert.equal(dir(k), -1, k);
});

test("chimeAllowed skips a repeat of the same kind inside the mash window", () => {
  assert.equal(chimeAllowed(undefined, 1), true);
  assert.equal(chimeAllowed(1, 1 + CHIME_REPEAT_S / 2), false);
  assert.equal(chimeAllowed(1, 1 + CHIME_REPEAT_S), true);
  assert.equal(chimeAllowed(5, 1), true, "a clock that went back (a new context) never blocks");
});
