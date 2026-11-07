import { test } from "node:test";
import assert from "node:assert/strict";
import { spokenName, nameVoice, soundVoice, lineVoice, questionVoice } from "./voice.js";
import { planColorAsk, planAnimalAsk } from "./ask.js";
import { aSnapshot, aPlace, aThing, aClip } from "../../../tests/builders.js";

const farm = (...clips) => {
  const thing = aThing({ id: "cow", names: { en: "Cow", sv: "Ko" } });
  for (const c of clips) thing.withClip(aClip(c));
  return aSnapshot().withPlace(aPlace().withThing(thing)).build();
};

test("spokenName: the play language, its base language, any typed name, or nothing", () => {
  const t = { names: { en: "Cow", sv: "Ko" } };
  assert.deepEqual(spokenName(t, "sv"), { text: "Ko", lang: "sv" });
  assert.deepEqual(spokenName(t, "en-GB"), { text: "Cow", lang: "en" });
  assert.deepEqual(spokenName(t, "fi"), { text: "Cow", lang: "en" });
  assert.equal(spokenName({ names: { en: "" } }, "en"), null);
  assert.deepEqual(spokenName({ names: { en: "", sv: "Ko" } }, "fi"), { text: "Ko", lang: "sv" }, "an empty name is skipped");
  assert.equal(spokenName({}, "en"), null);
  assert.equal(spokenName(null, "en"), null);
});

test("nameVoice: your recording, another language's recording, the iPad voice, or nothing", () => {
  const none = farm();
  const t = none.things[0];
  assert.deepEqual(nameVoice(none, t, "sv"), { source: "voice", text: "Ko", lang: "sv" });
  assert.deepEqual(nameVoice(none, t, "sv", false), { source: "none" });
  assert.deepEqual(nameVoice(none, { ...t, names: {} }, "sv"), { source: "none" });
  const en = farm({ id: "n-en", language: "en", kind: "name" });
  assert.equal(nameVoice(en, t, "en").source, "recording");
  assert.deepEqual(nameVoice(en, t, "sv"), { source: "other-language", clip: en.clips[0] });
});

test("soundVoice: the one sound, or none", () => {
  assert.deepEqual(soundVoice(farm(), "cow"), { source: "none" });
  const s = farm({ id: "s", language: "sv", kind: "sound" });
  assert.equal(soundVoice(s, "cow").clip.id, "s");
});

test("lineVoice: recorded, skipped while others are recorded, else the iPad voice", () => {
  assert.equal(lineVoice([1, 3], 1), "recording");
  assert.equal(lineVoice([1, 3], 2), "skipped");
  assert.equal(lineVoice([], 2), "voice");
  assert.equal(lineVoice([], 2, false), "none");
});

test("questionVoice: a recorded question plays only with the colour's word, so it says for how many colours", () => {
  const colors = (words) => ({ needed: ["yellow", "pink"], words });
  assert.deepEqual(questionVoice([1], 1, colors(["yellow", "pink"])), { source: "recording", recorded: 2, total: 2, missing: [] });
  assert.deepEqual(questionVoice([1], 1, colors(["yellow"])), { source: "partial", recorded: 1, total: 2, missing: ["pink"] });
  assert.equal(questionVoice([1], 1, colors([])).source, "voice");
  assert.equal(questionVoice([1], 1, colors([]), false).source, "none");
  assert.equal(questionVoice([1], 2, colors(["yellow"])).source, "skipped");
  assert.equal(questionVoice([], 1, colors(["yellow"])).source, "voice");
  assert.equal(questionVoice([1], 1, { needed: [], words: [] }).source, "recording", "no colours in the scene yet");
});

test("questionVoice agrees with planColorAsk for every colour of the scene", () => {
  const q = [{ id: "q", language: "en", kind: "color-question", take: 1 }];
  const words = [{ id: "w", language: "en", kind: "color-word", color: "yellow" }];
  const v = questionVoice([1], 1, { needed: ["yellow", "pink"], words: ["yellow"] });
  for (const color of ["yellow", "pink"]) {
    const plan = planColorAsk({ questions: q, words: words.filter((w) => w.color === color), lang: "en", line: { text: "Tap", lang: "en" }, canSpeak: true, rng: () => 0 });
    assert.equal(plan.recorded, !v.missing.includes(color), color);
  }
});

test("questionVoice agrees with planAnimalAsk for every animal of the scene", () => {
  const q = [{ id: "q", language: "en", kind: "find-question", take: 1 }];
  const names = { hen: [{ id: "n", language: "en", kind: "name" }], pig: [{ id: "p", language: "sv", kind: "name" }] };
  const v = questionVoice([1], 1, { needed: ["hen", "pig"], words: ["hen"] });
  assert.deepEqual(v, { source: "partial", recorded: 1, total: 2, missing: ["pig"] });
  for (const id of ["hen", "pig"]) {
    const plan = planAnimalAsk({ questions: q, names: names[id], lang: "en", lines: ["Where?"], linesLang: "en", sound: null, canSpeak: true, rng: () => 0 });
    assert.equal(plan.recorded, !v.missing.includes(id), id);
  }
});
