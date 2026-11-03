// Leg placing for the parent, like eyes: pick how many legs, then tap where each one goes on the
// preview (snapped inside the outline). Tap a placed leg to take it off (then tap where it goes),
// Undo takes off the last one. Used by <kf-guided-add> (Legs step) and <kf-thing-card> (Place legs).
// The pure rules live in legplace.js.
import { h } from "./dom.js";
import { snapPoint } from "./geometry.js";
import { LEG_COUNTS, SUGGESTED_COUNT, legState, legPhase, chooseCount, recount, tapLeg, undoLeg, legHeading, legNote } from "./legplace.js";

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
    this.state = legState(thing.legs ?? [], target);
    this.drawOpts = drawOpts;
    this.onChange = onChange ?? (() => {});
    this.buttons = buttons ?? (() => []);
    this.chime = chime ?? (() => {});
    this.root = h("div", { class: "kf-legs", "data-testid": "leg-placing" });
    this._onDown = (e) => this._tap(e);
    preview.canvas.addEventListener("pointerdown", this._onDown);
    preview.canvas.classList.add("kf-legs-target");
  }

  get legs() { return this.state.legs; }
  get phase() { return legPhase(this.state); }

  /** The controls (heading, count picker or Undo / Change number, plus the caller's buttons). */
  panel() {
    this._renderPanel();
    return this.root;
  }

  detach() {
    this.preview.canvas.removeEventListener("pointerdown", this._onDown);
    this.preview.canvas.classList.remove("kf-legs-target");
  }

  redraw() {
    return this.preview.draw({ ...this.thing, legs: this.state.legs }, { ...this.drawOpts, markLegs: this.phase !== "count" });
  }

  _set(state) {
    this.state = state;
    this.thing = { ...this.thing, legs: state.legs };
    this._renderPanel();
    this.redraw();
    this.onChange(state);
  }

  _tap(e) {
    if (!e.isPrimary || this.phase === "count" || !this.thing.outline?.length) return;
    e.preventDefault();
    const pt = this.preview.toBoard(e.clientX, e.clientY);
    const snapped = snapPoint(this.geo, pt, this.thing.outline);
    const r = tapLeg(this.state, pt, snapped, this.preview.legRadius(this.thing));
    if (r.action === "none") return;
    this.chime("tap");
    this._set(r.state);
  }

  _renderPanel() {
    const s = this.state, phase = this.phase;
    const picked = s.target ?? null;
    const body = phase === "count"
      ? h(
          "div",
          { class: "kf-legs-counts", role: "group", "aria-label": "Number of legs" },
          LEG_COUNTS.map((n) =>
            h("button", {
              class: `kf-btn kf-legs-count${picked === null && n === SUGGESTED_COUNT ? " suggested" : ""}`, type: "button",
              "data-count": String(n), text: String(n),
              "aria-label": n === 1 ? "1 leg" : `${n} legs`,
              onclick: () => this._set(chooseCount(s, n)),
            }),
          ),
        )
      : h(
          "div",
          { class: "kf-row" },
          h("button", { class: "kf-btn", type: "button", text: "Undo leg", "data-action": "undo-leg", disabled: !s.legs.length, onclick: () => this._set(undoLeg(s)) }),
          h("button", { class: "kf-btn", type: "button", text: "Change number", "data-action": "recount", onclick: () => this._set(recount(s)) }),
        );
    this.root.replaceChildren(
      h("h2", { class: "kf-legs-heading", "aria-live": "polite", text: legHeading(s) }),
      h("p", { class: "kf-note", text: legNote(s) }),
      body,
      h("div", { class: "kf-row end" }, ...this.buttons(phase, s).filter(Boolean)),
    );
  }
}
