// Find games and the built-in voice, through the real PlayEngine with a FarmStore and a fake audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlayEngine } from "../../web/js/play-engine.js";
import { FarmStore } from "../../web/js/farm-store.js";
import { MemoryRepo } from "../../web/js/io/memory-repo.js";
import { FIND } from "../../web/js/play/find.js";
import { COLOR_GROUPS } from "../../web/js/play/colors.js";
import { SIMPLE_COLORS } from "../../web/js/farm/palette.js";
import { colorLine } from "../../web/js/farm/scripts.js";
import { fixedEnv, square, aSnapshot, aPlace, aThing, aClip } from "../builders.js";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const presets = { walk: json("../../web/data/motions/walk.json"), float: json("../../web/data/motions/float.json") };
const LANGS = json("../../web/data/scripts/index.json");
const scripts = Object.fromEntries(LANGS.map((l) => [l, json(`../../web/data/scripts/${l}.json`)]));

class FakeAudio {
  canSpeak = true;
  calls = [];
  pending = [];
  _later(entry) { this.calls.push(entry); return new Promise((r) => this.pending.push(r)); }
  playThing(clips) { return this._later(["playThing", clips.map((c) => `${c.language}:${c.kind}`).join(",")]); }
  playSequence(clips) { return this._later(["playSequence", clips.map((c) => `${c.language}:${c.kind}${c.color ? `:${c.color}` : ""}`).join(",")]); }
  /** Resolves the latest pending call with `value` (true: heard; false: not heard). */
  async finishNext(value = true) { this.pending.pop()?.(value); await flush(); }
  playClip(clip) { return this._later(["playClip", `${clip.language}:${clip.kind}:${clip.take}`]); }
  speak(text, lang) { return this._later(["speak", `${lang}:${text}`]); }
  chime(kind) { this.calls.push(["chime", kind]); }
  stop() { this.calls.push(["stop"]); }
  finishAll() { for (const r of this.pending.splice(0)) r(true); }
  last(kind) { return this.calls.filter((c) => c[0] === kind).at(-1)?.[1]; }
  since(n) { return this.calls.slice(n); }
}

const seeded = (s = 3) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

/** Pig: recorded question, name and sound, pink. Cow: typed name only, white. Hen: typed name, pink too. */
async function setup({ findIt, lang = "en", withHen = false } = {}) {
  const place = aPlace({ id: "farm", ...(findIt === undefined ? {} : { findIt }) })
    .withThing(
      aThing({ id: "pig", color: "pink", names: { en: "pig", sv: "grisen" }, outline: square(0.3, 0.7, 0.08) })
        .withClip(aClip({ language: "en", kind: "prompt", take: 1 }))
        .withClip(aClip({ language: "en", kind: "name" }))
        .withClip(aClip({ language: "en", kind: "sound" })),
    )
    .withThing(aThing({ id: "cow", color: "white", names: { en: "cow" }, outline: square(0.7, 0.7, 0.08) }));
  if (withHen) place.withThing(aThing({ id: "hen", color: "pink", names: { en: "hen" }, outline: square(0.5, 0.3, 0.06) }));
  const snap = aSnapshot().withPlace(place).build();
  snap.settings.languages = [lang];
  snap.settings.playLanguage = lang;
  const store = new FarmStore(new MemoryRepo(), fixedEnv());
  await store.hydrate();
  await store.replaceAll(snap, []);
  const audio = new FakeAudio();
  const clock = { t: 0 };
  const engine = new PlayEngine({ store, audio, presets, scripts, rng: seeded(), now: () => clock.t });
  const events = [];
  for (const k of ["ask", "answer", "reaction", "find"]) engine.addEventListener(k, (e) => events.push([k, e.detail]));
  const advance = (s) => { for (let i = 0; i < Math.round(s * 30); i++) { clock.t += 1000 / 30; engine.step(1 / 30); } };
  const tapThing = (id) => { const a = engine.actorFor(id); return engine.tap(a.x, a.y); };
  const asks = () => events.filter(([k]) => k === "ask").map(([, d]) => d);
  /** Starts an animal round on a given target (re-presses until the rng lands on it). */
  const roundOn = async (target) => {
    for (let i = 0; i < 20; i++) {
      engine.startFind("animal");
      if (engine.asking === target) return;
      engine.stopFind();
    }
    throw new Error(`never asked for ${target}`);
  };
  return { store, audio, engine, events, advance, tapThing, asks, roundOn };
}

test("a thing without a recording chimes, then the device says its name in the play language", async () => {
  const { audio, tapThing } = await setup();
  tapThing("cow");
  assert.deepEqual(audio.calls.slice(0, 2), [["chime", "tap"], ["speak", "en:cow"]]);
});

