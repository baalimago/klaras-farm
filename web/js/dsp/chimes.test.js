import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIMES, CHIME_KINDS, CHIME_BUS_DB, HOLD_TONE, envelopeAt, chimePeakDb, chimeDuration } from "./chimes.js";
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
