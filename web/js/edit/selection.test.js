import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_SELECTION, initialSelection, nextSelection, selectedId, isResizing, ownsPointer, tapAction,
  handleOffset, resizeOutcome, resizeGesture, resizeGestureTo,
} from "./selection.js";
import { thingSize, THING_SCALE_MIN, THING_SCALE_MAX } from "../geometry/transform.js";

const run = (events, s = initialSelection()) => events.reduce((st, e) => nextSelection(st, e), s);
const down = (id = "pig", pointerId = 1) => ({ type: "handle-down", id, pointerId, pivot: [100, 200], corner: [160, 220] });
const sel = (id) => ({ phase: "selected", id });

test("nothing is selected at first", () => {
  const s = initialSelection();
  assert.equal(s, NO_SELECTION);
  assert.equal(selectedId(s), null);
  assert.equal(isResizing(s), false);
  assert.deepEqual(handleOffset(s), [0, 0]);
});

test("a tap, a drag or the pencil selects that thing; another thing moves the selection", () => {
  for (const type of ["tap", "grab", "pencil"]) {
    const s = run([{ type, id: "pig" }]);
    assert.deepEqual(s, sel("pig"), type);
    assert.deepEqual(nextSelection(s, { type, id: "cow" }), sel("cow"), `${type} another`);
    assert.equal(nextSelection(s, { type, id: "pig" }), s, `${type} the same: unchanged`);
    assert.equal(nextSelection(s, { type }), s, `${type} without an id`);
  }
});

test("tap-away keeps the selection; unknown events change nothing", () => {
  const s = run([{ type: "tap", id: "pig" }]);
  assert.equal(nextSelection(s, { type: "tap-empty" }), s);
  assert.equal(nextSelection(s, { type: "nope" }), s);
  assert.equal(nextSelection(NO_SELECTION, { type: "tap-empty" }), NO_SELECTION);
});

test("the first tap selects, a second tap on the same thing opens its card, a tap on another selects it", () => {
  const none = initialSelection();
  assert.equal(tapAction(none, "pig"), "select");
  const s = nextSelection(none, { type: "tap", id: "pig" });
  assert.equal(tapAction(s, "pig"), "open-card");
  assert.equal(tapAction(s, "cow"), "select");
  assert.equal(tapAction(s, null), "ignore");
  assert.equal(tapAction(run([down()], s), "pig"), "ignore", "not while resizing");
});

test("the handle starts a resize only on the selected thing", () => {
  assert.equal(nextSelection(NO_SELECTION, down()), NO_SELECTION, "nothing selected");
  const s = run([{ type: "tap", id: "pig" }]);
  assert.equal(nextSelection(s, down("cow")), s, "another thing's handle");
  assert.equal(nextSelection(s, { ...down(), pivot: null }), s, "no pivot (the board could not start)");
  assert.equal(nextSelection(s, { ...down(), corner: [1, NaN] }), s, "no corner");
  const r = nextSelection(s, down());
  assert.deepEqual(r, { phase: "resizing", id: "pig", pointerId: 1, pivot: [100, 200], corner: [160, 220], k: 1 });
  assert.equal(selectedId(r), "pig");
  assert.equal(isResizing(r), true);
  assert.equal(ownsPointer(r, 1), true);
  assert.equal(ownsPointer(r, 2), false);
  assert.equal(ownsPointer(s, 1), false);
});

test("while resizing, taps, drags, the pencil and a second handle change nothing", () => {
  const r = run([{ type: "tap", id: "pig" }, down()]);
  for (const e of [{ type: "tap", id: "cow" }, { type: "tap", id: "pig" }, { type: "grab", id: "cow" }, { type: "pencil", id: "cow" }, down("pig", 2), { type: "tap-empty" }]) {
    assert.equal(nextSelection(r, e), r, e.type);
  }
});

