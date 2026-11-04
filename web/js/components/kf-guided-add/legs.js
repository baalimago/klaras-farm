// Leg placing for the parent (US-3.10, playtest 2): choose how many legs, then tap where each goes,
// or Spread evenly and drag to adjust. Used by <kf-guided-add> (Legs step) and <kf-thing-card>
// (Place legs). The flow is the pure state machine in edit/leg-flow.js; this class only turns
// pointer events into its events and renders the whole panel and the preview from its state after
// every event, so the screen can never disagree with the data.
import { h } from "./dom.js";
import { snapPoint } from "./geometry.js";
import {
  legFlow, legPhase, legView, chooseCount, pressLeg, moveLeg, releaseLeg, cancelPress, spreadEvenly, spreadRest, clearLegs, undoLeg,
} from "../../edit/leg-flow.js";

/** A press turns into a drag only after the finger travels this far (CSS px), so taps stay taps. */
const DRAG_SLOP_PX = 6;

export class LegPlacer {
  /**
   * @param {{preview: import('./preview.js').ThingPreview, geo: any, thing: any, target?: number|null,
   *   drawOpts?: Object, onChange?: (state: {target: number|null, legs: any[]}) => void,
   *   buttons?: (phase: string, state: any) => (Node|null)[], chime?: (kind: string) => void}} opts
   */
  constructor({ preview, geo, thing, target, drawOpts = {}, onChange, buttons, chime }) {
    this.preview = preview;
    this.geo = geo;
    this.thing = thing;
    this.state = legFlow(thing.legs ?? [], target ?? null);
    this.drawOpts = drawOpts;
    this.onChange = onChange ?? (() => {});
    this.buttons = buttons ?? (() => []);
    this.chime = chime ?? (() => {});
    this.root = h("div", { class: "kf-legs", "data-testid": "leg-placing" });
    this._down = null; // {x, y, id}: where the current press started (client px)
    this._viewKey = "";
    const c = preview.canvas;
    this._handlers = {
      pointerdown: (e) => this._guard(() => this._press(e)),
      pointermove: (e) => this._guard(() => this._move(e)),
      pointerup: (e) => this._guard(() => this._release(e)),
      pointercancel: () => this._guard(() => this._cancel()),
    };
    for (const [type, fn] of Object.entries(this._handlers)) c.addEventListener(type, fn);
    c.classList.add("kf-legs-target");
  }

  get legs() { return this.state.legs; }
  get target() { return this.state.target; }
  get phase() { return legPhase(this.state); }

  /** The panel element, rendered from the current state. */
  panel() {
    this._render(true);
    return this.root;
  }

  detach() {
    const c = this.preview.canvas;
    for (const [type, fn] of Object.entries(this._handlers)) c.removeEventListener(type, fn);
    c.classList.remove("kf-legs-target");
  }

  redraw() {
    const markCount = Math.max(this.state.target ?? 0, this.state.legs.length);
    return this.preview.draw({ ...this.thing, legs: this.state.legs }, { ...this.drawOpts, markLegs: this.phase !== "choose-count", markCount });
  }

  /** Keeps the placed legs and adds the missing ones (the host's "Spread the rest and continue"). */
  spreadRest() {
    this._set(spreadRest(this.state, this.thing.outline));
    return this.state;
  }

  // ---------- state ----------

  /** The one way the state changes: then the panel and preview follow, and the owner hears of it. */
  _set(state) {
    if (state === this.state) return;
    const before = this.state;
    this.state = state;
    this.thing = { ...this.thing, legs: state.legs };
    this._render();
    this.redraw();
    // Tell the owner once per finished change: not on every drag move, but when the drag ends.
    const changed = before.legs !== state.legs || before.target !== state.target || (before.drag && !state.drag);
    if (changed && !state.drag) this.onChange({ target: state.target, legs: state.legs });
  }

  // ---------- pointer ----------

  /** One failing step must never eat the parent's tap (AGENTS.md rule 5). */
  _guard(fn) {
    try {
      fn();
    } catch (err) {
      console.warn("leg placing:", err);
    }
  }

  _snapped(e) {
    const pt = this.preview.toBoard(e.clientX, e.clientY);
    const snapped = this.thing.outline?.length ? snapPoint(this.geo, pt, this.thing.outline) : pt;
    return { pt, snapped };
  }

  _press(e) {
    if (!e.isPrimary || this.phase === "choose-count" || !this.thing.outline?.length) return;
    e.preventDefault();
    const { pt, snapped } = this._snapped(e);
    const r = pressLeg(this.state, pt, snapped, this.preview.legRadius(this.thing));
    if (r.action === "none") return;
    this._down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { this.preview.canvas.setPointerCapture?.(e.pointerId); } catch { /* capture is a nicety */ }
    if (r.action === "placed") this.chime("tap");
    this._set(r.state);
  }

  _move(e) {
    const d = this._down;
    if (!d || e.pointerId !== d.id || !this.state.drag) return;
    if (!this.state.drag.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_SLOP_PX) return;
    this._set(moveLeg(this.state, this._snapped(e).snapped));
  }

  _release(e) {
    const d = this._down;
    if (!d || e.pointerId !== d.id) return;
    this._down = null;
    const r = releaseLeg(this.state, this._snapped(e).snapped);
    if (r.action === "placed") this.chime("tap");
    this._set(r.state);
  }

  _cancel() {
    this._down = null;
    this._set(cancelPress(this.state));
  }

  // ---------- panel ----------

  _render(force = false) {
    const v = legView(this.state);
    const key = JSON.stringify(v);
    if (!force && key === this._viewKey) return;
    this._viewKey = key;
    const s = this.state;
    const counts = h(
      "div",
      { class: "kf-legs-counts", role: "group", "aria-label": "Number of legs" },
      v.counts.map((c) =>
        h("button", {
          class: `kf-btn kf-legs-count${c.suggested ? " suggested" : ""}`, type: "button",
          "data-count": String(c.n), text: String(c.n), "aria-label": c.label, "aria-pressed": String(c.pressed),
          onclick: () => this._set(chooseCount(this.state, c.n)),
        }),
      ),
    );
    const tools = v.phase === "choose-count"
      ? null
      : h(
          "div",
          { class: "kf-row kf-legs-tools" },
          h("button", { class: "kf-btn", type: "button", text: "Spread evenly", "data-action": "spread-legs", disabled: !v.canSpread, onclick: () => this._set(spreadEvenly(this.state, this.thing.outline)) }),
          h("button", { class: "kf-btn", type: "button", text: "Undo", "data-action": "undo-leg", disabled: !v.canUndo, onclick: () => this._set(undoLeg(this.state)) }),
          h("button", { class: "kf-btn", type: "button", text: "Clear", "data-action": "clear-legs", disabled: !v.canClear, onclick: () => this._set(clearLegs(this.state)) }),
        );
    this.root.dataset.phase = v.phase;
    this.root.replaceChildren(
      h("h2", { class: "kf-legs-heading", "aria-live": "polite", text: v.heading }),
      h("p", { class: "kf-note", text: v.note }),
      counts,
      ...(tools ? [tools] : []),
      h("div", { class: "kf-row end" }, ...this.buttons(v.phase, s).filter(Boolean)),
    );
  }
}
