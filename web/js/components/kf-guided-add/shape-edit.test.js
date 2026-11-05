import { test } from "node:test";
import assert from "node:assert/strict";
import { initialEdit, editReducer, isPicked, IDLE, SELECTED, DRAGGING, REDRAWING, moveBy, resizeBy, pinchBy } from "./shape-edit.js";

const run = (events, s = initialEdit()) => events.reduce(editReducer, s);

test("idle: a tap on a shape selects it, a tap on nothing stays idle", () => {
  assert.deepEqual(run([{ type: "tap", hit: -1 }]), initialEdit());
  const s = run([{ type: "tap", hit: 2 }]);
  assert.equal(s.mode, SELECTED);
  assert.equal(s.index, 2);
  assert.equal(isPicked(s), true);
  assert.equal(isPicked(initialEdit()), false);
  assert.equal(run([{ type: "tap", hit: 2 }, { type: "tap", hit: -1 }]).mode, IDLE, "tap on nothing deselects");
  assert.equal(run([{ type: "tap", hit: 2 }, { type: "tap", hit: 0 }]).index, 0, "tap another shape: it is selected");
});

test("selected: press on the shape drags it; on the handle resizes; on another shape drags that one; elsewhere deselects", () => {
  const sel = run([{ type: "tap", hit: 1 }]);
  const move = editReducer(sel, { type: "press", hit: -1, inSelection: true });
  assert.equal(move.mode, DRAGGING);
  assert.deepEqual(move.gesture, { kind: "move", t: { dx: 0, dy: 0, k: 1 }, lifted: false });
  assert.equal(editReducer(sel, { type: "press", onHandle: true }).gesture.kind, "resize");
  // the handle sits inside the selection box, so a real press on it carries both flags
  const both = editReducer(sel, { type: "press", hit: 1, onHandle: true, inSelection: true });
  assert.equal(both.mode, DRAGGING);
  assert.equal(both.gesture.kind, "resize", "the handle wins over the box");
  const other = editReducer(sel, { type: "press", hit: 0, inSelection: false });
  assert.equal(other.index, 0);
  assert.equal(other.gesture.kind, "move");
  assert.equal(editReducer(sel, { type: "press", hit: -1, inSelection: false }).mode, IDLE);
  assert.deepEqual(editReducer(initialEdit(), { type: "press", hit: 0 }), initialEdit(), "press means nothing unless selected");
});

test("dragging: drags lift the shape, release goes back to selected; pinch and lift", () => {
  let s = run([{ type: "tap", hit: 0 }, { type: "press", inSelection: true }]);
  s = editReducer(s, { type: "drag", t: { dx: 0.1, dy: 0, k: 1 } });
  assert.deepEqual(s.gesture, { kind: "move", t: { dx: 0.1, dy: 0, k: 1 }, lifted: true });
  s = editReducer(s, { type: "pinch" });
  assert.equal(s.gesture.kind, "pinch");
  s = editReducer(s, { type: "lift" });
  assert.equal(s.gesture.kind, "hold");
  assert.equal(editReducer(s, { type: "drag", t: { dx: 9, dy: 9, k: 9 } }), s, "a held gesture ignores drags");
  s = editReducer(s, { type: "release" });
  assert.equal(s.mode, SELECTED);
  assert.equal(s.gesture, null);
  // these mean nothing outside a drag
  for (const type of ["pinch", "drag", "lift", "release"]) assert.deepEqual(editReducer(initialEdit(), { type, t: {} }), initialEdit(), type);
});

test("draw it again: toggles between selected and redrawing; a tap on nothing keeps redrawing", () => {
  const sel = run([{ type: "tap", hit: 1 }]);
  const r = editReducer(sel, { type: "toggleRedraw" });
  assert.equal(r.mode, REDRAWING);
  assert.equal(r.index, 1);
  assert.equal(isPicked(r), true);
  assert.equal(editReducer(r, { type: "tap", hit: -1 }), r);
  assert.equal(editReducer(r, { type: "tap", hit: 0 }).mode, SELECTED, "changing your mind: pick another shape");
  assert.deepEqual(editReducer(r, { type: "toggleRedraw" }), sel, "pressed again: keep the shape");
  assert.deepEqual(editReducer(initialEdit(), { type: "toggleRedraw" }), initialEdit());
});

test("a change of the drawing ends any selection and clears the warning; a refused stroke warns why", () => {
  const warned = run([{ type: "tap", hit: 1 }, { type: "reject", reason: "open" }]);
  assert.equal(warned.warn, "open");
  assert.equal(editReducer(warned, { type: "reject", reason: "apart" }).warn, "apart", "the latest reason shows");
  assert.equal(editReducer(warned, { type: "reject", reason: "full" }).warn, "full");
  assert.equal(editReducer(warned, { type: "reject", reason: "invalid" }).warn, null, "a speck is not worth a warning");
  assert.equal(warned.mode, SELECTED, "the selection stays");
  assert.deepEqual(editReducer(warned, { type: "changed" }), initialEdit());
  assert.equal(editReducer(warned, { type: "deselect" }).mode, IDLE);
  assert.equal(editReducer(warned, { type: "nonsense" }), warned);
});

test("gesture maths: move, resize measured on screen, pinch", () => {
  assert.deepEqual(moveBy([0.25, 0.5], [0.5, 0.25]), { dx: 0.25, dy: -0.25, k: 1 });
  assert.equal(resizeBy([0.5, 0.5], [0.6, 0.5], [0.7, 0.5]).k, 2);
  // y is 3/4 of x on screen: going 4/3 as far in y is the same on-screen distance
  assert.ok(Math.abs(resizeBy([0.5, 0.5], [0.6, 0.5], [0.5, 0.5 + 0.1 * (4 / 3)]).k - 1) < 1e-9);
  assert.ok(Number.isFinite(resizeBy([0.5, 0.5], [0.5, 0.5], [0.6, 0.5]).k));
  const p = pinchBy({ dx: 0.1, dy: 0, k: 1.5 }, [0.5, 0.5], [0.55, 0.45], 100, 200);
  assert.ok(Math.abs(p.dx - 0.15) < 1e-9 && Math.abs(p.dy + 0.05) < 1e-9 && p.k === 3);
  assert.equal(pinchBy({ dx: 0, dy: 0, k: 1 }, [0, 0], [0, 0], 0, 50).k, 50);
});
