import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, askLines, findQuestionText, scriptFileFor, colorQuestionText, colorWord } from "./scripts.js";

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

test("ask lines: every script template with the typed name and the chosen article", () => {
  const thing = { names: { de: "Hund", en: "dog" }, cues: { de: { article: "der" } } };
  const de = askLines(files, thing, "de");
  assert.deepEqual(de.lines, ["Wo ist der Hund?", "Kannst du der Hund finden?", "Zeig mir der Hund!"]);
  assert.deepEqual(de.articles, ["der", "die", "das"]);
  assert.equal(de.fallback, false);
  const fi = askLines(files, thing, "fi");
  assert.equal(fi.fallback, true);
  assert.deepEqual(fi.articles, [], "no article in an English fallback");
  assert.equal(fi.lines[0], "Where is the dog?");
  assert.deepEqual(askLines({}, thing, "en").lines, [], "no script file: nothing to say");
  assert.equal(askLines(files, { names: {} }, "en").lines[0], "Where is the …?");
});

test("find question text: what the parent records, with English fallback", () => {
  const f = { en: { findQuestion: "Where is the…" }, sv: { findQuestion: "Var är…" }, de: {} };
  assert.equal(findQuestionText(f, "sv"), "Var är…");
  assert.equal(findQuestionText(f, "de"), "Where is the…");
  assert.equal(findQuestionText(f, "fi"), "Where is the…");
  assert.equal(findQuestionText({}, "en"), "");
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
