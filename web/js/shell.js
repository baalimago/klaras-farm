// Shell: mounts parent-facing elements into #parent-layer according to the Session.
// Panels are custom elements that receive `services` and `params`, and dispatch `kf-close` when done.
//   session.state = { mode: 'play'|'gate'|'edit'|'scene', panel: null|{name, params} }
// Panel names → tags. Every panel lives in components/<tag>/ and is loaded on first use.
const PANELS = {
  gate: "kf-adult-check",
  edit: "kf-edit-layer",
  card: "kf-thing-card",
  guided: "kf-guided-add",
  scenes: "kf-scenes",
  scene: "kf-scene-tools",
  settings: "kf-settings",
  welcome: "kf-welcome",
};

export class Shell {
  constructor(root, services) {
    this.root = root;
    this.services = services;
    this.mounted = new Map(); // slot → element
    services.session.addEventListener("change", () => this.render());
    this.render();
  }

  async render() {
    const { mode, panel } = this.services.session.state;
    const wanted = new Map();
    if (mode === "gate") wanted.set("mode", { name: "gate" });
    if (mode === "edit" || mode === "scene") wanted.set("mode", { name: mode === "scene" ? "scene" : "edit" });
    if (panel) wanted.set("panel", panel);
    if (this._welcome) wanted.set("welcome", { name: "welcome" });
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
      if (this.services.session.state !== undefined) {
        this.root.append(el);
        this.mounted.set(slot, el);
      }
    }
  }

  async create(name, params = {}) {
    const tag = PANELS[name];
    await import(`./components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.dataset.panel = name;
    el._params = params;
    el.services = this.services;
    el.params = params;
    el.addEventListener("kf-close", () => {
      if (name === "welcome") { this._welcome = false; this.render(); }
      else if (this.mounted.get("panel") === el) this.services.session.closePanel();
    });
    return el;
  }

  welcome() { this._welcome = true; this.render(); }

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
