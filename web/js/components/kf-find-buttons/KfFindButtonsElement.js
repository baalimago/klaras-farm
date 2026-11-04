// <kf-find-buttons>: the two child-facing find game buttons in the bottom corners of the play screen
// (playtest rounds 2 and 3: finding is something the child starts, not something that just happens).
//   🔍          find the animal ("Where is the cow?", then its sound)
//   felt dots   find a colour ("Tap on an animal that is yellow!"); during a round it shows that colour
// A short tap starts the game when the finger lifts (press.js): iOS lets the device voice start in
// pointerup, not in pointerdown. Holding a button (the hold ring fills, ~1 s) opens that game's
// setup for grown-ups, "find-setup", after the adult check (Session.holdStart with `then`).
// Icon-only (the child can't read), felt-styled, 96 px. They sit above the board, so a press on a
// button never reaches the board. Hidden outside play, while the things sleep, in a scene without
// things, and when the parent turns "Show find games" off.
// Needs `services` ({engine, session, audio, flags?}) set before it is connected.

import { groupHex } from "../../play/colors.js";
import { initialPress, nextPress } from "./press.js";

const KINDS = [
  { kind: "animal", label: "Find the animal", icon: "🔍" },
  { kind: "color", label: "Find a colour", icon: null },
];
/** How long a grown-up holds a find button to open its setup. */
export const FIND_HOLD_MS = 1000;

export class KfFindButtonsElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this._buttons = new Map();
    this._press = initialPress();
    this._sync = () => this._render();
    this._onArmed = () => this._step({ type: "armed" });
  }

  connectedCallback() {
    if (!this.services || this._buttons.size) return;
    this.setAttribute("role", "group");
    this.setAttribute("aria-label", "Find games");
    for (const { kind, label, icon } of KINDS) this._buttons.set(kind, this._button(kind, label, icon));
    this.services.engine?.addEventListener("find", this._sync);
    this.services.session?.addEventListener?.("change", this._sync);
    this.services.session?.addEventListener?.("hold-armed", this._onArmed);
    this._render();
  }

  disconnectedCallback() {
    this.services?.engine?.removeEventListener("find", this._sync);
    this.services?.session?.removeEventListener?.("change", this._sync);
    this.services?.session?.removeEventListener?.("hold-armed", this._onArmed);
  }

  _button(kind, label, icon) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `kf-find-btn kf-find-btn--${kind}`;
    b.dataset.kind = kind;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", "false");
    const face = document.createElement("span");
    face.className = "kf-find-btn__face";
    face.setAttribute("aria-hidden", "true");
    if (icon) face.textContent = icon;
    else for (let i = 0; i < 3; i++) face.append(Object.assign(document.createElement("span"), { className: "kf-find-dot" }));
    b.append(face);
    b.addEventListener("pointerdown", (e) => this._down(e, kind));
    b.addEventListener("pointerup", (e) => this._step({ type: "up", pointerId: e.pointerId }));
    b.addEventListener("pointercancel", () => this._step({ type: "cancel" }));
    b.addEventListener("click", (e) => { if (e.detail === 0) this._start(kind); }); // keyboard / switch control
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    this.append(b);
    return b;
  }

  _down(e, kind) {
    if (!e.isPrimary) return;
    e.preventDefault();
    const s = this.services;
    // Each step is guarded so one failure never eats the press (AGENTS.md rule 5).
    guard(() => s.audio?.unlock?.()); // synchronously, inside the gesture
    this._step({ type: "down", kind, pointerId: e.pointerId });
    guard(() => s.session?.holdStart?.(e, this, { then: { name: "find-setup", params: { game: kind } }, holdMs: s.flags?.findHoldMs ?? FIND_HOLD_MS, edges: false }));
  }

  _step(event) {
    const { state, start } = nextPress(this._press, event);
    this._press = state;
    if (start) this._start(start);
    this._render();
  }

  /** Starts (or repeats) a game. Called inside pointerup or a keyboard click: the question's voice starts here. */
  _start(kind) {
    const s = this.services;
    guard(() => s.audio?.unlock?.());
    guard(() => s.engine?.startFind(kind));
    this._render();
  }

  _render() {
    const s = this.services;
    if (!s) return;
    const mode = s.session?.state?.mode ?? s.engine?.mode ?? "play";
    this.hidden = !(mode === "play" && s.engine?.findAvailable);
    const round = s.engine?.findRound ?? null;
    for (const [kind, b] of this._buttons) {
      const active = round?.kind === kind;
      b.classList.toggle("is-active", active);
      b.classList.toggle("is-held", this._press.phase !== "idle" && this._press.kind === kind);
      b.setAttribute("aria-pressed", String(active));
    }
    // During a colour round the colour button turns that colour: a cue that needs no words.
    if (round?.kind === "color") this.style.setProperty("--find-color", groupHex(round.color));
    else this.style.removeProperty("--find-color");
  }
}

function guard(fn) {
  try {
    return fn();
  } catch (e) {
    console.warn("kf-find-buttons:", e);
    return undefined;
  }
}