test("the built-in voice falls back to another typed name when the play language has none", async () => {
  const { audio, tapThing } = await setup({ lang: "sv" });
  tapThing("cow");
  assert.equal(audio.last("speak"), "en:cow");
});

test("find never starts by itself: a long calm stretch asks nothing", async () => {
  const { engine, asks, advance } = await setup();
  advance(120);
  assert.equal(asks().length, 0);
  assert.equal(engine.findRound, null);
  assert.equal(engine.nextWakeMs() > 0, true);
});

test("the find games show by default (findIt absent), hide when the place switches them off, and outside play", async () => {
  const on = await setup();
  assert.equal(on.engine.findAvailable, true);
  on.engine.setMode("edit");
  assert.equal(on.engine.findAvailable, false);
  assert.equal(on.engine.startFind("animal"), false);
  const off = await setup({ findIt: false });
  assert.equal(off.engine.findAvailable, false);
  assert.equal(off.engine.startFind("animal"), false);
  assert.equal(off.asks().length, 0);
});

test("animal round: the recorded question, then the thing's own sound as a clue; things freeze meanwhile", async () => {
  const { engine, audio, asks, roundOn } = await setup();
  await roundOn("pig");
  assert.deepEqual(engine.findRound, { kind: "animal", thingId: "pig", color: null });
  assert.equal(asks().at(-1).kind, "animal");
  assert.equal(asks().at(-1).recorded, true, "the parent's own question: no recording tip");
  assert.equal(audio.last("playClip"), "en:prompt:1");
  assert.equal(engine._input.fingerDown || engine._prompting, true);
  const n = audio.calls.length;
  audio.finishAll();
  await flush();
  assert.deepEqual(audio.since(n), [["playClip", "en:sound:1"]], "the sound follows the question");
});

test("animal round without recordings: the scripted cue in the device's voice", async () => {
  const { audio, roundOn, asks } = await setup();
  await roundOn("cow");
  assert.match(audio.last("speak"), /^en:(Where is|Can you find|Show me) the cow[?!]$/);
  assert.equal(asks().at(-1).recorded, false, "the ask event says nothing is recorded (the recording tip shows)");
});

test("right tap: yay chime and confetti, then the name and the sound; the round ends", async () => {
  const { engine, audio, events, tapThing, roundOn } = await setup();
  await roundOn("pig");
  audio.finishAll();
  await flush();
  const n = audio.calls.length;
  tapThing("pig");
  assert.deepEqual(events.filter(([k]) => k === "answer").at(-1)[1], { thingId: "pig", outcome: "correct" });
  assert.equal(events.filter(([k]) => k === "reaction").at(-1)[1].celebrate, true);
  assert.deepEqual(audio.since(n), [["stop"], ["chime", "yay"], ["playThing", "en:name,en:sound"]]);
  assert.equal(engine.findRound, null);
  assert.equal(events.filter(([k]) => k === "find").at(-1)[1].round, null);
});

test("right tap on a thing with a typed name only: the device says the name", async () => {
  const { audio, tapThing, roundOn } = await setup();
  await roundOn("cow");
  audio.finishAll();
  await flush();
  tapThing("cow");
  assert.equal(audio.last("speak"), "en:cow");
});

test("wrong taps: the tapped thing says its own name, the question repeats; after 2 misses the right one glows and hops", async () => {
  const { engine, audio, events, advance, tapThing, asks, roundOn } = await setup();
  await roundOn("cow");
  audio.finishAll();
  await flush();
  for (let miss = 1; miss <= 2; miss++) {
    advance(0.5); // past the mash window
    tapThing("pig");
    assert.equal(events.filter(([k]) => k === "answer").at(-1)[1].outcome, "wrong");
    assert.equal(audio.last("playThing"), "en:name,en:sound", "the pig says its name");
    const before = asks().length;
    audio.finishAll();
    await flush();
    assert.equal(asks().length, before + 1, "then the question comes again");
    assert.equal(asks().at(-1).repeat, true);
    audio.finishAll();
    await flush();
  }
  advance(0.05);
  assert.equal(engine.actorFor("cow").glow, 1);
  assert.equal(engine.actorFor("pig").glow, 0);
  assert.equal(engine.actorFor("cow").state, "react", "the right one hops");
  assert.equal(engine.isIdle(), false, "the glow keeps the renderer running");
  tapThing("cow");
  advance(0.05);
  assert.equal(engine.actorFor("cow").glow, 0);
});

