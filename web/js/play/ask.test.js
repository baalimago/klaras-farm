import { test } from "node:test";
import assert from "node:assert/strict";
import { planAnimalAsk, planColorAsk, colorAskLanguage, recordedColorLangs } from "./ask.js";

const clip = (id, language = "en", kind = "prompt") => ({ id, language, kind });
const kinds = (plan) => plan.ask.map((s) => s.kind);
const base = { prompts: [], lang: "en", lines: ["Where is the hen?", "Can you find the hen?"], linesLang: "en", name: null, sound: null, canSpeak: true, rng: () => 0 };

test("animal: the recorded question first, then the device voice, the name, a chime; the sound is the clue", () => {
  const sound = clip("s", "en", "sound");
  const name = clip("n", "en", "name");
  const plan = planAnimalAsk({ ...base, prompts: [clip("p1"), clip("p2")], name, sound });
  assert.deepEqual(kinds(plan), ["clip", "speak", "clip", "chime"]);
  assert.equal(plan.ask[0].clip.id, "p1");
  assert.equal(plan.ask[1].text, "Where is the hen?");
  assert.equal(plan.ask[2].clip, name);
  assert.deepEqual(plan.clue, { kind: "clip", clip: sound });
});

test("animal: a random take among the recorded ones, never the same one twice in a row", () => {
  const prompts = [clip("p1"), clip("p2"), clip("p3")];
  assert.equal(planAnimalAsk({ ...base, prompts, rng: () => 0.99 }).ask[0].clip.id, "p3");
  assert.equal(planAnimalAsk({ ...base, prompts, rng: () => 0, lastId: "p1" }).ask[0].clip.id, "p2");
  assert.equal(planAnimalAsk({ ...base, prompts: [clip("p1")], lastId: "p1" }).ask[0].clip.id, "p1", "one take repeats");
});

test("animal: prompts in the play language win; else the device voice, then another language's prompts", () => {
  const prompts = [clip("en1"), clip("sv1", "sv")];
  assert.equal(planAnimalAsk({ ...base, prompts, lang: "sv" }).ask[0].clip.id, "sv1");
  const de = planAnimalAsk({ ...base, prompts: [clip("sv1", "sv")], lang: "de" });
  assert.deepEqual(kinds(de), ["speak", "clip", "chime"], "QA round 3: the card says the iPad voice reads it");
  assert.equal(de.ask[1].clip.id, "sv1", "a recording still asks when the voice is not heard");
  assert.equal(planAnimalAsk({ ...base, prompts: [clip("sv1", "sv")], lang: "de", canSpeak: false }).ask[0].clip.id, "sv1");
});

test("animal: no recording and no voice still asks something; no sound means no clue", () => {
  const plan = planAnimalAsk({ ...base, canSpeak: false });
  assert.deepEqual(kinds(plan), ["chime"]);
  assert.equal(plan.clue, null);
  assert.deepEqual(kinds(planAnimalAsk({ ...base, lines: [] })), ["chime"]);
  assert.equal(planAnimalAsk({ ...base, rng: () => 0.9 }).ask[0].text, "Can you find the hen?", "a random line");
});

test("colour: recorded question + word in the same language play as one sequence", () => {
  const questions = [clip("q-en", "en", "color-question"), clip("q-sv", "sv", "color-question")];
  const words = [clip("w-sv", "sv", "color-word"), clip("w-en", "en", "color-word")];
  const line = { text: "Tap on an animal that is yellow!", lang: "en" };
  const plan = planColorAsk({ questions, words, lang: "en", line, canSpeak: true, rng: () => 0 });
  assert.deepEqual(kinds(plan), ["clips", "speak", "clip", "chime"]);
  assert.deepEqual(plan.ask[0].clips.map((c) => c.id), ["q-en", "w-en"], "question first, then the colour");
  assert.equal(plan.clue, null);
});

test("colour: a missing word or question falls back to the device voice, then any recorded word, then a chime", () => {
  const line = { text: "Tap on an animal that is yellow!", lang: "en" };
  const onlyQuestion = planColorAsk({ questions: [clip("q", "en", "color-question")], words: [], lang: "en", line, canSpeak: true, rng: () => 0 });
  assert.deepEqual(kinds(onlyQuestion), ["speak", "chime"]);
  const svWord = planColorAsk({ questions: [], words: [clip("w-sv", "sv", "color-word")], lang: "en", line, canSpeak: false, rng: () => 0 });
  assert.deepEqual(kinds(svWord), ["clip", "chime"]);
  assert.deepEqual(kinds(planColorAsk({ questions: [], words: [], lang: "en", line: null, canSpeak: true, rng: () => 0 })), ["chime"]);
});

test("colour language: fixed, or mixed among the fully recorded languages", () => {
  assert.equal(colorAskLanguage({ playLanguage: "sv", languages: ["en", "sv"] }, ["en"], () => 0), "sv");
  assert.equal(colorAskLanguage({ playLanguage: "alternate", languages: ["en", "sv"] }, ["sv"], () => 0), "sv");
  assert.equal(colorAskLanguage({ playLanguage: "alternate", languages: ["en", "sv"] }, [], () => 0.9), "sv");
  const q = [clip("q", "en", "color-question"), clip("q2", "de", "color-question")];
  assert.deepEqual(recordedColorLangs(q, [clip("w", "en", "color-word"), clip("w2", "sv", "color-word")]), ["en"]);
});

test("the device voice reads a line in the language of its script, not the play language", () => {
  // Swedish without a script: the English example lines are read by an English voice.
  const animal = planAnimalAsk({ ...base, lang: "sv", linesLang: "en" });
  assert.deepEqual(animal.ask.find((s) => s.kind === "speak"), { kind: "speak", text: "Where is the hen?", lang: "en" });
  const color = planColorAsk({ questions: [], words: [], lang: "sv", line: { text: "Tap on an animal that is yellow!", lang: "en" }, canSpeak: true, rng: () => 0 });
  assert.equal(color.ask.find((s) => s.kind === "speak").lang, "en");
});

test("recorded tells whether the parent's own question plays (the find buttons' recording tip)", () => {
  assert.equal(planAnimalAsk({ ...base, prompts: [clip("p1")] }).recorded, true);
  assert.equal(planAnimalAsk({ ...base, prompts: [clip("sv1", "sv")], lang: "en" }).recorded, false, "the iPad voice asks in English: tip");
  assert.equal(planAnimalAsk({ ...base, prompts: [clip("sv1", "sv")], lang: "en", canSpeak: false }).recorded, true, "no voice: another language's recording asks");
  assert.equal(planAnimalAsk({ ...base, name: clip("n", "en", "name") }).recorded, false, "a recorded name is not a question");
  assert.equal(planAnimalAsk({ ...base, canSpeak: false }).recorded, false);
  assert.equal(planAnimalAsk({ ...base, lines: [], prompts: [clip("sv1", "sv")], lang: "en" }).recorded, true, "a voice with no lines to read: the other language's recording asks");
  const line = { text: "Tap on an animal that is yellow!", lang: "en" };
  const q = [clip("q", "en", "color-question")];
  const w = [clip("w", "en", "color-word")];
  assert.equal(planColorAsk({ questions: q, words: w, lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, true);
  assert.equal(planColorAsk({ questions: q, words: [], lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, false, "no word for this colour");
  assert.equal(planColorAsk({ questions: [], words: w, lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, false, "no question");
  assert.equal(planColorAsk({ questions: q, words: [clip("w-sv", "sv", "color-word")], lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, false);
});
