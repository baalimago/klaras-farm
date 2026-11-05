// Full-screen eye stamping for Klara (US-3.2): every tap on the stage stamps a button eye snapped
// inside the outline, a third tap moves the oldest eye. The grown-up's way out is always on screen
// (playtest 2: the old screen read as a dead end): a bar at the top says what to do, with Done and
// Cancel buttons (56 px) that each need a 1 s hold, so Klara's taps never leave by accident. A quick
// tap on them says "keep holding" instead of doing nothing. Used by <kf-guided-add> (Eyes step) and
// <kf-thing-card> (Re-stamp eyes).
import { h } from "./dom.js";
import { ThingPreview, viewFor } from "./preview.js";
import { stampEye } from "./steps.js";
import { snapPoint } from "./geometry.js";

const LABEL = "Grown-up: hold Done or Cancel for 1 second. Done keeps the eyes, Cancel goes back.";
const HINT = "Keep holding for 1 second";
const HINT_MS = 2500;

export class EyeStamper {
  /**
   * @param {{geo:any, thing:any, holdMs?:number, onStamp?:(eyes:any[])=>void, onDone?:(eyes:any[])=>void,
   *   onCancel?:(eyes:any[])=>void, chime?:(kind:string)=>void}} opts
   *   onDone gets the stamped eyes; onCancel gets the eyes from before (default: onDone with them).
   */
  constructor({ geo, thing, holdMs = 1000, onStamp, onDone, onCancel, chime }) {
    this.geo = geo;
    this.before = (thing.eyes ?? []).map((e) => ({ ...e }));
    this.thing = { ...thing, eyes: [...(thing.eyes ?? [])] };
    this.holdMs = holdMs;
    this.onStamp = onStamp;
    this.onDone = onDone;
    this.onCancel = onCancel ?? ((eyes) => onDone?.(eyes));
    this.chime = chime ?? (() => {});
    this._timer = 0;
    this._hintTimer = 0;
    this._bar = { holding: null, hint: false };
  }

  mount(parent) {
    const canvas = h("canvas", { class: "kf-eyes-canvas", "aria-hidden": "true" });
    this.label = h("p", { class: "kf-eyes-label", role: "status", "aria-live": "polite", text: LABEL });
    const cancel = this._holdButton("Cancel", "eyes-cancel", () => this._finish(false));
    const done = this._holdButton("Done", "eyes-done", () => this._finish(true));
    this.bar = h("div", { class: "kf-eyes-bar", role: "group", "aria-label": "For the grown-up" }, this.label, h("div", { class: "kf-eyes-buttons" }, cancel, done));
    this.root = h("div", { class: "kf-eyes", "data-testid": "eye-stamping" }, h("div", { class: "kf-stage kf-eyes-stage" }, canvas), this.bar);
    parent.append(this.root);
    this.preview = new ThingPreview(canvas, this.geo);
    this.preview.setView(viewFor(this.thing.outline, { fill: 0.6, geo: this.geo }));
    this.root.addEventListener("pointerdown", (e) => this._guard(() => this._tap(e)));
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    requestAnimationFrame(() => this.redraw());
    return this;
  }