test("no answer: after ~6 quiet seconds the target hops and the question repeats once; after ~30 s the round ends quietly", async () => {
  const { engine, audio, asks, advance, roundOn } = await setup();
  await roundOn("cow");
  audio.finishAll();
  await flush();
  const asked = asks().length;
  assert.ok(engine.nextWakeMs() <= FIND.nudgeAfterS * 1000 + 50, "the renderer is woken for the nudge");
  advance(FIND.nudgeAfterS + 0.2);
  assert.equal(asks().length, asked + 1);
  assert.equal(asks().at(-1).repeat, true);
  assert.equal(engine.actorFor("cow").state, "react");
  audio.finishAll();
  await flush();
  const n = audio.calls.length;
  advance(FIND.timeoutS);
  assert.equal(engine.findRound, null);
  assert.equal(asks().length, asked + 1, "only one repeat");
  assert.ok(!audio.since(n).some(([k]) => k === "chime" || k === "speak" || k === "playClip"), "no failure sound");
});

test("a find timer that runs while the board is idle still fires (nextWakeMs covers it)", async () => {
  const { engine, audio, roundOn } = await setup();
  await roundOn("cow");
  audio.finishAll();
  await flush();
  const wake = engine.nextWakeMs();
  assert.ok(wake < Infinity && wake <= FIND.nudgeAfterS * 1000 + 50);
});

test("pressing the button again during its round repeats the question; the other button switches game", async () => {
  const { engine, asks, roundOn } = await setup();
  await roundOn("cow");
  const n = asks().length;
  engine.startFind("animal");
  assert.equal(asks().length, n + 1);
  assert.equal(asks().at(-1).repeat, true);
  assert.equal(engine.asking, "cow");
  engine.startFind("color");
  assert.equal(engine.findRound.kind, "color");
  assert.equal(engine.asking, null);
});

test("colour round: asks for a colour in the scene; any thing of that colour is right", async () => {
  const { engine, audio, events, advance, tapThing } = await setup({ withHen: true });
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) { engine.stopFind(); engine.startFind("color"); ok = engine.findRound.color === "pink"; }
  assert.ok(ok);
  assert.equal(audio.last("speak").startsWith("en:"), true);
  assert.match(audio.last("speak"), /pink/);
  audio.finishAll();
  await flush();
  advance(0.5);
  tapThing("cow");
  assert.equal(events.filter(([k]) => k === "answer").at(-1)[1].outcome, "wrong");
  audio.finishAll();
  await flush();
  assert.match(audio.last("speak"), /pink/, "the colour question repeats after the cow's name");
  audio.finishAll();
  await flush();
  advance(0.5);
  tapThing("cow");
  audio.finishAll();
  await flush();
  advance(0.05);
  assert.equal(engine.actorFor("pig").glow, 1, "after 2 misses every pink thing glows");
  assert.equal(engine.actorFor("hen").glow, 1);
  assert.equal(engine.actorFor("cow").glow, 0);
  tapThing("hen");
  assert.equal(events.filter(([k]) => k === "answer").at(-1)[1].outcome, "correct");
  assert.equal(audio.last("speak"), "en:hen");
});

test("the colour question is in the play language", async () => {
  const { engine, audio } = await setup({ lang: "sv" });
  engine.startFind("color");
  assert.match(audio.last("speak"), /^sv:(Tryck|Vilket|Kan)/);
});

// ---------- playtest round 3: the question is always heard, and before the sound ----------

test("animal round without a recorded question: the device voice asks, and only then the sound plays", async () => {
  const { audio, store, roundOn } = await setup();
  const cowSound = aClip({ language: "en", kind: "sound" }).build();
  await store.saveClip({ clip: { ...cowSound, thingId: "cow" } });
  await roundOn("cow");
  const n = audio.calls.findLastIndex((c) => c[0] === "speak");
  assert.match(audio.calls[n][1], /cow/);
  assert.ok(!audio.since(n).some((c) => c[0] === "playClip"), "no sound while the question is being asked");
  await audio.finishNext(true);
  assert.deepEqual(audio.since(n + 1), [["playClip", "en:sound:1"]], "the sound follows the question");
});

test("a device voice that never starts falls back to the recorded name; the sound still waits for it", async () => {
  const { audio, store, roundOn } = await setup();
  await store.saveClip({ clip: { ...aClip({ language: "en", kind: "name" }).build(), thingId: "cow" } });
  await store.saveClip({ clip: { ...aClip({ language: "en", kind: "sound" }).build(), thingId: "cow" } });
  await roundOn("cow");
  const n = audio.calls.findLastIndex((c) => c[0] === "speak");
  await audio.finishNext(false); // iPad: the utterance was dropped (never started)
  assert.deepEqual(audio.since(n + 1), [["playClip", "en:name:1"]], "the name asks instead, not the sound");
  await audio.finishNext(true);
  assert.deepEqual(audio.since(n + 2), [["playClip", "en:sound:1"]]);
});

