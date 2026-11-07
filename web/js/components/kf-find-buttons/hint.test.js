import { test } from "node:test";
import assert from "node:assert/strict";
import { initialHint, nextHint, hintText, HINT_SHOW_MS, HINT_COOLDOWN_MS } from "./hint.js";

const ask = (kind, now, { recorded = false, enabled = true, missing } = {}) => ({ type: "ask", kind, recorded, enabled, now, ...(missing ? { missing } : {}) });
const run = (events, s = initialHint()) => events.reduce(nextHint, s);

test("an unrecorded question shows the tip beside its game's button, then it fades by itself", () => {
  const s = run([ask("animal", 1000)]);
  assert.deepEqual(s.showing, { kind: "animal", until: 1000 + HINT_SHOW_MS, missing: "question" });
  assert.equal(run([{ type: "expire", now: 1000 + HINT_SHOW_MS - 1 }], s), s, "not before its time");
  assert.equal(run([{ type: "expire", now: 1000 + HINT_SHOW_MS }], s).showing, null);
});

test("the colour game gets the tip too", () => {
  assert.equal(run([ask("color", 0)]).showing.kind, "color");
});

test("a recorded question never shows the tip, and hides one showing for that game", () => {
  assert.equal(run([ask("animal", 0, { recorded: true })]).showing, null);
  assert.equal(run([ask("animal", 0), ask("animal", 10, { recorded: true })]).showing, null);
  assert.equal(run([ask("color", 0), ask("animal", 10, { recorded: true })]).showing.kind, "color", "the other game's tip stays");
});

test("cooldown: not again for the same game within a few minutes, however often the child presses", () => {
  let s = run([ask("animal", 0), { type: "expire", now: HINT_SHOW_MS }]);
  s = run([ask("animal", HINT_SHOW_MS + 1), ask("animal", HINT_COOLDOWN_MS - 1)], s);
  assert.equal(s.showing, null);
  s = run([ask("animal", HINT_COOLDOWN_MS)], s);
  assert.equal(s.showing.kind, "animal", "back after the cooldown");
});

test("each game has its own cooldown; the newest tip replaces the one showing", () => {
  const s = run([ask("animal", 0), ask("color", 100)]);
  assert.deepEqual(s.showing, { kind: "color", until: 100 + HINT_SHOW_MS, missing: "question" });
  assert.deepEqual(Object.keys(s.shownAt).sort(), ["animal", "color"]);
});

test("tips switched off: never shown, and one showing goes away", () => {
  assert.equal(run([ask("animal", 0, { enabled: false })]).showing, null);
  assert.equal(run([ask("animal", 0), ask("color", 5, { enabled: false })]).showing, null);
});

test("hide (leaving play, buttons hidden) clears it; stray events change nothing", () => {
  const shown = run([ask("animal", 0)]);
  assert.equal(nextHint(shown, { type: "hide" }).showing, null);
  const idle = initialHint();
  assert.equal(nextHint(idle, { type: "hide" }), idle);
  assert.equal(nextHint(idle, { type: "expire", now: 5 }), idle);
  assert.equal(nextHint(shown, { type: "other" }), shown);
});

test("the words match the real hold time", () => {
  assert.equal(hintText(1000), "Hold 1 s to record your own question");
  assert.equal(hintText(1500), "Hold 1.5 s to record your own question");
});

test("with the question recorded but not the answer's word, the tip asks for the name or the colour word (format 5)", () => {
  assert.equal(run([ask("animal", 0, { missing: "word" })]).showing.missing, "word");
  assert.equal(run([ask("animal", 0, { missing: "question" })]).showing.missing, "question");
  assert.equal(run([ask("animal", 0)]).showing.missing, "question", "an older ask event without `missing` asks for the question");
  assert.equal(hintText(1000, { kind: "animal", missing: "word" }), "Hold 1 s to record its name");
  assert.equal(hintText(1000, { kind: "color", missing: "word" }), "Hold 1 s to record the colour word");
  assert.equal(hintText(1000, { kind: "color", missing: "question" }), "Hold 1 s to record your own question");
});
