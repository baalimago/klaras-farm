// Find it and the built-in voice, through the real PlayEngine with a FarmStore and a fake audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlayEngine } from "../../web/js/play-engine.js";
import { FarmStore } from "../../web/js/farm-store.js";
import { MemoryRepo } from "../../web/js/io/memory-repo.js";
import { FIND } from "../../web/js/play/find.js";
import { fixedEnv, square, aSnapshot, aPlace, aThing, aClip } from "../builders.js";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const presets = { walk: json("../../web/data/motions/walk.json"), float: json("../../web/data/motions/float.json") };
const scripts = { en: json("../../web/data/scripts/en.json"), sv: json("../../web/data/scripts/sv.json") };

class FakeAudio {
  canSpeak = true;
  calls = [];
  pending = [];
  _later(entry) { this.calls.push(entry); return new Promise((r) => this.pending.push(r)); }
  playThing(clips) { return this._later(["playThing", clips.map((c) => `${c.language}:${c.kind}`).join(",")]); }
  playClip(clip) { return this._later(["playClip", `${clip.language}:${clip.kind}:${clip.take}`]); }
  speak(text, lang) { return this._later(["speak", `${lang}:${text}`]); }
  chime(kind) { this.calls.push(["chime", kind]); }
  stop() { this.calls.push(["stop"]); }
  finishAll() { for (const r of this.pending.splice(0)) r(); }
  last(kind) { return this.calls.filter((c) => c[0] === kind).at(-1)?.[1]; }
}

const seeded = (s = 3) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const flush = () => new Promise((r) => setImmediate(r));

async function setup({ findIt = true, lang = "en" } = {}) {
  const snap = aSnapshot()
    .withPlace(
      aPlace({ id: "farm", findIt })
        .withThing(aThing({ id: "pig", names: { en: "pig", sv: "grisen" }, outline: square(0.3, 0.7, 0.08) }).withClip(aClip({ language: "en", kind: "prompt", take: 1 })).withClip(aClip({ language: "en", kind: "name" })))
        .withThing(aThing({ id: "cow", names: { en: "cow" }, outline: square(0.7, 0.7, 0.08) })),
    )
    .build();
  snap.settings.languages = [lang];
  snap.settings.playLanguage = lang;
  const store = new FarmStore(new MemoryRepo(), fixedEnv());
  await store.hydrate();
  await store.replaceAll(snap, []);
  const audio = new FakeAudio();
  const clock = { t: 0 };
  const engine = new PlayEngine({ store, audio, presets, scripts, rng: seeded(), now: () => clock.t });
  const events = [];
  for (const k of ["ask", "answer", "reaction"]) engine.addEventListener(k, (e) => events.push([k, e.detail]));
  const advance = (s) => { for (let i = 0; i < Math.round(s * 30); i++) { clock.t += 1000 / 30; engine.step(1 / 30); } };
  const tapThing = (id) => { const a = engine.actorFor(id); return engine.tap(a.x, a.y); };
  return { store, audio, engine, events, advance, tapThing };
}

test("a thing without a recording chimes, then the device says its name in the play language", async () => {
  const { audio, tapThing } = await setup({ findIt: false });
  tapThing("cow");
  assert.deepEqual(audio.calls.slice(0, 2), [["chime", "tap"], ["speak", "en:cow"]]);
});

test("the built-in voice falls back to another typed name when the play language has none", async () => {
  const { audio, tapThing } = await setup({ findIt: false, lang: "sv" });
  tapThing("cow");
  assert.equal(audio.last("speak"), "en:cow");
});

test("Find it is off unless the place turns it on", async () => {
  const { engine, events, advance } = await setup({ findIt: false });
  advance(FIND.firstAskS + FIND.gapMaxS);
  assert.equal(events.filter(([k]) => k === "ask").length, 0);
  assert.equal(engine.nextWakeMs() > FIND.gapMaxS * 1000 || engine.nextWakeMs() < Infinity, true);
});

test("asks with a recorded question, or the scripted cue in the device's voice, and freezes things meanwhile", async () => {
  const { engine, audio, events, advance } = await setup();
  assert.ok(engine.nextWakeMs() <= FIND.firstAskS * 1000, "the renderer is woken for the question");
  advance(FIND.firstAskS + 0.2);
  const ask = events.find(([k]) => k === "ask")[1];
  const asked = ask.thingId === "pig" ? audio.last("playClip") : audio.last("speak");
  assert.equal(asked, ask.thingId === "pig" ? "en:prompt:1" : "en:Where is the cow?");
  assert.equal(engine.asking, ask.thingId);
  audio.finishAll();
  await flush();
});

test("right tap: celebration chime, confetti, then the name; a new question comes later", async () => {
  const { engine, audio, events, advance, tapThing } = await setup();
  advance(FIND.firstAskS + 0.2);
  audio.finishAll();
  await flush();
  const target = engine.asking;
  tapThing(target);
  assert.deepEqual(events.filter(([k]) => k === "answer").at(-1)[1], { thingId: target, outcome: "correct" });
  assert.equal(events.filter(([k]) => k === "reaction").at(-1)[1].celebrate, true);
  assert.ok(audio.calls.some(([k, v]) => k === "chime" && v === "yay"));
  assert.equal(engine.asking, null);
  audio.finishAll();
  await flush();
  advance(FIND.celebrateS + FIND.gapMaxS + 0.5);
  assert.equal(events.filter(([k]) => k === "ask").length, 2);
});

test("wrong taps: the tapped thing says its own name, the question repeats, and after 2 misses the right one glows", async () => {
  const { engine, audio, events, advance, tapThing } = await setup();
  advance(FIND.firstAskS + 0.2);
  audio.finishAll();
  await flush();
  const target = engine.asking;
  const other = target === "pig" ? "cow" : "pig";
  for (let miss = 1; miss <= 2; miss++) {
    advance(0.5); // past the mash window
    tapThing(other);
    assert.equal(events.filter(([k]) => k === "answer").at(-1)[1].outcome, "wrong");
    audio.finishAll(); // its name ends…
    await flush();
    assert.equal(events.filter(([k]) => k === "ask").at(-1)[1].repeat, true, "…then the question comes again");
    audio.finishAll();
    await flush();
  }
  advance(0.05);
  assert.equal(engine.actorFor(target).glow, 1);
  assert.equal(engine.actorFor(other).glow, 0);
  assert.equal(engine.isIdle(), false, "the glow keeps the renderer running");
  tapThing(target);
  advance(0.05);
  assert.equal(engine.actorFor(target).glow, 0);
});

test("edit mode cancels a question", async () => {
  const { engine, advance, audio } = await setup();
  advance(FIND.firstAskS + 0.2);
  audio.finishAll();
  await flush();
  assert.ok(engine.asking);
  engine.setMode("edit");
  assert.equal(engine.asking, null);
});
