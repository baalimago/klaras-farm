import { test } from "node:test";
import assert from "node:assert/strict";
import { spokenName, nameVoice, soundVoice, lineVoice, questionVoice } from "./voice.js";
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

test("questionVoice reads the takes recorded in that language only", () => {
  const s = farm({ language: "en", kind: "prompt", take: 2 });
  assert.equal(questionVoice(s, "cow", "en", 2), "recording");
  assert.equal(questionVoice(s, "cow", "en", 1), "skipped");
  assert.equal(questionVoice(s, "cow", "sv", 2), "voice");
});
