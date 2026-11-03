import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, cueLines, scriptFileFor } from "./scripts.js";

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

test("cue lines honour the parent's edits per line", () => {
  const thing = { names: { de: "Hund", en: "dog" }, cues: { de: { article: "der", lines: [null, "Wo versteckt sich der Hund?"] } } };
  assert.deepEqual(cueLines(files, thing, "de").lines, ["Wo ist der Hund?", "Wo versteckt sich der Hund?", "Zeig mir der Hund!"]);
  const fi = cueLines(files, thing, "fi");
  assert.equal(fi.fallback, true);
  assert.equal(fi.lines[0], "Where is the dog?");
});
