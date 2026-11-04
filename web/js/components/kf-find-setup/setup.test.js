import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSetup, nextSetup, isRecording, askSlots, colorMissing, missingText } from "./setup.js";

const run = (events, s = initialSetup("color", "en")) => events.reduce(nextSetup, s);

test("starts on the game it was opened for, nothing recording or picked", () => {
  assert.deepEqual(initialSetup("animal", "sv"), { game: "animal", lang: "sv", recording: null, picked: null, extraAsks: 0 });
  assert.equal(initialSetup("anything", "en").game, "animal");
  assert.equal(initialSetup("color", "en").game, "color");
});

test("one recorder at a time; cancel and saved close it", () => {
  const a = { kind: "prompt", thingId: "hen", take: 2 };
  const b = { kind: "color-question", take: 1 };
  let s = run([{ type: "record", slot: a }]);
  assert.equal(isRecording(s, a), true);
  assert.equal(isRecording(s, { ...a, take: 1 }), false);
  s = nextSetup(s, { type: "record", slot: b });
  assert.equal(isRecording(s, a), false);
  assert.equal(isRecording(s, b), true);
  assert.equal(nextSetup(s, { type: "saved" }).recording, null);
  assert.equal(nextSetup(s, { type: "cancel" }).recording, null);
  const idle = initialSetup("color", "en");
  assert.equal(nextSetup(idle, { type: "cancel" }), idle, "nothing to close: same state");
  assert.equal(nextSetup(idle, { type: "unknown" }), idle);
});

test("switching language closes the recorder and the extra slots; the same tab changes nothing", () => {
  const s = run([{ type: "add-ask" }, { type: "record", slot: { kind: "color-question", take: 2 } }]);
  const sv = nextSetup(s, { type: "lang", lang: "sv" });
  assert.equal(sv.lang, "sv");
  assert.equal(sv.recording, null);
  assert.equal(sv.extraAsks, 0);
  assert.equal(nextSetup(s, { type: "lang", lang: "en" }), s);
});

test("picking a colour (an animal or a swatch) shows its word slot; picking another closes an open word recorder", () => {
  let s = run([{ type: "pick", color: "yellow" }, { type: "record", slot: { kind: "color-word", color: "yellow" } }]);
  assert.equal(s.picked, "yellow");
  s = nextSetup(s, { type: "pick", color: "red" });
  assert.equal(s.picked, "red");
  assert.equal(s.recording, null);
  const q = run([{ type: "record", slot: { kind: "color-question", take: 1 } }, { type: "pick", color: "red" }]);
  assert.equal(q.recording.kind, "color-question", "the question recorder stays");
  assert.equal(nextSetup(s, { type: "pick", color: "sun" }), s, "felt keys are not colours to pick");
});

test("colour question slots: recorded takes plus added ones, at least 1, at most 6", () => {
  const s = initialSetup("color", "en");
  assert.equal(askSlots(s, []), 1);
  assert.equal(askSlots(s, [1, 3]), 3);
  assert.equal(askSlots(run([{ type: "add-ask" }]), []), 2);
  assert.equal(askSlots(run(Array(9).fill({ type: "add-ask" })), [2]), 6);
});

test("what is missing: the question and the scene's colours without a word, per language", () => {
  const words = [{ language: "en", color: "pink" }, { language: "sv", color: "white" }];
  const m = colorMissing({ needed: ["white", "pink", "red"], words, questions: [{ language: "sv" }], lang: "en" });
  assert.deepEqual(m, { question: true, colors: ["red", "white"] });
  assert.equal(missingText(m, (c) => c.toUpperCase()), "Still to record: the question, RED, WHITE.");
  const sv = colorMissing({ needed: ["white"], words, questions: [{ language: "sv" }], lang: "sv" });
  assert.deepEqual(sv, { question: false, colors: [] });
  assert.equal(missingText(sv), null);
  assert.equal(missingText({ question: false, colors: ["red"] }), "Still to record: red.");
});
