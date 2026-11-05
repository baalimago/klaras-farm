// ShapeEditor: edit the shapes of a drawing one by one (Draw step and thing card Redraw; playtest 2).
// Every shape stays visible as its own dashed stitch over the merged felt. Tap a shape to select it;
// a selected shape can be dragged to move it, resized with the round corner handle (or a pinch),
// drawn again (the next stroke takes its place) or deleted. Undo takes back the last change of any
// kind; Start over clears the drawing (undoable too). A stroke drawn over the body joins it, open or
// closed (ShapeDrawing.place); a refused stroke says why in `warn` (WARN_TEXT).
//
// State: the editing mode is the pure state machine in shape-edit.js (`this.state`); the shapes and
// their history are the ShapeDrawing. Every event dispatches, and `render()` then draws buttons,
// handle, layer and outlines from that state, synchronously. Pointer bookkeeping (start points, the
// board rect at gesture start) is the only other thing kept here.
//
// No lag: the heavy union runs only when a change is committed (stroke end, drag end). While a shape
// is dragged the host paints the union of the OTHER shapes once (cached), and this module repaints a
// light overlay canvas per animation frame with the moving shape filled flat.
//
// DOM: a layer inside the <kf-draw-pad> (so it sits exactly over the pad) holds the outline canvas and
// the resize handle. With nothing selected the layer lets every touch through to the pad (drawing; a
// short tap selects through the pad's `kf-tap`); with a shape selected the layer takes the touches,
// and a gesture is followed on the window so it keeps going over a panel.
import { h } from "./dom.js";
import { hex, INK } from "../../farm/palette.js";
import { BOARD_ASPECT, bbox, fitRect, toBoard, fromBoard } from "../../geometry/stroke.js";
import { transformPoints, clampScale } from "./drawing.js";
import { initialEdit, editReducer, isPicked, SELECTED, DRAGGING, REDRAWING, moveBy, resizeBy, pinchBy } from "./shape-edit.js";

const HIGHLIGHT = "#ff8a5b";
const PALM_PX = 140;
const HANDLE_PX = 56; // parent target ≥ 44 px
const GRAB_PX = 28; // a selected shape can be grabbed this far outside its box
const TAP_PX = 22; // a tap this close to a shape's edge selects it
const LIFT_PX = 4; // movement before a drag starts (a tap is not a drag)

/** What a refused stroke tells the parent (shape-edit.js `warn`). */
export const WARN_TEXT = Object.freeze({
  open: "Close the outline: end where you started. Draw it again.",
  apart: "Draw it touching the body, so they join.",
  full: "That's the most shapes. Tap one to change it, or Undo.",
});

export class ShapeEditor {
  /**
   * @param {{drawing: import('./drawing.js').ShapeDrawing, pad: HTMLElement, color?: string,
   *   paint: (outline: import('../../types.js').Point[]) => void, onChange: () => void, onRender?: () => void}} opts
   *   paint: repaint the felt preview with this outline; onChange: the drawing changed (committed);
   *   onRender: called at the end of every render, so the host renders its notes from the same state.
   */
  constructor({ drawing, pad, color, paint, onChange, onRender = () => {} }) {
    this.drawing = drawing;
    this.pad = pad;
    this.color = color;
    this.paint = paint;
    this.onChange = onChange;
    this.onRender = onRender;
    this.state = initialEdit();
    this._pointers = new Map();
    this._grip = null; // pointer bookkeeping of the current gesture
    this._frame = 0;
    this._corner = 0;

    this.canvas = h("canvas", { class: "kf-se-outlines", "aria-hidden": "true" });
    this.handle = h("button", { class: "kf-se-handle", type: "button", "aria-label": "Make it bigger or smaller", "data-action": "resize-shape", hidden: true });
    this.layer = h("div", { class: "kf-se-layer" }, this.canvas, this.handle);
    this.warn = h("p", { class: "kf-warning", role: "status", hidden: true });
    this.undoBtn = h("button", { class: "kf-btn", type: "button", text: "Undo", "data-action": "undo-shape", onclick: () => this._commit(this.drawing.undo()) });
    this.restartBtn = h("button", { class: "kf-btn", type: "button", text: "Start over", "data-action": "start-over", onclick: () => this._commit(this.drawing.clear()) });
    this.redrawBtn = h("button", { class: "kf-btn", type: "button", text: "Draw it again", "data-action": "redraw-shape", onclick: () => this.dispatch({ type: "toggleRedraw" }) });
    this.deleteBtn = h("button", { class: "kf-btn danger", type: "button", text: "Delete shape", "data-action": "delete-shape", onclick: () => this._commit(this.drawing.remove(this.state.index)) });
    this.selectionRow = h("div", { class: "kf-row kf-se-selection", role: "group", "aria-label": "Selected shape", hidden: true }, this.redrawBtn, this.deleteBtn);

    this._onStroke = (e) => this._stroke(e.detail?.points);
    this._onOpen = (e) => this._open(e.detail?.points);
    this._onTap = (e) => this._tap(e.detail?.point);
    this._onDown = (e) => this._down(e);
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
  }

