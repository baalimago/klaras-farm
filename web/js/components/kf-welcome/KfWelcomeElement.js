// <kf-welcome>: the one-time first-run card for the parent (US-1.2).
// A watercolour splash in the style of Klara's first birthday card (bunting, a sheep and a pig
// on an autumn meadow, leaves drifting down) with three short lines: a co-play tip, how to
// enter edit mode, and the Add to Home Screen nudge (iPad and iPhone, not standalone).
// Dismissing requests persistent storage, unlocks audio (it is a user gesture), sets
// settings.welcomed and dispatches kf-close. It never asks for the microphone.
import { h, newId } from "../kf-dialog/dom.js";
import { bunting, leaf, meadow, PAINT } from "./art.js";
import { device } from "../../io/device.js";

// Each leaf: where it lands (% from the left, px above the bottom), shape, colour, and when it
// starts and how long it falls. One fall each, so the card is still once they have landed.
const LEAVES = [
  { x: 8, y: 24, shape: "maple", color: PAINT.flags[3], delay: 0.1, secs: 3.3, spin: 160 },
  { x: 22, y: 8, shape: "round", color: PAINT.flags[4], delay: 0.7, secs: 3.9, spin: -120 },
  { x: 34, y: 30, shape: "long", color: PAINT.flags[2], delay: 0.4, secs: 3.6, spin: 200 },
  { x: 76, y: 32, shape: "maple", color: PAINT.flags[1], delay: 1.1, secs: 3.5, spin: -180 },
  { x: 85, y: 22, shape: "round", color: PAINT.flags[8], delay: 0.2, secs: 4.2, spin: 140 },
  { x: 63, y: 34, shape: "long", color: PAINT.flags[6], delay: 1.5, secs: 3.7, spin: -150 },
];

function fallingLeaves() {
  return h("div", { class: "kf-welcome-leaves", "aria-hidden": "true" }, LEAVES.map((l) =>
    h("span", { class: "kf-welcome-leaf", style: `left:${l.x}%;bottom:${l.y}px;--delay:${l.delay}s;--secs:${l.secs}s;--spin:${l.spin}deg` }, [
      h("span", { class: "kf-welcome-sway" }, [leaf(l.shape, l.color)]),
    ])));
}

export class KfWelcomeElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this._done = false;
  }

  connectedCallback() {
    const titleId = newId("welcome-title");
    let standalone = false;
    try {
      standalone = !!this.services?.storage?.isStandalone?.();
    } catch {}
    const tips = [
      h("p", { class: "kf-welcome-tip" }, [h("strong", { text: "Play together:" }), " tap, listen and say the names with Klara."]),
      h("p", { class: "kf-welcome-tip" }, [h("strong", { text: "Grown-ups:" }), " hold the scene for 1.5 s to draw and record."]),
    ];
    if (!standalone && device().ios) {
      tips.push(h("p", { class: "kf-welcome-tip kf-welcome-home" }, [h("strong", { text: "Add it to your Home Screen: " }), "tap Share, then Add to Home Screen. It opens full screen and keeps your recordings safer."]));
    }
    const start = h("button", { type: "button", class: "kf-btn primary kf-welcome-start", text: "Start playing", onclick: () => this.dismiss() });
    this.replaceChildren(
      h("div", { class: "kf-welcome-scrim" }),
      h("section", { class: "kf-sheet center kf-welcome", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, [
        bunting(),
        meadow(),
        fallingLeaves(),
        h("div", { class: "kf-welcome-body" }, [
          h("h2", { id: titleId, class: "kf-welcome-title" }, [
            h("span", { class: "kf-welcome-hello", text: "Welcome to " }),
            h("span", { class: "kf-welcome-name", text: "Klara's Farm!" }),
          ]),
          h("div", { class: "kf-welcome-tips" }, tips),
          h("div", { class: "kf-welcome-go" }, [start]),
        ]),
        h("p", { class: "kf-welcome-private", text: `Everything stays on this ${device().name}.` }),
      ]),
    );
    start.focus({ preventScroll: true });
  }

  /**
   * Closes at once. Unlocking audio and asking for persistent storage start inside the tap;
   * saving `welcomed` happens in the background. Nothing is awaited before closing: on iPad,
   * navigator.storage.persist() can stay pending, which used to leave the card up and the
   * board unreachable.
   */
  dismiss() {
    if (this._done) return;
    this._done = true;
    const { storage, store, audio } = this.services ?? {};
    try {
      audio?.unlock?.();
    } catch {}
    try {
      Promise.resolve(storage?.requestPersist?.()).catch(() => {});
    } catch {}
    try {
      Promise.resolve(store?.updateSettings({ patch: { welcomed: true } })).catch((e) => console.warn("could not save welcomed", e));
    } catch (e) {
      console.warn("could not save welcomed", e); // the card shows again next launch; play is not blocked
    }
    this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true }));
  }
}
