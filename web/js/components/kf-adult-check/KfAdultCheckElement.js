// <kf-adult-check>: the parental gate before edit mode (US-11.2).
// Shows the code ("Tap 4 7 2") or a sum, and a shuffled keypad (keys ≥ 64 px).
// A wrong key, a tap between keys, Escape or 10 s idle returns to play silently; passing → session.gatePassed().
import { newChallenge, press, tick, promptText } from "../../edit/adult-check.js";

const TICK_MS = 250;

export class KfAdultCheckElement extends HTMLElement {
  connectedCallback() {
    const s = this.services ?? {};
    // Guard against a stale mount (the Shell renders asynchronously): one check, and only at the gate.
    if (s.session?.state && s.session.state.mode !== "gate") return void this.remove();
    for (const other of this.ownerDocument.querySelectorAll("kf-adult-check")) if (other !== this) other.remove();
    if (s.session && !s.session.services) s.session.connect?.(s);
    this._now = () => (s.session?.now ? s.session.now() : Date.now());
    const kind = s.store?.settings?.gateKind ?? s.flags?.gateKind ?? "keypad";
    this._state = newChallenge(s.env?.rng ?? Math.random, kind === "sum" ? "sum" : "keypad", this._now());
    this._finished = false;
    this._render();
    this._onPointer = (e) => this._pointerdown(e);
    this._onKey = (e) => this._keydown(e);
    this.addEventListener("pointerdown", this._onPointer);
    this.ownerDocument.addEventListener("keydown", this._onKey);
    this.addEventListener("contextmenu", (e) => e.preventDefault());
    this._timer = setInterval(() => this._result(tick(this._state, this._now())), TICK_MS);
    this.querySelector(".kf-key")?.focus({ preventScroll: true });
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this.removeEventListener("pointerdown", this._onPointer);
    this.ownerDocument.removeEventListener("keydown", this._onKey);
  }

  /** The current challenge (for tests and the spoken-digits variant later). */
  get challenge() {
    return this._state;
  }

  _render() {
    const st = this._state;
    this.replaceChildren();
    const sheet = document.createElement("div");
    sheet.className = "kf-gate";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "kf-gate-title");

    const card = document.createElement("div");
    card.className = "kf-gate__card";
    const eyebrow = document.createElement("p");
    eyebrow.className = "kf-gate__eyebrow";
    eyebrow.textContent = "Grown-ups only";
    const title = document.createElement("h2");
    title.id = "kf-gate-title";
    title.className = "kf-gate__prompt";
    title.textContent = promptText(st);
    const dots = document.createElement("div");
    dots.className = "kf-gate__dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < st.code.length; i++) dots.append(document.createElement("span"));
    const note = document.createElement("p");
    note.className = "kf-note";
    note.textContent = "Keeps little fingers out of edit mode.";
    card.append(eyebrow, title, dots, note);

    const pad = document.createElement("div");
    pad.className = "kf-gate__pad";
    pad.setAttribute("role", "group");
    pad.setAttribute("aria-label", "Keypad");
    if (st.keys.length > 9) pad.classList.add("ten");
    for (const k of st.keys) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kf-key";
      b.dataset.key = String(k);
      b.textContent = String(k);
      b.addEventListener("click", () => this._key(k));
      pad.append(b);
    }
    sheet.append(card, pad);
    this.append(sheet);
    this._dots = dots;
  }

  _pointerdown(e) {
    if (e.target.closest?.(".kf-key")) return; // handled on click
    if (e.target.closest?.(".kf-gate__card")) return; // reading the code is fine
    this._result(press(this._state, null, this._now())); // a tap between keys
  }

  _keydown(e) {
    if (e.key === "Escape") return this._result(press(this._state, null, this._now()));
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      this._key(Number(e.key));
    }
  }

  _key(k) {
    this._result(press(this._state, k, this._now()));
  }

  _result({ state, result }) {
    if (this._finished) return;
    this._state = state;
    [...(this._dots?.children ?? [])].forEach((d, i) => d.classList.toggle("on", i < state.entered));
    if (result === "continue") return;
    this._finished = true;
    clearInterval(this._timer);
    const session = this.services?.session;
    if (result === "pass") session?.gatePassed();
    else session?.gateFailed();
  }
}
