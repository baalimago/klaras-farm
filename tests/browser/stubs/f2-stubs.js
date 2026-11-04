// Test stubs for package F2 (classic script, injected with page.addScriptTag({path})).
// They implement exactly the interfaces F2 depends on from other packages, so the F2 elements
// can be tested before those packages land:
//   A: <kf-draw-pad mode="shape|yarn"> emitting `kf-stroke {points}`; services.board.boardRect()/toBoard()
//   C: session.sceneTools/sceneDone/openPanel/closePanel/activity, state, 'change' events
//   E: services.share.* and services.storage.*
// The real FarmStore (over MemoryRepo) and the real Shell (for confirm/toast via <kf-dialog>) are used.
(() => {
  const calls = [];
  const log = (name, ...args) => calls.push([name, ...args]);

  function defineDrawPad() {
    if (customElements.get("kf-draw-pad")) return;
    customElements.define(
      "kf-draw-pad",
      class extends HTMLElement {
        connectedCallback() {
          this.style.cssText += ";display:block;position:absolute;inset:0;";
          log("draw-pad-connected", this.getAttribute("mode"));
        }
        /** Test helper: what the real pad emits after a finished stroke (board coords). */
        stroke(points) {
          this.dispatchEvent(new CustomEvent("kf-stroke", { detail: { points }, bubbles: true }));
        }
      },
    );
  }

  /** A fixed 4:3 board at a known client rect. */
  function fakeBoard(rect = { left: 140, top: 60, width: 900, height: 675 }) {
    const el = document.createElement("div");
    el.id = "board";
    el.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#8fd8f5`;
    document.body.prepend(el);
    el.boardRect = () => el.getBoundingClientRect();
    el.toBoard = (cx, cy) => {
      const r = el.getBoundingClientRect();
      return [(cx - r.left) / r.width, (cy - r.top) / r.height];
    };
    el.toClient = (x, y) => {
      const r = el.getBoundingClientRect();
      return [r.left + x * r.width, r.top + y * r.height];
    };
    /** Scene tools draw a dragged piece through the renderer; the stub records each lift. */
    el.lifts = [];
    el.setLift = (lift) => el.lifts.push(lift ? { ...lift } : null);
    return el;
  }

  function fakeSession(mode = "edit") {
    const s = new EventTarget();
    s.state = { mode, panel: null };
    const set = (patch) => {
      s.state = { ...s.state, ...patch };
      s.dispatchEvent(new CustomEvent("change"));
    };
    s.sceneTools = () => (log("session.sceneTools"), set({ mode: "scene" }));
    s.sceneDone = () => (log("session.sceneDone"), set({ mode: "edit" }));
    s.openPanel = (name, params) => (log("session.openPanel", name, params), set({ panel: { name, params } }));
    s.closePanel = () => (log("session.closePanel"), set({ panel: null }));
    s.activity = () => log("session.activity");
    s.done = () => (log("session.done"), set({ mode: "play", panel: null }));
    return s;
  }

  function fakeShare(opts = {}) {
    const counts = opts.counts ?? { places: 2, things: 3, clips: 4 };
    return {
      async buildExport(store) {
        log("share.buildExport", !!store);
        return { file: new File([new Uint8Array([80, 75, 3, 4])], "klaras-farm.zip", { type: "application/zip" }), name: "klaras-farm.zip", counts };
      },
      async shareFile(file) { log("share.shareFile", file?.name); return true; },
      async readImport(buf) {
        log("share.readImport", buf?.byteLength);
        if (opts.importError) { const e = new Error(opts.importError); e.name = "ImportError"; e.code = opts.importError; throw e; }
        return opts.incoming ?? { snapshot: { places: [{}], things: [{}, {}], clips: [{}, {}, {}, {}, {}, {}, {}] }, blobs: [] };
      },
      async importReplacing(store, buf) { log("share.importReplacing", buf?.byteLength); return { places: 1, things: 2, clips: 7 }; },
      async undoImport(store) { log("share.undoImport"); },
    };
  }

  function fakeStorage(opts = {}) {
    return {
      async requestPersist() { log("storage.requestPersist"); return opts.persist ?? true; },
      async estimate() { log("storage.estimate"); return { usage: 3.2e6, quota: 1e9 }; },
      isStandalone() { return opts.standalone ?? false; },
      async deleteAllData() { log("storage.deleteAllData"); },
      async applyUpdate() { log("storage.applyUpdate"); },
    };
  }

  /** Builds services around a real FarmStore over MemoryRepo, loaded with `snapshot`. */
  async function boot(snapshot, opts = {}) {
    const [{ FarmStore }, { MemoryRepo }, { Shell }] = await Promise.all([
      import("./js/farm-store.js"),
      import("./js/io/memory-repo.js"),
      import("./js/shell.js"),
    ]);
    let n = 0;
    const env = { now: () => new Date().toISOString(), rng: Math.random, newId: () => `new-${++n}`, deviceId: "dev-test" };
    const store = new FarmStore(new MemoryRepo(), env, "test");
    if (snapshot) await store.replaceAll(snapshot, []);
    if (opts.drawPad !== false) defineDrawPad();
    const board = fakeBoard();
    const session = fakeSession(opts.mode ?? "edit");
    const engine = { mode: "edit", setMode(m) { log("engine.setMode", m); this.mode = m; } };
    const audio = { unlock() { log("audio.unlock"); }, chime(k) { log("audio.chime", k); } };
    const services = {
      store, session, engine, audio, board, env,
      scripts: { en: {}, sv: {}, de: {}, fr: {}, es: {} },
      share: fakeShare(opts.share), storage: fakeStorage(opts.storage),
      flags: {}, appVersion: "test-1", warnings: opts.warnings ?? [], updateReady: !!opts.updateReady,
    };
    const root = document.getElementById("parent-layer");
    // The real Shell's confirm/toast (through <kf-dialog>), without its panel mounting, which
    // would import elements of packages that are not here yet.
    services.shell = { root, services, confirm: Shell.prototype.confirm, toast: Shell.prototype.toast, welcome() {}, updateReady: Shell.prototype.updateReady };
    window.services = services;
    return services;
  }

  async function mount(tag, params = {}) {
    await import(`./js/components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.services = window.services;
    el.params = params;
    el.addEventListener("kf-close", () => log("kf-close", tag));
    document.getElementById("parent-layer").append(el);
    return el;
  }

  /** Accessible-name check (axe is not available offline): every control must have a name. */
  function unnamed(root = document) {
    const nameOf = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(" ").trim();
      if (el.tagName === "BUTTON" || el.tagName === "SUMMARY") return el.textContent.trim();
      return el.getAttribute("title") ?? "";
    };
    return [...root.querySelectorAll("button, input, select, textarea, summary, [role=button]")]
      .filter((el) => !nameOf(el))
      .map((el) => el.outerHTML.slice(0, 120));
  }

  /** Visible buttons smaller than 44 × 44 CSS px. */
  function smallTargets(root = document) {
    return [...root.querySelectorAll("button, select, input:not([type=file])")]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; })
      .map((el) => el.outerHTML.slice(0, 120));
  }

  window.F2 = { calls, log, boot, mount, unnamed, smallTargets, defineDrawPad, fakeBoard, fakeSession, fakeShare, fakeStorage };
})();
