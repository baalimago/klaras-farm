// Full-screen eye stamping for Klara (US-3.2): no controls she could hit, every tap stamps a button
// eye snapped inside the outline, a third tap moves the oldest eye. The parent takes over by holding
// the strip at the top for 1 s. Used by <kf-guided-add> (Eyes step) and <kf-thing-card> (Re-stamp eyes).
import { h } from "./dom.js";
import { ThingPreview, viewFor } from "./preview.js";
import { stampEye } from "./steps.js";
import { snapPoint } from "./geometry.js";

export class EyeStamper {
  /**
   * @param {{geo:any, thing:any, holdMs?:number, onStamp:(eyes:any[])=>void, onDone:()=>void, chime?:(kind:string)=>void}} opts
   */
  constructor({ geo, thing, holdMs = 1000, onStamp, onDone, chime }) {
    this.geo = geo;
    this.thing = { ...thing, eyes: [...(thing.eyes ?? [])] };
    this.holdMs = holdMs;
    this.onStamp = onStamp;
    this.onDone = onDone;
    this.chime = chime ?? (() => {});
    this._timer = 0;
  }

  mount(parent) {
    const canvas = h("canvas", { class: "kf-eyes-canvas", "aria-hidden": "true" });
    this.strip = h(
      "button",
      { class: "kf-eyes-strip", type: "button", "aria-label": "Grown-up: hold here for 1 second to continue" },
      h("span", { class: "kf-eyes-fill", "aria-hidden": "true" }),
      h("span", { class: "kf-eyes-label", text: "Grown-up: hold here to continue" }),
    );
    this.root = h("div", { class: "kf-eyes", "data-testid": "eye-stamping" }, h("div", { class: "kf-stage kf-eyes-stage" }, canvas), this.strip);
    parent.append(this.root);
    this.preview = new ThingPreview(canvas, this.geo);
    this.preview.setView(viewFor(this.thing.outline, { fill: 0.6, geo: this.geo }));
    this.root.addEventListener("pointerdown", (e) => this._tap(e));
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    const cancel = () => this._cancelHold();
    this.strip.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (!e.isPrimary) return;
      this._cancelHold();
      this.strip.classList.add("holding");
      this.strip.style.setProperty("--hold-ms", `${this.holdMs}ms`);
      this._timer = setTimeout(() => this._finish(), this.holdMs);
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) this.strip.addEventListener(ev, cancel);
    // Keyboard / VoiceOver activation (no pointer): a deliberate adult action, finish at once.
    this.strip.addEventListener("click", (e) => { if (e.detail === 0) this._finish(); });
    requestAnimationFrame(() => this.redraw());
    return this;
  }

  redraw() { return this.preview?.draw(this.thing); }

  /** Board point → client point, for tests and hints. */
  toClient(x, y) { return this.preview.toClient(x, y); }

  _tap(e) {
    if (!e.isPrimary || this.strip.contains(e.target)) return;
    e.preventDefault();
    const pt = this.preview.toBoard(e.clientX, e.clientY);
    const [x, y] = snapPoint(this.geo, pt, this.thing.outline);
    this.thing.eyes = stampEye(this.thing.eyes, { x, y });
    this.chime("tap");
    this.redraw();
    this.onStamp?.(this.thing.eyes);
  }

  _cancelHold() {
    clearTimeout(this._timer);
    this._timer = 0;
    this.strip?.classList.remove("holding");
  }

  _finish() {
    this._cancelHold();
    this.unmount();
    this.onDone?.(this.thing.eyes);
  }

  unmount() {
    this._cancelHold();
    this.root?.remove();
    this.root = null;
  }
}

/**
 * Lets the parent drag an eye on a preview canvas (US-3.2 "drag an eye afterwards").
 * @param {ThingPreview} preview
 * @param {() => any} getThing
 * @param {(eyes:any[]) => void} onMove   live, while dragging
 * @param {(eyes:any[]) => void} onEnd    once, on release
 */
export function attachEyeDrag(preview, geo, getThing, onMove, onEnd) {
  const canvas = preview.canvas;
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    const thing = getThing();
    if (!e.isPrimary || !thing?.eyes?.length) return;
    const [bx, by] = preview.toBoard(e.clientX, e.clientY);
    const r = preview.eyeRadius(thing) * 2.2;
    const i = thing.eyes.findIndex((eye) => Math.hypot(eye.x - bx, (eye.y - by) * 0.75) <= r);
    if (i < 0) return;
    drag = { i, eyes: thing.eyes.map((x) => ({ ...x })) };
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const thing = getThing();
    const [x, y] = snapPoint(geo, preview.toBoard(e.clientX, e.clientY), thing.outline);
    drag.eyes[drag.i] = { x, y };
    onMove(drag.eyes.map((x) => ({ ...x })));
  });
  const end = () => {
    if (!drag) return;
    const eyes = drag.eyes;
    drag = null;
    onEnd(eyes);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}
