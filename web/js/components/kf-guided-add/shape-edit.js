// Shape editing as a pure state machine (Draw step and thing card Redraw; playtest 2). No DOM.
// ShapeEditor (shape-editor.js) dispatches events here and renders from the state it gets back;
// the drawing itself (ShapeDrawing) holds the shapes and their undo history.
//
// States (mode):
//   idle       nothing selected; strokes draw new shapes, a tap on a shape selects it
//   selected   shape `index` is selected: its handle shows; drag it, resize it, draw it again, delete it
//   dragging   shape `index` is being moved, resized or pinched; `gesture` = {kind, t, lifted}
//   redrawing  the next stroke takes the place of shape `index` ("Draw it again")
// `warn` says why the last stroke was refused, until the next accepted change: null, "open" (an open
// first stroke), "apart" (a shape that touches no other shape) or "full" (no more shapes fit).
//
// Events:
//   {type: "tap", hit}                     a short tap on the pad; hit = shape index or -1
//   {type: "press", hit, onHandle, inSelection}  a finger down on the selection layer
//   {type: "pinch"}                         a second finger joined the drag
//   {type: "drag", t}                       the gesture's transform {dx, dy, k} so far
//   {type: "lift"}                          a pinch finger lifted: hold until every finger is up
//   {type: "release"}                       every finger up (the host commits gesture.t first)
//   {type: "toggleRedraw"}                  "Draw it again" (pressed again: keep the shape)
//   {type: "changed"}                       the drawing changed: a stroke, a join, delete, undo, start over
//   {type: "reject", reason}                a stroke ShapeDrawing.place refused ("open" | "apart" | "full";
//                                           "invalid" is a scribble too small to matter: no warning)
//   {type: "deselect"}
import { BOARD_ASPECT } from "../../geometry/stroke.js";

export const IDLE = "idle";
export const SELECTED = "selected";
export const DRAGGING = "dragging";
export const REDRAWING = "redrawing";

const NO_MOVE = Object.freeze({ dx: 0, dy: 0, k: 1 });

/** Refusals the parent is told about (shape-editor.js has the words). */
export const WARNINGS = Object.freeze(["open", "apart", "full"]);

/** @returns {{mode: string, index: number, warn: null | string, gesture: null | {kind: string, t: {dx: number, dy: number, k: number}, lifted: boolean}}} */
export function initialEdit() {
  return { mode: IDLE, index: -1, warn: null, gesture: null };
}

const idle = (s) => ({ ...s, mode: IDLE, index: -1, gesture: null });
const selected = (s, index) => ({ ...s, mode: SELECTED, index, gesture: null });
const dragging = (s, index, kind) => ({ ...s, mode: DRAGGING, index, gesture: { kind, t: NO_MOVE, lifted: false } });

export function editReducer(s, e) {
  switch (e.type) {
    case "tap":
      if (e.hit >= 0) return selected(s, e.hit);
      return s.mode === REDRAWING ? s : idle(s);
    case "press":
      if (s.mode !== SELECTED) return s;
      if (e.onHandle) return dragging(s, s.index, "resize");
      if (e.inSelection) return dragging(s, s.index, "move");
      if (e.hit >= 0) return dragging(s, e.hit, "move");
      return idle(s);
    case "pinch":
      return s.mode === DRAGGING ? { ...s, gesture: { ...s.gesture, kind: "pinch" } } : s;
    case "drag":
      if (s.mode !== DRAGGING || s.gesture.kind === "hold") return s;
      return { ...s, gesture: { ...s.gesture, t: e.t, lifted: true } };
    case "lift":
      return s.mode === DRAGGING ? { ...s, gesture: { ...s.gesture, kind: "hold" } } : s;
    case "release":
      return s.mode === DRAGGING ? selected(s, s.index) : s;
    case "toggleRedraw":
      if (s.mode === SELECTED) return { ...s, mode: REDRAWING, gesture: null };
      if (s.mode === REDRAWING) return selected(s, s.index);
      return s;
    case "changed":
      return { ...idle(s), warn: null };
    case "reject":
      return { ...s, warn: WARNINGS.includes(e.reason) ? e.reason : null };
    case "deselect":
      return idle(s);
    default:
      return s;
  }
}

/** True while a shape is picked (its handle and the Draw it again / Delete row show). */
export const isPicked = (s) => s.mode === SELECTED || s.mode === DRAGGING || s.mode === REDRAWING;

// ---------- gesture maths (board units) ----------

/** A move from `start` to `p`. */
export function moveBy(start, p) {
  return { dx: p[0] - start[0], dy: p[1] - start[1], k: 1 };
}

/** A resize about `center`: how much farther `p` is than `start`, measured as on screen. */
export function resizeBy(center, start, p) {
  const d = (q) => Math.hypot(q[0] - center[0], (q[1] - center[1]) / BOARD_ASPECT);
  return { dx: 0, dy: 0, k: d(p) / (d(start) || 1e-6) };
}

/** A pinch: the base transform, scaled by the finger spread and moved with the fingers' midpoint. */
export function pinchBy(base, mid0, mid, spread0, spread) {
  return { dx: base.dx + mid[0] - mid0[0], dy: base.dy + mid[1] - mid0[1], k: base.k * (spread / (spread0 || 1)) };
}
