import { test } from "node:test";
import assert from "node:assert/strict";
import { TOUR_STEPS, initialTour, nextTour, tourStep, tourCard, cardPlacement, PENCIL, SCENES_BUTTON } from "./tour.js";

const run = (types, s = initialTour()) => types.reduce((st, type) => nextTour(st, { type }), s);

test("the decided order: example creature, how to edit, scenes, how to record sounds", () => {
  assert.deepEqual(TOUR_STEPS, ["creature", "edit", "scenes", "sounds"]);
});

test("off until started; Next walks every card, and Next on the last one finishes", () => {
  assert.equal(tourStep(initialTour()), null);
  let s = run(["start"]);
  const seen = [];
  while (s.phase === "on") {
    seen.push(tourStep(s));
    s = nextTour(s, { type: "next" });
  }
  assert.deepEqual(seen, TOUR_STEPS);
  assert.equal(s.phase, "done");
  assert.equal(tourStep(s), null);
});

test("Skip tour ends it from any card", () => {
  for (let i = 0; i < TOUR_STEPS.length; i++) {
    const s = run(["start", ...Array(i).fill("next"), "skip"]);
    assert.equal(s.phase, "done", `skip on card ${i + 1}`);
  }
});

test("Back goes one card back, never before the first", () => {
  assert.equal(run(["start", "next", "next", "back"]).index, 1);
  assert.deepEqual(run(["start", "back"]), { phase: "on", index: 0 });
});

test("events outside the tour change nothing; start again (Settings) begins at the first card", () => {
  const off = initialTour();
  for (const type of ["next", "back", "skip", "other"]) assert.equal(nextTour(off, { type }), off);
  const done = run(["start", "skip"]);
  assert.equal(nextTour(done, { type: "next" }), done);
  assert.deepEqual(nextTour(done, { type: "start" }), { phase: "on", index: 0 });
  assert.deepEqual(run(["start", "next", "start"]), { phase: "on", index: 0 });
});

test("cards point at the real controls in edit mode, and say how to get there in play", () => {
  const play = { mode: "play", holdMs: 1500 };
  const edit = { mode: "edit", holdMs: 1500 };
  assert.deepEqual(tourCard("creature", play).target, { kind: "actor" });
  assert.match(tourCard("creature", play).body, /^Tap it to hear it/);
  assert.deepEqual(tourCard("creature", edit).target, { kind: "actor" });
  assert.equal(tourCard("edit", play).target, null);
  assert.match(tourCard("edit", play).body, /hold the scene for 1\.5 s/);
  assert.match(tourCard("edit", { mode: "play", holdMs: 2000 }).body, /for 2 s/, "the real hold time");
  assert.deepEqual(tourCard("edit", edit).target, { kind: "selector", selector: PENCIL });
  // Both say how editing an animal works: a first tap selects, the ring's round handle resizes, a second tap (or the pencil) opens its card.
  for (const card of [tourCard("edit", play), tourCard("edit", edit)]) {
    assert.match(card.body, /tap an animal to select it/i);
    assert.match(card.body, /round handle on its ring/);
    assert.match(card.body, /bigger or smaller|resizes it/);
    assert.match(card.body, /(again|second tap).*✎ pencil/);
  }
  assert.equal(tourCard("scenes", play).target, null);
  assert.match(tourCard("scenes", play).body, /In edit mode, tap Scenes/);
  assert.deepEqual(tourCard("scenes", edit).target, { kind: "selector", selector: SCENES_BUTTON });
  assert.equal(tourCard("sounds", play).title, "What does the fox say?");
  assert.deepEqual(tourCard("sounds", play).target, { kind: "actor" });
  assert.deepEqual(tourCard("sounds", edit).target, { kind: "selector", selector: PENCIL });
  assert.deepEqual(tourCard("nope", play), { title: "", body: "", target: null });
});

test("the card never covers its target: top when the target is low or missing, else bottom", () => {
  assert.equal(cardPlacement(null, 820), "top");
  assert.equal(cardPlacement({ top: 600, height: 100 }, 820), "top");
  assert.equal(cardPlacement({ top: 100, height: 100 }, 820), "bottom");
  // Its middle decides, not its top: a tall target starting above the half line but centred below it.
  assert.equal(cardPlacement({ top: 350, height: 200 }, 820), "top");
  assert.equal(cardPlacement({ top: 200, height: 300 }, 820), "bottom", "centred above the half line, though it reaches below");
  assert.equal(cardPlacement({ top: 360, height: 100 }, 820), "bottom", "exactly on the half line: bottom");
});