test("a question cut short by a tap never plays the sound afterwards", async () => {
  const { audio, engine, store, advance, tapThing, roundOn } = await setup();
  await store.saveClip({ clip: { ...aClip({ language: "en", kind: "sound" }).build(), thingId: "cow" } });
  await roundOn("cow");
  advance(0.5);
  const question = audio.pending.at(-1);
  tapThing("pig");
  const n = audio.calls.length;
  question(true); // the cut-off question settles after the tap
  await flush();
  assert.ok(!audio.since(n).some((c) => c[1] === "en:sound:1"), "the cow's sound is not played over the pig");
  assert.equal(engine.asking, "cow");
});

test("recorded questions: a random take each time, never the same take twice in a row", async () => {
  const { audio, store, engine, roundOn } = await setup();
  for (const take of [2, 3]) await store.saveClip({ clip: { ...aClip({ language: "en", kind: "prompt", take }).build(), thingId: "pig" } });
  await roundOn("pig");
  const takes = [audio.last("playClip")];
  for (let i = 0; i < 6; i++) { engine.startFind("animal"); takes.push(audio.last("playClip")); }
  for (let i = 1; i < takes.length; i++) assert.notEqual(takes[i], takes[i - 1]);
  assert.ok(new Set(takes).size >= 2);
});

async function withColorClips(setupOpts, clips) {
  const t = await setup({ withHen: true, ...setupOpts });
  for (const c of clips) await t.store.saveClip({ clip: aClip({ thingId: null, ...c }).build() });
  return t;
}

const pinkRound = (engine) => {
  for (let i = 0; i < 20; i++) { engine.stopFind(); engine.startFind("color"); if (engine.findRound.color === "pink") return; }
  throw new Error("never asked for pink");
};

test("colour round: the recorded colour question and colour word play as one sequence; any pink thing is right", async () => {
  const { engine, audio, events, tapThing } = await withColorClips({}, [
    { kind: "color-question", language: "en" },
    { kind: "color-word", color: "pink", language: "en" },
    { kind: "color-word", color: "white", language: "en" },
  ]);
  pinkRound(engine);
  assert.equal(audio.last("playSequence"), "en:color-question,en:color-word:pink", "question first, then the colour word");
  audio.finishAll();
  await flush();
  tapThing("hen");
  assert.equal(events.filter(([k]) => k === "answer").at(-1)[1].outcome, "correct", "any thing of that colour, not one specific");
});

test("colour round: with the word missing the device voice says the whole line", async () => {
  const { engine, audio } = await withColorClips({}, [{ kind: "color-question", language: "en" }]);
  pinkRound(engine);
  assert.match(audio.last("speak"), /^en:.*pink/);
  assert.equal(audio.last("playSequence"), undefined);
});

test("edit mode and deleting the target end a round", async () => {
  const { engine, store, roundOn } = await setup();
  await roundOn("cow");
  engine.setMode("edit");
  assert.equal(engine.findRound, null);
  engine.setMode("play");
  await roundOn("cow");
  await store.deleteThing({ thingId: "cow" });
  assert.equal(engine.findRound, null);
});

test("the find buttons hide while the things sleep", async () => {
  const { engine, store, advance, events } = await setup();
  await store.updateSettings({ patch: { sleepMinutes: 5 } });
  assert.equal(engine.findAvailable, true);
  advance(5 * 60 + 1);
  assert.equal(engine.world.asleep, true);
  assert.equal(engine.findAvailable, false);
  assert.equal(events.filter(([k]) => k === "find").at(-1)[1].available, false);
  assert.equal(engine.startFind("animal"), false);
});

test("every script language has a word for every simple colour and colour questions", () => {
  for (const lang of LANGS) {
    for (const group of Object.keys(COLOR_GROUPS)) {
      const line = colorLine(scripts, group, lang);
      assert.equal(line.lang, lang, `${lang} has ${group}`);
      assert.ok(!line.text.includes("{"), line.text);
    }
    assert.equal(scripts[lang].colorTemplates.length, 3);
    assert.ok(scripts[lang].colorQuestion.endsWith("…"), `${lang} has a colour question to record`);
  }
  assert.deepEqual(colorLine(scripts, "blue", "nl"), { text: "Tap on an animal that is blue!", lang: "en" });
  assert.deepEqual(Object.keys(COLOR_GROUPS), [...SIMPLE_COLORS], "the colour game's colours are the palette's simple colours");
});