  /** Puts the layer in the pad and listens. Returns this. */
  mount() {
    this.pad.append(this.layer);
    this.pad.addEventListener("kf-stroke", this._onStroke);
    this.pad.addEventListener("kf-stroke-open", this._onOpen);
    this.pad.addEventListener("kf-tap", this._onTap);
    this.layer.addEventListener("pointerdown", this._onDown);
    this.layer.addEventListener("contextmenu", (e) => e.preventDefault());
    if (typeof ResizeObserver === "function") {
      this._ro = new ResizeObserver(() => this.render());
      this._ro.observe(this.pad);
    }
    this.render();
    return this;
  }

  /** Stops listening (the host removes the DOM). */
  detach() {
    this._ro?.disconnect();
    this._listen(false);
    this._pointers.clear();
    cancelAnimationFrame(this._frame);
    this.pad.removeEventListener("kf-stroke", this._onStroke);
    this.pad.removeEventListener("kf-stroke-open", this._onOpen);
    this.pad.removeEventListener("kf-tap", this._onTap);
  }

  /** The selected shape's index, or -1. */
  get selected() { return this.state.mode === SELECTED || this.state.mode === DRAGGING ? this.state.index : -1; }

  /** A note for the current editing state, or null when the host's own note fits. */
  noteText() {
    if (this.state.mode === REDRAWING) return "Draw the new shape. It takes the place of the orange one.";
    if (isPicked(this.state)) return "Drag the shape to move it. Pull the round handle to make it bigger or smaller. Tap outside to finish.";
    return null;
  }

  /** Runs an event through the state machine and renders the result. */
  dispatch(event) {
    this.state = editReducer(this.state, event);
    this.render();
  }

  /** A drawing change was made (or refused): tell the host, then render. */
  _commit(ok) {
    if (!ok) return false;
    this.state = editReducer(this.state, { type: "changed" });
    this.onChange();
    this.render();
    return true;
  }

  // ---------- pad events ----------

  _stroke(points) {
    if (!Array.isArray(points) || points.length < 3) return;
    this._place(points, true);
  }

  _open(points) {
    if (!Array.isArray(points)) return this.dispatch({ type: "reject", reason: "open" });
    if (this._place(points, false)) this.pad.clear?.(); // the pad still shows the open stroke's ends
  }

  /** A stroke goes to the drawing (in place of the orange shape while redrawing); a refusal warns why. */
  _place(points, closed) {
    const replace = this.state.mode === REDRAWING ? this.state.index : -1;
    const r = this.drawing.place(points, { closed, replace });
    if (r.ok) return this._commit(true);
    this.dispatch({ type: "reject", reason: r.reason });
    return false;
  }

  _tap(point) {
    if (!Array.isArray(point)) return;
    this.dispatch({ type: "tap", hit: this.drawing.hit(point, TAP_PX / this._rect().width) });
  }

  // ---------- coordinates ----------

  _rect() {
    if (typeof this.pad.boardRect === "function") return this.pad.boardRect();
    const r = this.pad.getBoundingClientRect();
    return fitRect(r.width, r.height, BOARD_ASPECT, r.left, r.top);
  }

