// Prefs: the grown-up's device preferences that are not part of the farm (like the music switch in
// music.js): they live in this browser's localStorage, never in the snapshot or an export.
//   recordingTips  "Show recording tips": the tip beside a find button when a question has no
//                  recording (<kf-find-buttons>). On unless switched off in Settings.
// Dispatches 'change' after a preference changes, so what shows it updates at once. A blocked
// localStorage (private browsing) keeps the choice for this page only.

const TIPS_KEY = "kf.recordingTips";

export class Prefs extends EventTarget {
  /** @param {{storage?: Storage|null}} [opts] */
  constructor({ storage = safeStorage() } = {}) {
    super();
    this._storage = storage;
    this._tips = read(storage, TIPS_KEY) !== "off";
  }

  get recordingTips() {
    return this._tips;
  }

  set recordingTips(on) {
    this._tips = !!on;
    try { this._storage?.setItem(TIPS_KEY, on ? "on" : "off"); } catch {}
    this.dispatchEvent(new CustomEvent("change", { detail: { key: "recordingTips" } }));
  }
}

function read(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
