// <kf-tour>: the onboarding tour for the grown-up (playtest round 3): an example creature, how to
// edit, scenes, how to record sounds. The Shell mounts it right after the first-run welcome card,
// and again when a parent taps "Show the tour again" in Settings; never at any other time, so it
// never appears for the child alone.
// State: tour.js (pure step machine). Each card renders from that state; a felt ring points at the
// real control (an animal on the board, its ✎ pencil, the Scenes button) when it is on screen.
// Not modal: no scrim, the layer lets every touch through except on the card, so the parent can
// tap the animal or hold the scene to enter edit mode while the tour stays up. Hidden (not ended)
// while the adult check, a panel or the scene tools are open. Next, Back and Skip tour on every
// card; Escape skips. When it ends it dispatches kf-close.
// Props: services ({session, board, store}). The ring is re-placed on resize, store and session
// changes, and once a second while up (animals wander in play); nothing runs per frame.
import { h, newId } from "../kf-dialog/dom.js";
import { initialTour, nextTour, tourStep, tourCard, cardPlacement, TOUR_STEPS } from "./tour.js";

const REPLACE_MS = 1000;
const SETTLE_MS = 500; // edit badges are placed after the edit layer mounts and things settle
const RING_PAD = 12;
const DEFAULT_HOLD_MS = 1500;

export class KfTourElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this.state = initialTour();
    this._subs = [];
    this._interval = 0;
    this._late = 0;
    this._card = null;
    this._ring = null;
    this._animalId = null;
  }

  connectedCallback() {
    if (this.state.phase === "off") this.state = nextTour(this.state, { type: "start" });
    const s = this.services ?? {};
    const sub = (target, type, fn) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, fn);
      this._subs.push(() => target.removeEventListener(type, fn));
    };
    sub(s.session, "change", () => { this._render(); this._placeLater(); });
    sub(s.store, "change", () => this._placeLater());
    sub(window, "resize", () => this._place());
    sub(this, "keydown", (e) => { if (e.key === "Escape") this._step("skip"); });
    sub(this, "pointerdown", () => s.session?.activity?.());
    this._interval = setInterval(() => this._place(), REPLACE_MS);
    this._render();
    this._placeLater();
  }

  disconnectedCallback() {
    for (const off of this._subs) off();
    this._subs = [];
    clearInterval(this._interval);
    clearTimeout(this._late);
  }

  /** The card on screen ('creature', 'edit', 'scenes', 'sounds'), or null. For tests and debugging. */
  get step() {
    return tourStep(this.state);
  }

  _step(type) {
    this.state = nextTour(this.state, { type });
    if (this.state.phase === "done") {
      this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true }));
      return;
    }
    this._render();
  }

  _mode() {
    return this.services?.session?.state?.mode ?? "play";
  }

  _covered() {
    const st = this.services?.session?.state;
    return !!st?.panel || st?.mode === "gate" || st?.mode === "scene";
  }

  _ctx() {
    return { mode: this._mode(), holdMs: this.services?.session?.holdMs ?? DEFAULT_HOLD_MS };
  }

  _render() {
    const step = this.step;
    if (!step) return void this.replaceChildren();
    const card = tourCard(step, this._ctx());
    const i = this.state.index;
    const last = i === TOUR_STEPS.length - 1;
    const titleId = newId("tour-title");
    const next = h("button", { type: "button", class: "kf-btn primary", "data-action": "next", text: last ? "Done" : "Next", onclick: () => this._step("next") });
    this._ring = h("div", { class: "kf-tour-ring", "aria-hidden": "true", hidden: true });
    this._card = h("section", { class: "kf-sheet kf-tour-card", role: "dialog", "aria-modal": "false", "aria-labelledby": titleId, "data-step": step }, [
      h("p", { class: "kf-note kf-tour-count", text: `${i + 1} of ${TOUR_STEPS.length}` }),
      h("h2", { id: titleId, text: card.title }),
      h("p", { class: "kf-tour-body", text: card.body }),
      h("div", { class: "kf-row kf-tour-actions" }, [
        last ? null : h("button", { type: "button", class: "kf-btn ghost", "data-action": "skip", text: "Skip tour", onclick: () => this._step("skip") }),
        h("span", { class: "kf-tour-gap" }),
        i > 0 ? h("button", { type: "button", class: "kf-btn", "data-action": "back", text: "Back", onclick: () => this._step("back") }) : null,
        next,
      ]),
    ]);
    this.hidden = this._covered();
    this.replaceChildren(this._ring, this._card);
    this._place();
    if (!this.hidden) next.focus({ preventScroll: true });
  }

  _placeLater() {
    clearTimeout(this._late);
    this._place();
    this._late = setTimeout(() => this._place(), SETTLE_MS);
  }

  /** Points the ring at the card's target and puts the card where it does not cover it. */
  _place() {
    const step = this.step;
    if (!step || !this._card) return;
    this.hidden = this._covered();
    const rect = this._targetRect(tourCard(step, this._ctx()).target);
    const ring = this._ring;
    ring.hidden = !rect;
    if (rect) {
      Object.assign(ring.style, {
        left: `${Math.round(rect.left - RING_PAD)}px`,
        top: `${Math.round(rect.top - RING_PAD)}px`,
        width: `${Math.round(rect.width + 2 * RING_PAD)}px`,
        height: `${Math.round(rect.height + 2 * RING_PAD)}px`,
      });
    }
    this._card.dataset.place = cardPlacement(rect, window.innerHeight);
  }

  /** The on-screen rectangle of what the card points at, or null when it is not on screen. */
  _targetRect(target) {
    if (!target) return null;
    if (target.kind === "selector") {
      const el = document.querySelector(target.selector);
      const r = el?.getBoundingClientRect();
      return r && r.width > 0 ? r : null;
    }
    return this._animalRect();
  }

  /**
   * The animal nearest the middle of the screen (easy to see, away from the corner buttons). Once
   * chosen, the ring stays on the same animal while it wanders.
   */
  _animalRect() {
    const { store, board } = this.services ?? {};
    const place = store?.currentPlace;
    if (!place || !board?.actorRect) return null;
    const kept = this._animalId && store.thingsIn(place.id).some((t) => t.id === this._animalId) ? board.actorRect(this._animalId) : null;
    if (kept) return kept;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    let best = null;
    let bestD = Infinity;
    for (const thing of store.thingsIn(place.id)) {
      const r = board.actorRect(thing.id);
      if (!r) continue;
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bestD) { best = r; bestD = d; this._animalId = thing.id; }
    }
    return best;
  }
}
