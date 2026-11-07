import { test } from "node:test";
import assert from "node:assert/strict";
import { planAnimalAsk, planColorAsk, askLanguage, recordedLangs } from "./ask.js";

const clip = (id, language = "en", kind = "find-question") => ({ id, language, kind });
const kinds = (plan) => plan.ask.map((s) => s.kind);
const base = { questions: [], names: [], lang: "en", lines: ["Where is the hen?", "Can you find the hen?"], linesLang: "en", sound: null, canSpeak: true, rng: () => 0 };
const henEn = clip("n-en", "en", "name");

test("animal: the recorded question and name as one sequence, then the device voice, the name, a chime; the sound is the clue", () => {
  const sound = clip("s", "en", "sound");
  const plan = planAnimalAsk({ ...base, questions: [clip("q1"), clip("q2")], names: [henEn], sound });
  assert.deepEqual(kinds(plan), ["clips", "speak", "clip", "chime"]);
  assert.deepEqual(plan.ask[0].clips.map((c) => c.id), ["q1", "n-en"], "the question first, then the name");
  assert.equal(plan.ask[1].text, "Where is the hen?");
  assert.equal(plan.ask[2].clip, henEn);
  assert.deepEqual(plan.clue, { kind: "clip", clip: sound });
  assert.equal(plan.recorded, true);
});

test("animal: a random question take, never the same one twice in a row", () => {
  const questions = [clip("q1"), clip("q2"), clip("q3")];
  const first = (o) => planAnimalAsk({ ...base, names: [henEn], ...o }).ask[0].clips[0].id;
  assert.equal(first({ questions, rng: () => 0.99 }), "q3");
  assert.equal(first({ questions, rng: () => 0, lastId: "q1" }), "q2");
  assert.equal(first({ questions: [clip("q1")], lastId: "q1" }), "q1", "one take repeats");
});

test("animal: question and name must be in the same language, else the device voice says the whole line", () => {
  const sv = planAnimalAsk({ ...base, questions: [clip("q-en"), clip("q-sv", "sv")], names: [henEn, clip("n-sv", "sv", "name")], lang: "sv" });
  assert.deepEqual(sv.ask[0].clips.map((c) => c.id), ["q-sv", "n-sv"]);
  const noName = planAnimalAsk({ ...base, questions: [clip("q-sv", "sv")], names: [henEn], lang: "sv" });
  assert.deepEqual(kinds(noName), ["speak", "clip", "chime"], "no Swedish name: the iPad voice asks");
  assert.equal(noName.ask[1].clip, henEn, "the other language's name still plays when the voice is not heard");
  assert.equal(noName.recorded, false);
  const noQuestion = planAnimalAsk({ ...base, names: [henEn] });
  assert.deepEqual(kinds(noQuestion), ["speak", "clip", "chime"]);
  assert.equal(noQuestion.recorded, false, "a recorded name alone is not a recorded question");
});

test("animal: no recording and no voice still asks something; no sound means no clue", () => {
  const plan = planAnimalAsk({ ...base, canSpeak: false });
  assert.deepEqual(kinds(plan), ["chime"]);
  assert.equal(plan.clue, null);
  assert.deepEqual(kinds(planAnimalAsk({ ...base, lines: [] })), ["chime"]);
  assert.equal(planAnimalAsk({ ...base, rng: () => 0.9 }).ask[0].text, "Can you find the hen?", "a random line");
  assert.deepEqual(kinds(planAnimalAsk({ ...base, canSpeak: false, questions: [clip("q")], names: [clip("n-sv", "sv", "name")] })), ["clip", "chime"], "no voice: the name alone");
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

test("round language: fixed, or mixed among the fully recorded languages", () => {
  assert.equal(askLanguage({ playLanguage: "sv", languages: ["en", "sv"] }, ["en"], () => 0), "sv");
  assert.equal(askLanguage({ playLanguage: "alternate", languages: ["en", "sv"] }, ["sv"], () => 0), "sv");
  assert.equal(askLanguage({ playLanguage: "alternate", languages: ["en", "sv"] }, [], () => 0.9), "sv");
  const q = [clip("q", "en", "color-question"), clip("q2", "de", "color-question")];
  assert.deepEqual(recordedLangs(q, [clip("w", "en", "color-word"), clip("w2", "sv", "color-word")]), ["en"]);
  assert.deepEqual(recordedLangs([clip("q", "sv")], [henEn, clip("n-sv", "sv", "name")]), ["sv"], "find question and name");
});

test("the device voice reads a line in the language of its script, not the play language", () => {
  // Swedish without a script: the English example lines are read by an English voice.
  const animal = planAnimalAsk({ ...base, lang: "sv", linesLang: "en" });
  assert.deepEqual(animal.ask.find((s) => s.kind === "speak"), { kind: "speak", text: "Where is the hen?", lang: "en" });
  const color = planColorAsk({ questions: [], words: [], lang: "sv", line: { text: "Tap on an animal that is yellow!", lang: "en" }, canSpeak: true, rng: () => 0 });
  assert.equal(color.ask.find((s) => s.kind === "speak").lang, "en");
});

test("recorded tells whether the parent's own question plays (the find buttons' recording tip)", () => {
  assert.equal(planAnimalAsk({ ...base, questions: [clip("q")], names: [henEn] }).recorded, true);
  assert.equal(planAnimalAsk({ ...base, questions: [clip("q")] }).recorded, false, "no name");
  assert.equal(planAnimalAsk({ ...base, questions: [clip("q-sv", "sv")], names: [henEn] }).recorded, false, "question in another language");
  assert.equal(planAnimalAsk({ ...base, canSpeak: false }).recorded, false);
  const line = { text: "Tap on an animal that is yellow!", lang: "en" };
  const q = [clip("q", "en", "color-question")];
  const w = [clip("w", "en", "color-word")];
  assert.equal(planColorAsk({ questions: q, words: w, lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, true);
  assert.equal(planColorAsk({ questions: q, words: [], lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, false, "no word for this colour");
  assert.equal(planColorAsk({ questions: [], words: w, lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, false, "no question");
  assert.equal(planColorAsk({ questions: q, words: [clip("w-sv", "sv", "color-word")], lang: "en", line, canSpeak: true, rng: () => 0 }).recorded, false);
});

test("missing says what keeps a round from playing fully recorded (the recording tip names it)", () => {
  assert.equal(planAnimalAsk({ ...base, names: [henEn] }).missing, "question");
  assert.equal(planAnimalAsk({ ...base, questions: [clip("q")] }).missing, "word");
  assert.equal(planAnimalAsk({ ...base, questions: [clip("q")], names: [henEn] }).missing, null);
  const line = { text: "Tap", lang: "en" };
  assert.equal(planColorAsk({ questions: [clip("q", "en", "color-question")], words: [], lang: "en", line, canSpeak: true, rng: () => 0 }).missing, "word");
  assert.equal(planColorAsk({ questions: [], words: [], lang: "en", line, canSpeak: true, rng: () => 0 }).missing, "question");
});