  /** Inside the selected shape's box, grown by GRAB_PX: a big target. */
  _inSelection(pt, rect) {
    const s = this.drawing.shapes[this.selected];
    if (!s) return false;
    const b = bbox(s), gx = GRAB_PX / rect.width, gy = GRAB_PX / rect.height;
    return pt[0] >= b.x - gx && pt[0] <= b.x + b.w + gx && pt[1] >= b.y - gy && pt[1] <= b.y + b.h + gy;
  }

  // ---------- gestures on the selected shape ----------

  _listen(on) {
    const fn = on ? window.addEventListener : window.removeEventListener;
    fn.call(window, "pointermove", this._onMove, true);
    fn.call(window, "pointerup", this._onUp, true);
    fn.call(window, "pointercancel", this._onUp, true);
  }

  _down(e) {
    e.stopPropagation();
    if (e.pointerType === "touch" && e.width > PALM_PX && e.height > PALM_PX) return;
    if (!this._pointers.size && !e.isPrimary) return;
    e.preventDefault();
    if (!this._pointers.size) this._listen(true);
    this._pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const rect = this._rect();
    if (this._pointers.size === 1) {
      const pt = toBoard(e.clientX, e.clientY, rect);
      this.dispatch({ type: "press", onHandle: e.target === this.handle, inSelection: this._inSelection(pt, rect), hit: this.drawing.hit(pt, TAP_PX / rect.width) });
      if (this.state.mode !== DRAGGING) return;
      const b = bbox(this.drawing.shapes[this.state.index]);
      this._grip = { start: pt, rect, center: [b.x + b.w / 2, b.y + b.h / 2], client: [e.clientX, e.clientY] };
      return;
    }
    if (this._pointers.size === 2 && this.state.mode === DRAGGING && this._grip) {
      const [a, b] = [...this._pointers.values()];
      Object.assign(this._grip, { base: this.state.gesture.t, spread: Math.hypot(b[0] - a[0], b[1] - a[1]), mid: toBoard((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, rect) });
      this.dispatch({ type: "pinch" });
    }
  }

  _move(e) {
    if (!this._pointers.has(e.pointerId)) return;
    e.stopPropagation();
    this._pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const s = this.state, g = this._grip;
    const shape = this.drawing.shapes[s.index];
    if (s.mode !== DRAGGING || !g || !shape) return;
    const p = toBoard(e.clientX, e.clientY, g.rect);
    let t;
    if (s.gesture.kind === "move") t = moveBy(g.start, p);
    else if (s.gesture.kind === "resize") t = resizeBy(g.center, g.start, p);
    else if (s.gesture.kind === "pinch" && this._pointers.size >= 2) {
      const [a, b] = [...this._pointers.values()];
      t = pinchBy(g.base, g.mid, toBoard((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, g.rect), g.spread, Math.hypot(b[0] - a[0], b[1] - a[1]));
    } else return;
    if (!s.gesture.lifted) {
      if (s.gesture.kind !== "pinch" && Math.hypot(e.clientX - g.client[0], e.clientY - g.client[1]) < LIFT_PX) return;
      // the felt without this shape, once (cached); the moving shape is painted on the overlay
      this.paint(this.drawing.mergedWithout(s.index));
    }
    // the state changes now; the overlay catches up on the next frame (cheap: a few polylines)
    this.state = editReducer(s, { type: "drag", t: { ...t, k: clampScale(shape, t.k) } });
    this._frame ||= requestAnimationFrame(() => { this._frame = 0; this.render(); });
  }

  _up(e) {
    if (!this._pointers.delete(e.pointerId)) return;
    e.stopPropagation();
    const s = this.state;
    if (s.mode === DRAGGING && s.gesture.kind === "pinch" && this._pointers.size) return this.dispatch({ type: "lift" });
    if (this._pointers.size) return;
    this._listen(false);
    this._grip = null;
    cancelAnimationFrame(this._frame);
    this._frame = 0;
    if (s.mode !== DRAGGING) return;
    const moved = s.gesture.lifted && this.drawing.transform(s.index, s.gesture.t);
    this.state = editReducer(s, { type: "release" });
    if (moved) this.onChange();
    else if (s.gesture.lifted) this.paint(this.drawing.merged);
    this.render();
  }

  // ---------- rendering ----------

  /** Renders everything from the state: buttons, routing, outlines and the handle. */
  render() {
    const s = this.state, d = this.drawing;
    this.undoBtn.disabled = !d.canUndo;
    this.restartBtn.disabled = !d.count;
    this.selectionRow.hidden = !isPicked(s);
    this.redrawBtn.setAttribute("aria-pressed", String(s.mode === REDRAWING));
    this.warn.hidden = !s.warn;
    this.warn.textContent = s.warn ? WARN_TEXT[s.warn] : "";
    this.layer.dataset.mode = s.mode;
    this.layer.style.pointerEvents = s.mode === SELECTED || s.mode === DRAGGING ? "auto" : "none";
    this._paintOutlines();
    this.onRender();
  }

  /** Each shape's stitch (cheap: up to six polylines), the picked shape highlighted, and the handle. */
  _paintOutlines() {
    const c = this.canvas;
    const box = this.pad.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(box.width * dpr)), H = Math.max(1, Math.round(box.height * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr, 0, 0, dpr, -box.left * dpr, -box.top * dpr);
    ctx.lineCap = ctx.lineJoin = "round";
    const rect = this._rect();
    const s = this.state;
    const path = (poly) => {
      ctx.beginPath();
      poly.forEach(([x, y], i) => {
        const [cx, cy] = fromBoard(x, y, rect);
        if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy);
      });
      ctx.closePath();
    };
    const picked = isPicked(s) ? s.index : -1;
    this.drawing.shapes.forEach((shape, i) => {
      if (i === picked) return;
      path(shape);
      ctx.setLineDash([7, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(74,51,38,0.55)";
      ctx.stroke();
    });
    const shape = this.drawing.shapes[picked];
    this.handle.hidden = true;
    if (!shape) return ctx.setLineDash([]);
    if (s.mode === REDRAWING) {
      path(shape);
      ctx.setLineDash([2, 9]);
      ctx.lineWidth = 5;
      ctx.strokeStyle = HIGHLIGHT;
      ctx.stroke();
      return ctx.setLineDash([]);
    }
    const lifted = s.mode === DRAGGING && s.gesture.lifted;
    const moving = lifted ? transformPoints(shape, s.gesture.t) : shape;
    path(moving);
    if (lifted) {
      ctx.fillStyle = this.color ? hex(this.color) : "rgba(255,255,255,0.7)";
      ctx.fill();
    }
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = HIGHLIGHT;
    ctx.stroke();
    const b = bbox(moving);
    const [x0, y0] = fromBoard(b.x, b.y, rect), [x1, y1] = fromBoard(b.x + b.w, b.y + b.h, rect);
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.strokeRect(x0 - 8, y0 - 8, x1 - x0 + 16, y1 - y0 + 16);
    ctx.setLineDash([]);
    this._placeHandle(box, [x0 - 8, y0 - 8, x1 + 8, y1 + 8], !lifted);
  }

  /**
   * Puts the handle on a corner of the selection box, kept inside the pad. The bottom-right corner
   * first; when a panel covers it, the next free corner. The corner is chosen only when `choose`
   * (not during a drag), so drag frames do no hit testing.
   */
  _placeHandle(box, [x0, y0, x1, y1], choose) {
    const at = (corner) => {
      const cx = corner === 1 || corner === 3 ? x0 : x1, cy = corner >= 2 ? y0 : y1;
      return [
        Math.max(0, Math.min(box.width - HANDLE_PX, cx - box.left - HANDLE_PX / 2)),
        Math.max(0, Math.min(box.height - HANDLE_PX, cy - box.top - HANDLE_PX / 2)),
      ];
    };
    const put = ([left, top]) => {
      this.handle.style.left = `${left}px`;
      this.handle.style.top = `${top}px`;
    };
    this.handle.hidden = false;
    if (choose) {
      this._corner = 0;
      for (const corner of [0, 1, 2, 3]) {
        const [left, top] = at(corner);
        put([left, top]);
        const hit = document.elementFromPoint(box.left + left + HANDLE_PX / 2, box.top + top + HANDLE_PX / 2);
        if (!hit || hit === this.handle) { this._corner = corner; break; }
      }
    }
    put(at(this._corner));
    this.handle.dataset.corner = String(this._corner); // the glyph points out of its corner
  }
}
