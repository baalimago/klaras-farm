import { test } from "node:test";
import assert from "node:assert/strict";
import { LEG_COUNTS, legState, legPhase, chooseCount, recount, legAt, tapLeg, undoLeg, legHeading, legNote } from "./legplace.js";

const tapAt = (state, x, y, r = 0.02) => tapLeg(state, [x, y], [x, y - 0.01], r);

test("the count picker offers 0, 1, 2, 3, 4, 6 and 8", () => {
  assert.deepEqual([...LEG_COUNTS], [0, 1, 2, 3, 4, 6, 8]);
});

test("a thing without legs starts at the count picker; one with legs starts done", () => {
  assert.deepEqual(legState([]), { target: null, legs: [] });
  assert.equal(legPhase(legState()), "count");
  const s = legState([{ x: 0.4, y: 0.7 }, { x: 0.6, y: 0.7 }]);
  assert.deepEqual(s.target, 2);
  assert.equal(legPhase(s), "done");
  assert.equal(legPhase(legState([{ x: 0.4, y: 0.7 }], 4)), "place", "a draft remembers the chosen count");
  assert.equal(legState([], 0).target, 0);
});

test("choose a count, then each tap places the next leg until all are placed", () => {
  let s = chooseCount(legState(), 4);
  assert.equal(legPhase(s), "place");
  assert.equal(legHeading(s), "Tap where leg 1 goes");
  for (let i = 0; i < 4; i++) {
    const r = tapAt(s, 0.4 + i * 0.05, 0.72);
    assert.equal(r.action, "placed");
    assert.equal(r.index, i);
    s = r.state;
    if (i < 3) assert.equal(legHeading(s), `Tap where leg ${i + 2} goes`);
  }
  assert.equal(legPhase(s), "done");
  assert.equal(legHeading(s), "4 legs");
  assert.deepEqual(s.legs[0], { x: 0.4, y: 0.71 }, "the snapped point is stored, not the raw tap");
  const extra = tapAt(s, 0.3, 0.5);
  assert.equal(extra.action, "none", "a tap on an empty spot does nothing once every leg is placed");
  assert.equal(extra.state, s);
});

test("tapping a placed leg takes it off, and the next tap puts it somewhere else (moving it)", () => {
  let s = chooseCount(legState(), 2);
  s = tapAt(s, 0.4, 0.72).state;
  s = tapAt(s, 0.6, 0.72).state;
  const off = tapAt(s, 0.405, 0.715);
  assert.equal(off.action, "removed");
  assert.equal(off.index, 0);
  assert.equal(legPhase(off.state), "place");
  assert.deepEqual(off.state.legs, [{ x: 0.6, y: 0.71 }]);
  const moved = tapAt(off.state, 0.5, 0.74);
  assert.equal(moved.action, "placed");
  assert.equal(legPhase(moved.state), "done");
  assert.deepEqual(moved.state.legs.map((l) => l.x), [0.6, 0.5]);
});

test("legAt picks the nearest leg in range, measuring y in 4:3 board units", () => {
  const legs = [{ x: 0.4, y: 0.7 }, { x: 0.42, y: 0.7 }];
  assert.equal(legAt(legs, [0.415, 0.7], 0.02), 1);
  assert.equal(legAt(legs, [0.4, 0.725], 0.02), 0, "0.025 high is 0.019 wide");
  assert.equal(legAt(legs, [0.5, 0.7], 0.02), -1);
});

test("undo takes off the last leg; changing the count keeps or trims what is placed", () => {
  let s = chooseCount(legState(), 3);
  s = tapAt(s, 0.4, 0.72).state;
  s = tapAt(s, 0.5, 0.72).state;
  assert.deepEqual(undoLeg(s).legs.map((l) => l.x), [0.4]);
  assert.deepEqual(undoLeg(undoLeg(undoLeg(s))).legs, []);
  const back = recount(s);
  assert.equal(legPhase(back), "count");
  assert.equal(back.legs.length, 2);
  assert.deepEqual(chooseCount(back, 1).legs.map((l) => l.x), [0.4]);
  assert.equal(legPhase(chooseCount(back, 6)), "place");
  assert.equal(chooseCount(back, 6).legs.length, 2);
  const none = chooseCount(back, 0);
  assert.deepEqual(none, { target: 0, legs: [] });
  assert.equal(legPhase(none), "done");
  assert.equal(legHeading(none), "No legs");
  assert.equal(chooseCount(back, 12).target, 8);
});

test("notes explain each phase", () => {
  assert.match(legNote(legState()), /straight down/);
  assert.match(legNote(chooseCount(legState(), 4)), /0 of 4/);
  assert.match(legNote(legState([{ x: 0.5, y: 0.7 }])), /move/);
});
