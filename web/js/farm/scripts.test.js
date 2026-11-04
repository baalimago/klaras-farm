import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, cueLines, scriptFileFor, questionCount, DEFAULT_QUESTIONS, MAX_CUE_LINES, colorQuestionText, colorWord } from "./scripts.js";

const files = {
  en: { templates: ["Where is the {name}?", "Can you find the {name}?", "Show me the {name}!"], articles: [] },
  de: { templates: ["Wo ist {the} {name}?", "Kannst du {the} {name} finden?", "Zeig mir {the} {name}!"], articles: ["der", "die", "das"] },
};

test("fills name and article, dropping the article slot when empty", () => {
  assert.equal(fillTemplate("Wo ist {the} {name}?", { name: "Hund", article: "der" }), "Wo ist der Hund?");
  assert.equal(fillTemplate("Wo ist {the} {name}?", { name: "Hund" }), "Wo ist Hund?");
});

test("uses the language file, the base language, or English with a fallback flag", () => {
  assert.equal(scriptFileFor(files, "de-AT").fallback, false);
  assert.equal(scriptFileFor(files, "fi").fallback, true);
});

test("cue lines honour the parent's edits per line; an empty line is the example", () => {
  const thing = { names: { de: "Hund", en: "dog" }, cues: { de: { article: "der", lines: [null, "Wo versteckt sich der Hund?", ""] } } };
  const de = cueLines(files, thing, "de");
  assert.deepEqual(de.lines, ["Wo ist der Hund?", "Wo versteckt sich der Hund?", "Zeig mir der Hund!"]);
  assert.deepEqual(de.examples, ["Wo ist der Hund?", "Kannst du der Hund finden?", "Zeig mir der Hund!"]);
  const fi = cueLines(files, thing, "fi");
  assert.equal(fi.fallback, true);
  assert.equal(fi.lines[0], "Where is the dog?");
});

test("the number of questions is the length of the parent's lines (1 to 6), else 3 examples", () => {
  const thing = (lines) => ({ names: { en: "dog" }, cues: lines ? { en: { lines } } : {} });
  assert.equal(questionCount(thing(), "en"), DEFAULT_QUESTIONS);
  assert.deepEqual(cueLines(files, thing(["Woof?"]), "en").lines, ["Woof?"]);
  const six = cueLines(files, thing(["a", "", "", "", "e", ""]), "en");
  assert.deepEqual(six.lines, ["a", "Can you find the dog?", "Show me the dog!", "Where is the dog?", "e", "Show me the dog!"], "examples go round");
  assert.equal(questionCount(thing(Array(9).fill("x")), "en"), MAX_CUE_LINES);
  assert.deepEqual(cueLines({}, thing(["", "Hi?"]), "en").lines, ["", "Hi?"], "no script file: empty examples");
});

test("colour game texts: the question to record and the colour words, with English fallback", () => {
  const colorFiles = { ...files, en: { ...files.en, colorQuestion: "Tap on an animal that is…", colors: { yellow: "yellow" } }, sv: { templates: [], colors: { yellow: "gult" } } };
  assert.equal(colorQuestionText(colorFiles, "en"), "Tap on an animal that is…");
  assert.equal(colorQuestionText(colorFiles, "sv"), "Tap on an animal that is…");
  assert.equal(colorQuestionText({}, "sv"), "");
  assert.equal(colorWord(colorFiles, "yellow", "sv"), "gult");
  assert.equal(colorWord(colorFiles, "yellow", "fi"), null);
  assert.equal(colorWord(colorFiles, "red", "en"), null);
});