test("moves scale the handle's corner about the pivot; only the resizing pointer counts", () => {
  const r = run([{ type: "tap", id: "pig" }, down()]);
  const m = nextSelection(r, { type: "handle-move", pointerId: 1, k: 1.5 });
  assert.equal(m.k, 1.5);
  assert.deepEqual(handleOffset(m), [30, 10]); // (160-100)*0.5, (220-200)*0.5
  assert.deepEqual(handleOffset(nextSelection(m, { type: "handle-move", pointerId: 1, k: 0.5 })), [-30, -10]);
  assert.equal(nextSelection(m, { type: "handle-move", pointerId: 2, k: 2 }), m, "another pointer");
  assert.equal(nextSelection(m, { type: "handle-move", pointerId: 1, k: 1.5 }), m, "the same scale");
  for (const k of [0, -1, NaN, Infinity, undefined]) assert.equal(nextSelection(m, { type: "handle-move", pointerId: 1, k }), m, `k ${k}`);
  assert.equal(nextSelection(sel("pig"), { type: "handle-move", pointerId: 1, k: 2 }).phase, "selected", "not resizing");
});

test("lifting the finger commits; pointercancel and lost capture cancel; the thing stays selected", () => {
  const r = run([{ type: "tap", id: "pig" }, down(), { type: "handle-move", pointerId: 1, k: 1.4 }]);
  for (const [type, outcome] of [["handle-up", "commit"], ["handle-cancel", "cancel"], ["lost-capture", "cancel"]]) {
    const e = { type, pointerId: 1 };
    const s = nextSelection(r, e);
    assert.deepEqual(s, sel("pig"), type);
    assert.equal(resizeOutcome(r, s, e), outcome, type);
    assert.equal(nextSelection(r, { type, pointerId: 2 }), r, `${type} of another pointer`);
    // After the end, a stray lost capture (it follows pointerup) changes nothing.
    assert.equal(nextSelection(s, { type: "lost-capture", pointerId: 1 }), s);
  }
  assert.equal(resizeOutcome(r, r, { type: "handle-move" }), null, "still resizing");
  assert.equal(resizeOutcome(sel("pig"), sel("cow"), { type: "tap" }), null, "no resize");
});

test("the selected thing deleted: no selection, and a resize going on is cancelled", () => {
  const s = run([{ type: "tap", id: "pig" }]);
  assert.equal(nextSelection(s, { type: "things", ids: ["pig", "cow"] }), s, "still there");
  assert.equal(nextSelection(s, { type: "things", ids: ["cow"] }), NO_SELECTION);
  assert.equal(nextSelection(s, { type: "things" }), NO_SELECTION, "no things at all");
  assert.equal(nextSelection(NO_SELECTION, { type: "things", ids: [] }), NO_SELECTION);
  const r = run([down()], s);
  const e = { type: "things", ids: ["cow"] };
  const gone = nextSelection(r, e);
  assert.equal(gone, NO_SELECTION);
  assert.equal(resizeOutcome(r, gone, e), "cancel");
});

test("leaving edit mode drops the selection and cancels a resize", () => {
  const r = run([{ type: "tap", id: "pig" }, down()]);
  const e = { type: "leave" };
  assert.equal(nextSelection(r, e), NO_SELECTION);
  assert.equal(resizeOutcome(r, nextSelection(r, e), e), "cancel");
  assert.equal(nextSelection(sel("pig"), e), NO_SELECTION);
});

test("the resize is the finger's distance from the feet over the start's, clamped to the size limits", () => {
  const thing = { outline: [[0.4, 0.6], [0.52, 0.6], [0.52, 0.76], [0.4, 0.76]] }; // half of THING_BOX
  const size = thingSize(thing.outline);
  const g = resizeGesture("pig", thing, [500, 600], [500, 500]);
  assert.equal(g.d0, 100);
  assert.equal(g.s, 1);
  assert.equal(resizeGestureTo(g, [500, 450]).s, 1.5);
  assert.equal(resizeGestureTo(g, [560, 680]).s, 1, "distance, in any direction");
  assert.equal(g.s, 1, "the gesture is not mutated");
  const big = resizeGestureTo(g, [500, -5000]);
  assert.ok(Math.abs(big.s * size - THING_SCALE_MAX) < 1e-9, `never past the largest size: ${big.s * size}`);
  const small = resizeGestureTo(g, [500, 599]);
  assert.ok(Math.abs(small.s * size - THING_SCALE_MIN) < 1e-9, `never under the smallest: ${small.s * size}`);
  // A press right on the feet has no distance to measure from: the size stays.
  assert.equal(resizeGestureTo(resizeGesture("pig", thing, [500, 600], [500, 600]), [700, 900]).s, 1);
});
