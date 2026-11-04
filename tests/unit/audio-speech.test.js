// AudioEngine's device voice with a fake speechSynthesis that behaves like iPad WebKit can:
// utterances that start and end, ones dropped after cancel() (end without start), ones never
// started (no gesture), voices that arrive late. playtest round 3: "the question must be heard".
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../../web/js/io/audio.js";

class FakeUtterance {
  constructor(text) { this.text = text; this.volume = 1; }
}

/** behave(u, n): what happens to the n-th utterance: 'speak' | 'drop' (end, no start) | 'silent' (no events). */
function fakeSynth(behave = () => "speak") {
  const synth = new EventTarget();
  Object.assign(synth, {
    speaking: false,
    pending: false,
    spoken: [],
    cancels: 0,
    voices: [],
    getVoices() { return this.voices; },
    cancel() { this.cancels++; this.speaking = false; const u = this.current; this.current = null; u?.onerror?.({ error: "interrupted" }); },
    speak(u) {
      const n = this.spoken.push(u) - 1;
      const how = behave(u, n);
      if (how === "silent") return;
      if (how === "drop") return void setTimeout(() => u.onend?.(), 1);
      this.current = u;
      this.speaking = true;
      setTimeout(() => {
        u.onstart?.();
        setTimeout(() => { if (this.current === u) { this.speaking = false; this.current = null; u.onend?.(); } }, 5);
      }, 1);
    },
  });
  globalThis.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  return synth;
}

afterEach(() => {
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
});

const engine = (opts = {}) => new AudioEngine({ AudioContextClass: null, speechStartMs: 60, ...opts });

test("speak resolves true once the voice started and finished, without cancelling an idle synthesiser", async () => {
  const synth = fakeSynth();
  const a = engine();
  assert.equal(a.canSpeak, true);
  assert.equal(await a.speak("Where is the hen?", "en"), true);
  assert.equal(synth.cancels, 0, "cancel() then speak() would drop the utterance on WebKit");
  assert.equal(synth.spoken[0].lang, "en");
  assert.equal(a.talking, false);
});

test("an utterance dropped by WebKit (ends without starting) is tried once more", async () => {
  const synth = fakeSynth((u, n) => (n === 0 ? "drop" : "speak"));
  assert.equal(await engine().speak("Where is the hen?"), true);
  assert.equal(synth.spoken.length, 2);
});

test("a voice that never starts is not heard: false after the start timeout, and it is cancelled", async () => {
  const synth = fakeSynth(() => "silent");
  const t0 = Date.now();
  assert.equal(await engine().speak("Where is the hen?"), false);
  assert.ok(Date.now() - t0 >= 50);
  assert.equal(synth.cancels, 1, "a late start must not talk over the fallback");
});

test("dropped twice is not heard", async () => {
  fakeSynth(() => "drop");
  assert.equal(await engine().speak("Where is the hen?"), false);
});

test("stopSpeaking makes a pending speak resolve false (no retry), and the next speak cancels the old one", async () => {
  const synth = fakeSynth();
  const a = engine();
  const first = a.speak("Where is the hen?");
  await new Promise((r) => setTimeout(r, 2));
  a.stopSpeaking();
  assert.equal(await first, false);
  assert.equal(synth.spoken.length, 1, "a deliberate stop is not retried");
  const second = a.speak("Can you find the hen?");
  await new Promise((r) => setTimeout(r, 2));
  const third = a.speak("Show me the hen!");
  assert.equal(await second, false);
  assert.equal(await third, true);
});

test("voices that load late (voiceschanged) are used", async () => {
  const synth = fakeSynth();
  const a = engine();
  await a.speak("hej", "sv");
  assert.equal(synth.spoken[0].voice, undefined, "no voices yet: the language tag alone");
  synth.voices = [{ lang: "en-US" }, { lang: "sv-SE", localService: true }];
  synth.dispatchEvent(new Event("voiceschanged"));
  await a.speak("hej", "sv");
  assert.equal(synth.spoken[1].voice.lang, "sv-SE");
});

test("primeSpeech speaks one silent utterance, once, and not when something already spoke", async () => {
  const synth = fakeSynth();
  const a = engine();
  a.primeSpeech();
  a.primeSpeech();
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].volume, 0);
  const b = engine();
  await b.speak("hi");
  b.primeSpeech();
  assert.equal(synth.spoken.length, 2);
});

test("no synthesiser: speak resolves false and the rest is a no-op", async () => {
  const a = engine();
  assert.equal(a.canSpeak, false);
  assert.equal(await a.speak("hi"), false);
  a.stopSpeaking();
  a.primeSpeech();
  fakeSynth();
  assert.equal(await a.speak(""), false);
});