  /** A button that acts after a 1 s hold (or at once from a keyboard / VoiceOver). */
  _holdButton(text, action, act) {
    const b = h(
      "button",
      { class: `kf-btn kf-eyes-hold${action === "eyes-done" ? " primary" : ""}`, type: "button", "data-action": action, "aria-label": `${text} (hold for 1 second)` },
      h("span", { class: "kf-eyes-fill", "aria-hidden": "true" }),
      h("span", { class: "kf-eyes-text", text }),
    );
    b.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (!e.isPrimary) return;
      e.preventDefault(); // no iOS callout or text selection, which would cancel the hold
      this._guard(() => b.setPointerCapture?.(e.pointerId));
      this._startHold(b, act);
    });
    const early = () => { if (this._bar.holding === action) this._shortPress(); };
    b.addEventListener("pointerup", early);
    b.addEventListener("pointercancel", early);
    b.addEventListener("click", (e) => { if (e.detail === 0) act(); });
    return b;
  }

  redraw() { return this.preview?.draw(this.thing); }

  /** Board point → client point, for tests and hints. */
  toClient(x, y) { return this.preview.toClient(x, y); }

  _guard(fn) {
    try {
      fn();
    } catch (err) {
      console.warn("eye stamping:", err);
    }
  }

  _tap(e) {
    if (!e.isPrimary || this.bar.contains(e.target) || !this.thing.outline?.length) return;
    e.preventDefault();
    const pt = this.preview.toBoard(e.clientX, e.clientY);
    const [x, y] = snapPoint(this.geo, pt, this.thing.outline);
    this.thing.eyes = stampEye(this.thing.eyes, { x, y });
    this.chime("tap");
    this.redraw();
    this.onStamp?.(this.thing.eyes);
  }

  // The bar's state: which button is held (null for none) and whether the "keep holding" hint
  // shows. Every change goes through _setBar, which renders the bar from it.
  _setBar(patch) {
    this._bar = { ...this._bar, ...patch };
    if (!this.label) return;
    const { holding, hint } = this._bar;
    this.label.textContent = hint ? HINT : LABEL;
    this.label.classList.toggle("hint", hint);
    for (const btn of this.bar.querySelectorAll(".kf-eyes-hold")) btn.classList.toggle("holding", btn.dataset.action === holding);
  }

  _startHold(button, act) {
    clearTimeout(this._timer);
    button.style.setProperty("--hold-ms", `${this.holdMs}ms`);
    this._setBar({ holding: button.dataset.action });
    this._timer = setTimeout(act, this.holdMs);
  }

  /** Let go too soon: nothing happens, but the grown-up is told what to do. */
  _shortPress() {
    this._cancelHold();
    this._setBar({ hint: true });
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this._setBar({ hint: false }), HINT_MS);
  }

  _cancelHold() {
    clearTimeout(this._timer);
    this._timer = 0;
    this._setBar({ holding: null });
  }

  _finish(keep) {
    if (!this.root) return;
    this.unmount();
    if (keep) this.onDone?.(this.thing.eyes);
    else this.onCancel(this.before.map((e) => ({ ...e })));
  }

  unmount() {
    this._cancelHold();
    clearTimeout(this._hintTimer);
    this.root?.remove();
    this.root = null;
  }
}

/**
 * Lets the parent drag an eye on a preview canvas (US-3.2 "drag an eye afterwards") and, with `onTap`,
 * put one on with a tap anywhere else (playtest 3: the Eyes step must never wait on something only
 * Klara's stamping screen can do). Taps snap inside the outline.
 * @param {ThingPreview} preview
 * @param {() => any} getThing
 * @param {(eyes:any[]) => void} onMove   live, while dragging
 * @param {(eyes:any[]) => void} onEnd    once, on release (a drag, or a tap that stamped)
 * @param {{stamp?: boolean}} [opts]  stamp: a tap off every eye stamps one (stampEye)
 * @returns {() => void} detach
 */
export function attachEyeDrag(preview, geo, getThing, onMove, onEnd, { stamp = false } = {}) {
  const canvas = preview.canvas;
  let drag = null;
  const down = (e) => {
    const thing = getThing();
    if (!e.isPrimary || !thing?.outline?.length) return;
    const [bx, by] = preview.toBoard(e.clientX, e.clientY);
    const r = preview.eyeRadius(thing) * 2.2;
    const eyes = thing.eyes ?? [];
    const i = eyes.findIndex((eye) => Math.hypot(eye.x - bx, (eye.y - by) * 0.75) <= r);
    if (i < 0) {
      if (!stamp) return;
      e.preventDefault();
      const [x, y] = snapPoint(geo, [bx, by], thing.outline);
      onEnd(stampEye(eyes.map((x) => ({ ...x })), { x, y }));
      return;
    }
    drag = { i, eyes: eyes.map((x) => ({ ...x })) };
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* capture is a nicety */ }
    e.preventDefault();
  };
  const move = (e) => {
    if (!drag) return;
    const thing = getThing();
    const [x, y] = snapPoint(geo, preview.toBoard(e.clientX, e.clientY), thing.outline);
    drag.eyes[drag.i] = { x, y };
    onMove(drag.eyes.map((x) => ({ ...x })));
  };
  const end = () => {
    if (!drag) return;
    const eyes = drag.eyes;
    drag = null;
    onEnd(eyes);
  };
  const handlers = { pointerdown: down, pointermove: move, pointerup: end, pointercancel: end };
  for (const [type, fn] of Object.entries(handlers)) canvas.addEventListener(type, fn);
  return () => { for (const [type, fn] of Object.entries(handlers)) canvas.removeEventListener(type, fn); };
}
