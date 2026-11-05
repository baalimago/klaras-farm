// Shell: mounts parent-facing elements into #parent-layer according to the Session.
// Panels are custom elements that receive `services` and `params`, and dispatch `kf-close` when done.
//   session.state = { mode: 'play'|'gate'|'edit'|'scene', panel: null|{name, params} }
// Panel names → tags. Every panel lives in components/<tag>/ and is loaded on first use.
// Besides the session's mode and panel, two parent overlays have their own slots: the first-run
// welcome card, and the onboarding tour that follows it (also restarted from Settings, tour()).
const PANELS = {
  gate: "kf-adult-check",
  edit: "kf-edit-layer",
  card: "kf-thing-card",
  guided: "kf-guided-add",
  scenes: "kf-scenes",
  library: "kf-library",
  scene: "kf-scene-tools",
  settings: "kf-settings",
  welcome: "kf-welcome",
  tour: "kf-tour",
  "find-setup": "kf-find-setup",
};

export class Shell {
  constructor(root, services) {
    this.root = root;
    this.services = services;
    this.mounted = new Map(); // slot → element
    services.session.addEventListener("change", () => this.render());
    this.render();
  }

  /** Mounts what the session wants. Renders can overlap (imports are async), so each one
   * re-checks that it is still the latest before appending anything. */
  async render() {
    const token = (this._token = (this._token ?? 0) + 1);
    const wanted = this.wanted();
    for (const [slot, el] of this.mounted) {
      const w = wanted.get(slot);
      if (!w || el.dataset.panel !== w.name || el._params !== w.params) {
        el.remove();
        this.mounted.delete(slot);
      }
    }
    for (const [slot, w] of wanted) {
      if (this.mounted.has(slot)) continue;
      const el = await this.create(w.name, w.params);
      if (token !== this._token || this.mounted.has(slot)) return; // a newer render owns the layer now
      this.root.append(el);
      this.mounted.set(slot, el);
    }
  }

  wanted() {
    const { mode, panel } = this.services.session.state;
    const wanted = new Map();
    if (mode === "gate") wanted.set("mode", { name: "gate", params: undefined });
    if (mode === "edit" || mode === "scene") wanted.set("mode", { name: mode === "scene" ? "scene" : "edit", params: undefined });
    if (panel) wanted.set("panel", { name: panel.name, params: panel.params });
    if (this._welcome) wanted.set("welcome", { name: "welcome", params: undefined });
    if (this._tour) wanted.set("tour", { name: "tour", params: this._tour });
    return wanted;
  }

  async create(name, params) {
    const tag = PANELS[name];
    await import(`./components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.dataset.panel = name;
    el._params = params;
    el.services = this.services;
    el.params = params ?? {};
    el.addEventListener("kf-close", () => {
      // The tour follows the welcome card at once: the parent is here and reading.
      if (name === "welcome") { this._welcome = false; this._tour = {}; this.render(); }
      else if (name === "tour") { if (this.mounted.get("tour") === el) { this._tour = null; this.render(); } }
      else if (this.mounted.get("panel") === el) this.services.session.closePanel();
    });
    return el;
  }

  welcome() { this._welcome = true; this.render(); }

  /** Starts the onboarding tour from its first card (Settings, "Show the tour again"). */
  tour() { this._tour = {}; this.render(); }

  /** Shown in Settings and as a quiet badge on the edit bar; never interrupts play. */
  updateReady() {
    this.services.updateReady = true;
    this.services.session.dispatchEvent(new CustomEvent("update-ready"));
  }

  // ---- shared dialogs (implemented by kf-dialog) ----
  async confirm(opts) {
    await import("./components/kf-dialog/define.js");
    const el = document.createElement("kf-dialog");
    this.root.append(el);
    return el.confirm(opts); // resolves true/false, removes itself
  }

  async toast(message, opts = {}) {
    await import("./components/kf-dialog/define.js");
    const el = document.createElement("kf-dialog");
    this.root.append(el);
    return el.toast(message, opts); // opts.undo: () => void; resolves when gone
  }
}
