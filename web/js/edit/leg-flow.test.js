import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEG_CHOICES, SUGGESTED_LEGS, UNDO_DEPTH, legFlow, legPhase, chooseCount, legAt, pressLeg, moveLeg, releaseLeg,
  cancelPress, spreadEvenly, spreadRest, clearLegs, undoLeg, legView,
} from "./leg-flow.js";

const square = [[0.4, 0.5], [0.6, 0.5], [0.6, 0.7], [0.4, 0.7]];
const R = 0.02;
/** A full tap (press + release, no move) at point p. */
const tap = (s, p) => releaseLeg(pressLeg(s, p, p, R).state, p).state;

test("choices run 0 to 8, two is suggested until a count is picked", () => {
  assert.deepEqual(LEG_CHOICES, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const v = legView(legFlow());
  assert.equal(v.counts.find((c) => c.suggested).n, SUGGESTED_LEGS);
  assert.equal(v.counts[1].label, "1 leg");
  assert.equal(v.counts[4].label, "4 legs");
  assert.ok(v.counts.every((c) => !c.pressed));
  assert.equal(legView(chooseCount(legFlow(), 3)).counts.filter((c) => c.suggested).length, 0);
});

test("a fresh flow starts at choose-count, or at done with the thing's legs", () => {
  assert.equal(legPhase(legFlow()), "choose-count");
  assert.equal(legView(legFlow()).heading, "How many legs?");
  const two = legFlow([{ x: 0.45, y: 0.69 }, { x: 0.55, y: 0.69 }]);
  assert.equal(two.target, 2);
  assert.equal(legPhase(two), "done");
  assert.equal(legFlow([], 4).target, 4);
  assert.equal(legFlow([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1).target, 2, "never below the placed legs");
  assert.equal(legFlow(null).legs.length, 0);
  assert.equal(legFlow(Array.from({ length: 12 }, () => ({ x: 0, y: 0 }))).legs.length, 8);
  assert.equal(legFlow([], 20).target, 8);
});

test("choose-count → placing (leg k of n) → done, and the count can change at any time", () => {
  let s = chooseCount(legFlow(), 2);
  assert.equal(legView(s).heading, "Tap where leg 1 of 2 goes");
  assert.equal(legView(s).counts[2].pressed, true);
  s = tap(s, [0.45, 0.68]);
  assert.equal(legView(s).heading, "Tap where leg 2 of 2 goes");
  s = chooseCount(s, 4);
  const v = legView(s);
  assert.equal(v.heading, "Tap where leg 2 of 4 goes");
  assert.equal(v.counts[4].pressed, true);
  assert.equal(v.counts[2].pressed, false);
  assert.match(v.note, /1 of 4 placed/);
  for (const x of [0.5, 0.54, 0.58]) s = tap(s, [x, 0.68]);
  assert.equal(legPhase(s), "done");
  assert.equal(legView(s).heading, "4 legs");
  s = chooseCount(s, 1);
  assert.equal(s.legs.length, 1, "fewer drops the newest");
  assert.equal(legView(s).heading, "One leg");
  s = chooseCount(s, 0);
  assert.equal(legView(s).heading, "No legs");
  assert.equal(legView(s).canSpread, false);
  assert.equal(chooseCount(s, 0), s, "same count: same state");
  assert.equal(chooseCount(s, 99).target, 8);
  assert.equal(chooseCount(s, "x").target, 0);
});

test("eight legs go on even when the taps are close together", () => {
  let s = chooseCount(legFlow(), 8);
  for (let i = 0; i < 8; i++) s = tap(s, [0.42 + i * 0.02, 0.69]);
  assert.equal(s.legs.length, 8);
  assert.equal(legPhase(s), "done");
});

test("a press on a leg grabs it; moving drags it; Undo puts it back", () => {
  let s = chooseCount(legFlow(), 2);
  s = tap(s, [0.45, 0.69]);
  s = tap(s, [0.55, 0.69]);
  const r = pressLeg(s, [0.451, 0.69], [0.451, 0.69], R);
  assert.equal(r.action, "grab");
  s = moveLeg(r.state, [0.5, 0.6]);
  s = moveLeg(s, [0.48, 0.58]);
  const up = releaseLeg(s, [0.48, 0.58]);
  assert.equal(up.action, "moved");
  assert.deepEqual(up.state.legs[0], { x: 0.48, y: 0.58 });
  assert.equal(up.state.drag, null);
  assert.deepEqual(up.state.legs[1], { x: 0.55, y: 0.69 }, "the other leg stays put");
  s = undoLeg(up.state);
  assert.deepEqual(s.legs, [{ x: 0.45, y: 0.69 }, { x: 0.55, y: 0.69 }], "leg 1 back, leg 2 kept, nothing removed");
  assert.equal(s.target, 2);
});

test("stray presses never remove a leg", () => {
  let s = chooseCount(legFlow(), 1);
  s = tap(s, [0.5, 0.69]);
  const onLeg = tap(s, [0.5, 0.69]);
  assert.deepEqual(onLeg.legs, s.legs, "a tap on a leg in done does nothing");
  const away = pressLeg(s, [0.9, 0.1], [0.6, 0.5], R);
  assert.equal(away.action, "none");
  assert.equal(away.state, s);
  assert.equal(releaseLeg(s, [0, 0]).action, "none", "release without a press");
  assert.equal(moveLeg(s, [0.1, 0.1]), s, "move without a press");
});

test("while placing, a press outside the shape places the leg where the caller snapped it", () => {
  const s = chooseCount(legFlow(), 1);
  const r = pressLeg(s, [0.9, 0.9], [0.6, 0.7], R);
  assert.equal(r.action, "placed");
  assert.deepEqual(r.state.legs, [{ x: 0.6, y: 0.7 }]);
});

test("cancel keeps a drag where it got to, and drops a press that did not move", () => {
  let s = tap(chooseCount(legFlow(), 2), [0.45, 0.69]);
  const grabbed = pressLeg(s, [0.45, 0.69], [0.45, 0.69], R).state;
  assert.equal(cancelPress(grabbed).legs.length, 1);
  assert.equal(cancelPress(grabbed).drag, null);
  const dragged = cancelPress(moveLeg(grabbed, [0.5, 0.6]));
  assert.deepEqual(dragged.legs[0], { x: 0.5, y: 0.6 });
  assert.equal(dragged.drag, null);
  assert.equal(cancelPress(s), s);
});

test("Spread evenly places all legs along the bottom; Clear takes them off; Undo steps back", () => {
  let s = chooseCount(legFlow(), 6);
  assert.equal(spreadEvenly(legFlow(), square).legs.length, 0, "no count, nothing to spread");
  assert.equal(spreadEvenly(s, null), s);
  s = spreadEvenly(s, square);
  assert.equal(s.legs.length, 6);
  assert.ok(s.legs.every((l) => l.x > 0.4 && l.x < 0.6 && l.y > 0.68 && l.y < 0.7));
  assert.equal(legPhase(s), "done");
  s = clearLegs(s);
  assert.equal(s.legs.length, 0);
  assert.equal(legView(s).heading, "Tap where leg 1 of 6 goes");
  assert.equal(legView(s).canClear, false);
  assert.equal(clearLegs(s), s);
  s = undoLeg(s);
  assert.equal(s.legs.length, 6);
  s = undoLeg(undoLeg(s));
  assert.equal(s.legs.length, 0);
  assert.equal(legView(s).canUndo, false);
  assert.equal(undoLeg(s), s);
});

test("Undo after a smaller count brings the dropped legs back and raises the count again", () => {
  let s = chooseCount(legFlow(), 3);
  for (const x of [0.45, 0.5, 0.55]) s = tap(s, [x, 0.69]);
  s = chooseCount(s, 1);
  s = undoLeg(s);
  assert.equal(s.legs.length, 3);
  assert.equal(s.target, 3);
});

test("undo history is bounded", () => {
  let s = chooseCount(legFlow(), 8);
  for (let i = 0; i < UNDO_DEPTH + 10; i++) s = clearLegs(tap(s, [0.5, 0.69]));
  assert.equal(s.history.length, UNDO_DEPTH);
});

test("legAt finds the nearest leg within the radius", () => {
  const legs = [{ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 }];
  assert.equal(legAt(legs, [0.515, 0.5], 0.02), 1);
  assert.equal(legAt(legs, [0.505, 0.5], 0.02), 0);
  assert.equal(legAt(legs, [0.7, 0.5], 0.02), -1);
});

test("Spread evenly after a bigger count replaces the placed legs with all of them", () => {
  let s = chooseCount(legFlow(), 2);
  s = tap(s, [0.45, 0.69]);
  s = tap(s, [0.55, 0.69]);
  s = chooseCount(s, 4);
  assert.equal(legPhase(s), "placing");
  s = spreadEvenly(s, square);
  assert.equal(s.legs.length, 4);
  assert.equal(legPhase(s), "done");
  s = undoLeg(s);
  assert.deepEqual(s.legs, [{ x: 0.45, y: 0.69 }, { x: 0.55, y: 0.69 }], "Undo brings the two placed legs back");
});

test("Spread the rest keeps the placed legs and fills the gaps up to the count", () => {
  let s = chooseCount(legFlow(), 4);
  s = tap(s, [0.45, 0.69]);
  assert.equal(legView(s).missing, 3);
  const r = spreadRest(s, square);
  assert.equal(r.legs.length, 4);
  assert.deepEqual(r.legs[0], { x: 0.45, y: 0.69 }, "the placed leg stays where it was put");
  assert.equal(legPhase(r), "done");
  assert.equal(legView(r).missing, 0);
  assert.ok(r.legs.every((l) => l.x > 0.4 && l.x < 0.6 && l.y > 0.68 && l.y < 0.7), "new legs along the bottom");
  const xs = r.legs.map((l) => l.x);
  assert.equal(new Set(xs).size, 4, "no two legs on one spot");
  assert.ok(Math.max(...xs) > 0.55, "the gap on the far side gets a leg");
  assert.deepEqual(undoLeg(r).legs, s.legs, "Undo takes the spread legs off again");
});

test("Spread the rest with none placed spreads them all; with none missing it does nothing", () => {
  const none = spreadRest(chooseCount(legFlow(), 3), square);
  assert.deepEqual(none.legs, spreadEvenly(chooseCount(legFlow(), 3), square).legs);
  let s = chooseCount(legFlow(), 1);
  s = tap(s, [0.5, 0.69]);
  assert.equal(spreadRest(s, square), s, "all placed: same state");
  assert.equal(spreadRest(legFlow(), square).legs.length, 0, "no count picked");
  const placing = chooseCount(legFlow(), 2);
  assert.equal(spreadRest(placing, null), placing, "no outline");
});

test("Spread the rest after a drag that is still held ends the drag", () => {
  let s = chooseCount(legFlow(), 3);
  s = tap(s, [0.45, 0.69]);
  s = moveLeg(pressLeg(s, [0.45, 0.69], [0.45, 0.69], R).state, [0.47, 0.68]);
  const r = spreadRest(s, square);
  assert.equal(r.drag, null);
  assert.equal(r.legs.length, 3);
  assert.deepEqual(r.legs[0], { x: 0.47, y: 0.68 });
});
