import { test } from "node:test";
import assert from "node:assert/strict";
import { createFind, stepFind, answerFind, hintFor, findRemainingS, FIND } from "./find.js";

const rng = () => 0.3;
const on = (candidates = ["pig", "cow"], calm = true) => ({ enabled: true, candidates, calm });

test("asks for a thing after the first delay, never while play is busy", () => {
  const f = createFind();
  assert.equal(stepFind(f, FIND.firstAskS + 1, on(["pig"], false), rng), null, "finger down or asleep: no time passes");
  assert.equal(stepFind(f, FIND.firstAskS - 1, on(["pig"]), rng), null);
  assert.deepEqual(stepFind(f, 1.5, on(["pig"]), rng), { type: "ask", thingId: "pig", repeat: false });
  assert.equal(f.phase, "asking");
});

test("off or nothing askable: stays idle and resets", () => {
  const f = createFind();
  assert.equal(stepFind(f, 100, { enabled: false, candidates: ["pig"], calm: true }, rng), null);
  assert.equal(stepFind(f, 100, on([]), rng), null);
  assert.equal(f.phase, "idle");
  assert.equal(findRemainingS(f, false), Infinity);
});

test("a right tap celebrates, then a new question comes after a gap and picks another thing", () => {
  const f = createFind();
  stepFind(f, FIND.firstAskS + 0.1, on(), rng);
  const first = f.target;
  assert.equal(answerFind(f, first), "correct");
  assert.equal(f.phase, "celebrate");
  assert.equal(stepFind(f, FIND.celebrateS + 0.1, on(), rng), null);
  assert.equal(f.phase, "idle");
  assert.ok(f.timer >= FIND.gapMinS && f.timer <= FIND.gapMaxS);
  const ev = stepFind(f, FIND.gapMaxS + 1, on(), rng);
  assert.equal(ev.type, "ask");
  assert.notEqual(ev.thingId, first, "doesn't ask for the same thing twice in a row");
});

test("wrong taps are gentle: the question repeats, and after 2 misses the right thing glows", () => {
  const f = createFind();
  stepFind(f, FIND.firstAskS + 0.1, on(["pig"]), rng);
  assert.equal(answerFind(f, "cow"), "wrong");
  assert.equal(hintFor(f), null);
  assert.equal(answerFind(f, "cow"), "wrong");
  assert.equal(hintFor(f), "pig");
  assert.equal(answerFind(f, "pig"), "correct");
  assert.equal(hintFor(f), null);
});

test("no answer: asks once more, then gives up quietly", () => {
  const f = createFind();
  stepFind(f, FIND.firstAskS + 0.1, on(["pig"]), rng);
  assert.deepEqual(stepFind(f, FIND.repeatAfterS + 0.1, on(["pig"]), rng), { type: "ask", thingId: "pig", repeat: true });
  assert.deepEqual(stepFind(f, FIND.repeatAfterS + 0.1, on(["pig"]), rng), { type: "give-up", thingId: "pig" });
  assert.equal(f.phase, "idle");
});

test("taps when nothing is asked are normal taps; a deleted target cancels the question", () => {
  const f = createFind();
  assert.equal(answerFind(f, "pig"), "none");
  stepFind(f, FIND.firstAskS + 0.1, on(["pig", "cow"]), rng);
  stepFind(f, 0.1, on(["hen"]), rng);
  assert.equal(f.phase, "idle");
  assert.equal(f.target, null);
});
