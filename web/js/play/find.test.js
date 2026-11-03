import { test } from "node:test";
import assert from "node:assert/strict";
import { createFind, startRound, endRound, stepFind, answerFind, isAnswer, hinting, reconcileFind, findRemainingS, FIND } from "./find.js";
import { colorGroup, groupHex, COLOR_GROUPS } from "./colors.js";
import { SUNNY } from "../farm/palette.js";

const rng = (v = 0.3) => () => v;
const things = [
  { id: "pig", color: "pink", askable: true },
  { id: "cow", color: "white", askable: true },
  { id: "hen", color: "yellow", askable: true },
];

test("nothing happens by itself: no round without a press, and idle time never asks", () => {
  const f = createFind();
  assert.equal(stepFind(f, 1000, { calm: true }), null);
  assert.equal(f.phase, "idle");
  assert.equal(findRemainingS(f), Infinity);
  assert.equal(answerFind(f, "pig", "pink"), "none", "taps without a round are normal taps");
});

test("an animal round always has something to find, and asks for it", () => {
  const f = createFind();
  const ev = startRound(f, "animal", things, rng());
  assert.equal(ev.type, "ask");
  assert.equal(ev.kind, "animal");
  assert.ok(things.some((t) => t.id === ev.thingId));
  assert.equal(f.phase, "asking");
  assert.equal(startRound(createFind(), "animal", [], rng()), null, "an empty scene has no round");
});

test("animal rounds prefer things that can be asked for by name", () => {
  const f = createFind();
  for (const v of [0, 0.4, 0.99]) {
    const ev = startRound(f, "animal", [{ id: "blob", color: "red", askable: false }, { id: "cat", color: "grey", askable: true }], rng(v));
    assert.equal(ev.thingId, "cat");
  }
  const only = startRound(createFind(), "animal", [{ id: "blob", color: "red" }], rng());
  assert.equal(only.thingId, "blob", "with no askable thing, any thing still makes a round");
});

test("the target never repeats when there are two or more things", () => {
  const f = createFind();
  let last = null;
  for (let i = 0; i < 40; i++) {
    const ev = startRound(f, "animal", things, rng((i * 0.37) % 1));
    assert.notEqual(ev.thingId, last);
    last = ev.thingId;
    answerFind(f, ev.thingId);
  }
  const solo = createFind();
  assert.equal(startRound(solo, "animal", [things[0]], rng()).thingId, "pig");
  assert.equal(startRound(solo, "animal", [things[0]], rng()).thingId, "pig", "one thing: it can be asked again");
});

test("right tap ends the round; wrong taps count misses and reset the quiet wait", () => {
  const f = createFind();
  startRound(f, "animal", things, rng(0));
  const target = f.target;
  const other = things.find((t) => t.id !== target);
  stepFind(f, 4, { calm: true });
  assert.equal(answerFind(f, other.id, other.color), "wrong");
  assert.equal(f.quietS, 0);
  assert.equal(hinting(f), false);
  assert.equal(answerFind(f, other.id, other.color), "wrong");
  assert.equal(hinting(f), true, "after 2 misses the right thing glows");
  assert.equal(answerFind(f, target), "correct");
  assert.equal(f.phase, "idle");
  assert.equal(hinting(f), false);
  assert.equal(answerFind(f, target), "none");
});

test("after ~6 quiet seconds the right thing hops and the question repeats, once", () => {
  const f = createFind();
  startRound(f, "animal", things, rng());
  assert.equal(stepFind(f, 10, { calm: false }), null, "the wait doesn't run while a voice plays");
  assert.equal(stepFind(f, FIND.nudgeAfterS - 1, { calm: true }), null);
  assert.ok(findRemainingS(f) <= 1.001);
  assert.deepEqual(stepFind(f, 1.1, { calm: true }), { type: "nudge" });
  assert.equal(stepFind(f, FIND.nudgeAfterS + 1, { calm: true }), null, "only once");
});

test("a round ends quietly after ~30 s without the right tap", () => {
  const f = createFind();
  startRound(f, "animal", things, rng());
  let ev = null;
  for (let t = 0; t < FIND.timeoutS + 1 && !ev?.type?.startsWith("time"); t += 0.5) ev = stepFind(f, 0.5, { calm: false });
  assert.deepEqual(ev, { type: "timeout" });
  assert.equal(f.phase, "idle");
  assert.equal(findRemainingS(f), Infinity);
});

test("findRemainingS wakes the renderer for the nudge, then for the timeout", () => {
  const f = createFind();
  startRound(f, "animal", things, rng());
  assert.equal(findRemainingS(f), FIND.nudgeAfterS);
  stepFind(f, FIND.nudgeAfterS + 0.01, { calm: true });
  assert.ok(Math.abs(findRemainingS(f) - (FIND.timeoutS - FIND.nudgeAfterS - 0.01)) < 1e-9);
});

test("colour round: a colour present in the scene; any thing of that simple colour is right", () => {
  const f = createFind();
  const scene = [
    { id: "sun", color: "yellow" },
    { id: "hen", color: "sand" },
    { id: "pot", color: "blue" },
    { id: "sea", color: "water" },
  ];
  const ev = startRound(f, "color", scene, rng(0));
  assert.equal(ev.kind, "color");
  assert.equal(ev.thingId, null);
  assert.ok(["yellow", "blue"].includes(ev.color));
  const [right, alsoRight] = ev.color === "yellow" ? ["sun", "hen"] : ["pot", "sea"];
  const wrong = ev.color === "yellow" ? scene[2] : scene[0];
  assert.ok(isAnswer(f, alsoRight, scene.find((t) => t.id === alsoRight).color), "sky, water and blue are all blue");
  assert.equal(answerFind(f, wrong.id, wrong.color), "wrong");
  assert.equal(answerFind(f, right, scene.find((t) => t.id === right).color), "correct");
});

test("colour rounds don't repeat the last colour when there are two or more; one colour is fine", () => {
  const f = createFind();
  let last = null;
  for (let i = 0; i < 20; i++) {
    const ev = startRound(f, "color", things, rng((i * 0.61) % 1));
    assert.notEqual(ev.color, last);
    last = ev.color;
  }
  const mono = createFind();
  const one = [{ id: "a", color: "red" }, { id: "b", color: "red" }];
  assert.equal(startRound(mono, "color", one, rng()).color, "red");
  assert.equal(startRound(mono, "color", one, rng()).color, "red");
});

test("a round ends when its answer leaves the scene; endRound remembers the last target", () => {
  const f = createFind();
  startRound(f, "animal", things, rng(0));
  const target = f.target;
  assert.equal(reconcileFind(f, things), false);
  assert.equal(reconcileFind(f, things.filter((t) => t.id !== target)), true);
  assert.equal(f.phase, "idle");
  assert.equal(f.last, target);
  startRound(f, "color", [{ id: "x", color: "red" }], rng());
  assert.equal(reconcileFind(f, [{ id: "y", color: "leaf" }]), true);
  startRound(f, "animal", things, rng());
  endRound(f);
  assert.equal(f.phase, "idle");
});

test("every felt colour folds into a simple colour word with a swatch", () => {
  for (const key of Object.keys(SUNNY)) assert.ok(COLOR_GROUPS[colorGroup(key)], `${key} has a simple colour`);
  assert.equal(colorGroup("sky"), "blue");
  assert.equal(colorGroup("dark"), "black");
  assert.equal(colorGroup("nope"), null);
  assert.equal(groupHex("green"), SUNNY.leaf);
});
