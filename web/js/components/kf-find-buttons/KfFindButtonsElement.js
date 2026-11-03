// <kf-find-buttons>: the two child-facing find game buttons in the bottom corner of the play screen
// (playtest round 2: finding is something the child starts, not something that just happens).
//   🔍          find the animal ("Where is the cow?")
//   felt dots   find a colour ("Find something yellow!"); during a round it shows that colour
// Icon-only (the child can't read), felt-styled, 96 px. They sit above the board, so a press on a
// button never reaches the board (no tap on a thing, no edit hold). Hidden outside play, while the
// things sleep, in a scene without things, and when the parent turns "Show find games" off.
// Needs `services` ({engine, session, audio}) set before it is connected.

import { groupHex } from "../../play/colors.js";

const KINDS = [
  { kind: "animal", label: "Find the animal", icon: "🔍" },
  { kind: "color", label: "Find a colour", icon: null },
];

export class KfFindButtonsElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this._buttons = new Map();
    this._sync = () => this._render();
  }

  connectedCallback() {
    if (!this.services || this._buttons.size) return;
    this.setAttribute("role", "group");
    this.setAttribute("aria-label", "Find games");
    for (const { kind, label, icon } of KINDS) {
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
      // Start on pointerdown: inside the gesture (iOS speech and audio), and no 300 ms wait.
      b.addEventListener("pointerdown", (e) => {
        if (!e.isPrimary) return;
        e.preventDefault();
        this._press(kind);
      });
      b.addEventListener("click", (e) => { if (e.detail === 0) this._press(kind); }); // keyboard / switch control
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      this._buttons.set(kind, b);
      this.append(b);
    }
    this.services.engine?.addEventListener("find", this._sync);
    this.services.session?.addEventListener?.("change", this._sync);
    this._render();
  }

  disconnectedCallback() {
    this.services?.engine?.removeEventListener("find", this._sync);
    this.services?.session?.removeEventListener?.("change", this._sync);
  }

  _press(kind) {
    const s = this.services;
    s.audio?.unlock?.(); // synchronously, inside the gesture
    s.engine?.startFind(kind);
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
      b.setAttribute("aria-pressed", String(active));
    }
    // During a colour round the colour button turns that colour: a cue that needs no words.
    if (round?.kind === "color") this.style.setProperty("--find-color", groupHex(round.color));
    else this.style.removeProperty("--find-color");
  }
}
