import { test } from "node:test";
import assert from "node:assert/strict";
import { initialFlow, flowReducer, backAction, nextAction, finishAction, emptyDraft, NONE, STAMP, LEAVE, NAME_STEP } from "./flow.js";
import { STEPS } from "./steps.js";

const run = (events, s = initialFlow()) => events.reduce(flowReducer, s);

test("starts on the panel with no prompt", () => {
  assert.deepEqual(initialFlow(), { overlay: NONE, prompt: null });
});

test("stamping opens only over a body, and Done or Cancel brings the panel back", () => {
  assert.equal(run([{ type: "stamp", canStamp: false }]).overlay, NONE, "no body: no stamping dead end");
  const s = run([{ type: "stamp", canStamp: true }]);
  assert.equal(s.overlay, STAMP);
  assert.equal(flowReducer(s, { type: "stamp", canStamp: true }), s, "already stamping");
  assert.equal(flowReducer(s, { type: "stampEnded" }).overlay, NONE);
  assert.equal(run([{ type: "stampEnded" }]).overlay, NONE, "a stray end changes nothing");
});

test("✕ asks from anywhere; Keep going returns to the panel; a step change closes everything", () => {
  for (const before of [initialFlow(), { overlay: STAMP, prompt: null }, { overlay: NONE, prompt: "name" }]) {
    const s = flowReducer(before, { type: "close" });
    assert.equal(s.overlay, LEAVE);
    assert.equal(flowReducer(s, { type: "stay" }).overlay, NONE);
    assert.deepEqual(flowReducer(s, { type: "step" }), initialFlow());
  }
  assert.equal(run([{ type: "stay" }]).overlay, NONE);
  const stamping = { overlay: STAMP, prompt: null };
  assert.equal(flowReducer(stamping, { type: "stay" }), stamping, "a stray Keep going never ends Klara's stamping");
  assert.equal(run([{ type: "close" }, { type: "stamp", canStamp: true }]).overlay, LEAVE, "no stamping behind the dialog");
});

test("the name prompt shows until a name is typed or the step changes", () => {
  const s = run([{ type: "needName" }]);
  assert.equal(s.prompt, "name");
  assert.equal(flowReducer(s, { type: "named" }).prompt, null);
  assert.equal(flowReducer(s, { type: "step" }).prompt, null);
  const quiet = initialFlow();
  assert.equal(flowReducer(quiet, { type: "named" }), quiet);
  assert.equal(flowReducer(quiet, { type: "nonsense" }), quiet);
});

test("‹ Back steps back, and on the first step asks to stop adding", () => {
  assert.deepEqual(backAction(3), { type: "go", step: 2 });
  assert.deepEqual(backAction(1), { type: "go", step: 0 });
  assert.deepEqual(backAction(0), { type: "leave" });
});

test("Next past Name needs a name in some language; the other steps go on", () => {
  assert.equal(STEPS[NAME_STEP], "name");
  assert.deepEqual(nextAction(NAME_STEP, { names: {} }), { type: "needName", step: NAME_STEP });
  assert.deepEqual(nextAction(NAME_STEP, { names: { en: "  " } }), { type: "needName", step: NAME_STEP });
  assert.deepEqual(nextAction(NAME_STEP, { names: { sv: "Ko" } }), { type: "go", step: NAME_STEP + 1 });
  assert.deepEqual(nextAction(0, {}), { type: "go", step: 1 });
  assert.deepEqual(nextAction(STEPS.length - 1, { names: { en: "x" } }), { type: "go", step: STEPS.length - 1 });
});

test("Finish without a name goes to the Name step and asks", () => {
  assert.deepEqual(finishAction({ names: {} }), { type: "needName", step: NAME_STEP });
  assert.deepEqual(finishAction({}), { type: "needName", step: NAME_STEP });
  assert.deepEqual(finishAction({ names: { en: "Cow" } }), { type: "finish" });
});

test("emptyDraft: nothing drawn, named or recorded", () => {
  assert.equal(emptyDraft({ thing: { outline: null, names: {} }, clips: [] }), true);
  assert.equal(emptyDraft(null), true);
  assert.equal(emptyDraft({ thing: { outline: [], names: {} }, clips: [] }), true, "an empty outline is no drawing");
  assert.equal(emptyDraft({ thing: { outline: [[0, 0], [1, 0], [1, 1]] }, clips: [] }), false);
  assert.equal(emptyDraft({ thing: { names: { en: "Cow" } }, clips: [] }), false);
  assert.equal(emptyDraft({ thing: {}, clips: [{ kind: "sound" }] }), false);
});
