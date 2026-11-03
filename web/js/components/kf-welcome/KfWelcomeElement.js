// <kf-welcome>: the one-time first-run card for the parent (US-1.2).
// Add to Home Screen nudge (Safari, not standalone), how to enter edit mode, a co-play tip.
// Dismissing requests persistent storage, unlocks audio (it is a user gesture), sets
// settings.welcomed and dispatches kf-close. It never asks for the microphone.
import { h, newId } from "../kf-dialog/dom.js";

function isSafari() {
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\//.test(ua)) || /iP(ad|hone|od)/.test(ua) || iPadOS;
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
      h("li", {}, [h("strong", { text: "Klara just taps. " }), "The first tap turns the sound on; every thing she taps jumps and says its name."]),
      h("li", {}, [h("strong", { text: "To edit, press and hold the scene for 1.5 s. " }), "A ring fills, then a quick adult check opens edit mode. Klara can't get there by tapping."]),
      h("li", {}, [h("strong", { text: "Play together: " }), "say the names with Klara, and record your own voice for each thing."]),
    ];
    if (!standalone && isSafari()) {
      tips.unshift(h("li", { class: "kf-welcome-home" }, [h("strong", { text: "Add it to your Home Screen. " }), "Tap Share, then Add to Home Screen. It then opens full screen, works offline and keeps your recordings safer."]));
    }
    const start = h("button", { type: "button", class: "kf-btn primary kf-welcome-start", text: "Start playing", onclick: () => this.dismiss() });
    this.replaceChildren(
      h("div", { class: "kf-welcome-scrim" }),
      h("section", { class: "kf-sheet center kf-welcome", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, [
        h("h2", { id: titleId, text: "Welcome to Klara's Farm" }),
        h("ul", { class: "kf-welcome-tips" }, tips),
        h("p", { class: "kf-note", text: "Everything stays on this iPad. The microphone is only used when you record." }),
        h("div", { class: "kf-row end" }, [start]),
      ]),
    );
    start.focus();
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
