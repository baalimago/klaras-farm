// Session: the edit-mode state (US-11.1–11.4) as an EventTarget around the pure reducers in edit/.
//   state = {mode:'play'|'gate'|'edit'|'scene', panel:null|{name, params}, lastActivityAt, graceUntil}
// Dispatches 'change' only when mode or panel changes (the Shell remounts on 'change'),
// and 'hold-armed' when a hold completes. Clock, timers, window and the ring are injectable for tests.
import { initialSession, nextSession } from "./edit/session.js";
import { initialHold, nextHold, HOLD } from "./edit/hold.js";

const FRAME_MS = 32; // ring refresh while holding: cheap DOM attribute writes, no canvas work
const RING_LINGER_MS = 1500; // the full ring leaves on release, or after this if no release arrives

const globalTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
};

export class Session extends EventTarget {
  /**
   * @param {{now?:() => number, holdMs?:number, timers?:object, win?:EventTarget|null, doc?:Document|null,
   *          services?:object, createRing?:() => {set(x:number, y:number, progress:number, visible:boolean):void, remove():void}|null}} [opts]
   */
  constructor({ now = () => Date.now(), holdMs = HOLD.holdMs, timers = globalTimers, win, doc, services = null, createRing } = {}) {
    super();
    this.now = now;
    this.holdMs = holdMs;
    this.timers = timers;
    this.win = win === undefined ? (typeof window !== "undefined" ? window : null) : win;
    this.doc = doc === undefined ? (typeof document !== "undefined" ? document : null) : doc;
    this.services = services;
    this._createRing = createRing ?? (() => this._domRing());
    this._s = initialSession(now());
    this._ticker = null;
    this._hold = null;
    if (this.win) {
      const activity = () => this.activity();
      this.win.addEventListener("pointerdown", activity, true);
      this.win.addEventListener("keydown", (e) => this._onKey(e), true);
    }
    this._a11yButton();
  }

  /** Optional: hand over the services object (audio, engine, store, shell). Also picked up from the board. */
  connect(services) {
    this.services = services;
  }

  get state() {
    return this._s;
  }

  // ---- transitions ----
  /** @param {{name:string, params?:object}|null} [then]  a panel to open once edit mode starts (after the check) */
  holdArmed(then = null) { this._apply({ type: "hold-armed", then }); }
  gatePassed() { this._apply({ type: "gate-pass" }); }
  gateFailed() { this._apply({ type: "gate-fail" }); }
  done() { this._apply({ type: "done" }); }
  activity() { this._apply({ type: "activity" }); }
  openPanel(name, params = {}) { this._apply({ type: "open-panel", name, params }); }
  closePanel() { this._apply({ type: "close-panel" }); }
  sceneTools() { this._apply({ type: "scene-tools" }); }
  sceneDone() { this._apply({ type: "scene-done" }); }
  playTap() { this._apply({ type: "play-tap" }); }

  _apply(event) {
    const prev = this._s;
    const next = nextSession(prev, event, this.now());
    if (next === prev) return;
    this._s = next;
    if (prev.mode === next.mode && prev.panel === next.panel) return;
    if (prev.mode !== next.mode) {
      const wasEditing = prev.mode === "edit" || prev.mode === "scene";
      const isEditing = next.mode === "edit" || next.mode === "scene";
      const audio = this.services?.audio;
      if (!wasEditing && isEditing) audio?.chime?.("enter");
      if (wasEditing && !isEditing) audio?.chime?.("leave");
      this.services?.engine?.setMode?.(next.mode === "gate" ? "play" : next.mode);
      this._syncTicker();
      if (this._a11y) this._a11y.hidden = next.mode !== "play";
    }
    this.dispatchEvent(new CustomEvent("change", { detail: { from: prev.mode, to: next.mode } }));
  }

  _syncTicker() {
    const editing = this._s.mode === "edit" || this._s.mode === "scene";
    if (editing && this._ticker == null) this._ticker = this.timers.setInterval(() => this._apply({ type: "tick" }), 1000);
    if (!editing && this._ticker != null) {
      this.timers.clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  // ---- hold to edit ----

  /**
   * Called by the board on every primary pointerdown. Drives edit/hold.js, the ring and the soft tone.
   * The find game buttons call it too, with `opts`: then (the panel their hold opens after the
   * check), holdMs (their shorter hold) and edges: false (they sit near the screen edge on purpose).
   * @param {PointerEvent} e
   * @param {HTMLElement & {toBoard?:Function, services?:object}} boardEl
   * @param {{then?:{name:string, params?:object}, holdMs?:number, edges?:boolean}} [opts]
   */
  holdStart(e, boardEl, opts = {}) {
    if (boardEl?.services && !this.services) this.services = boardEl.services;
    const { mode, panel } = this._s;
    if (!(mode === "play" || (mode === "edit" && !panel))) return;
    if (this._hold && this._hold.state.phase !== "armed") return; // a second finger: its own listeners cancel
    this._endHold(true);
    const t = this.now();
    const holdMs = opts.holdMs ?? this.holdMs;
    const edges = opts.edges !== false;
    const state = nextHold(initialHold(), {
      type: "down", x: e.clientX, y: e.clientY, t, width: e.width, height: e.height,
      vw: edges ? this.win?.innerWidth : undefined, vh: edges ? this.win?.innerHeight : undefined, pointerId: e.pointerId,
    }, { holdMs });
    if (state.phase !== "pending") return;

    const hold = { state, boardEl, then: opts.then ?? null, holdMs, ring: this._createRing(), listeners: [], timers: [], interval: null, down: e };
    this._hold = hold;
    const on = (type, fn) => {
      this.win?.addEventListener(type, fn, true);
      hold.listeners.push([type, fn]);
    };
    const pid = (ev) => ev.pointerId;
    on("pointermove", (ev) => this._step({ type: "move", x: ev.clientX, y: ev.clientY, width: ev.width, height: ev.height, pointerId: pid(ev) }));
    on("pointerup", (ev) => this._step({ type: "up", pointerId: pid(ev) }));
    on("pointercancel", (ev) => this._step({ type: "cancel", pointerId: pid(ev) }));
    on("pointerdown", (ev) => {
      if (ev === hold.down || ev.pointerId === state.pointerId) return; // the same press bubbling up
      this._step({ type: "second-pointer", pointerId: pid(ev) });
    });
    const tick = () => this._step({ type: "tick", t: this.now() });
    hold.timers.push(this.timers.setTimeout(tick, state.showMs), this.timers.setTimeout(tick, state.holdMs));
    hold.interval = this.timers.setInterval(tick, FRAME_MS);
    hold.ring?.set(state.x, state.y, 0, false);
  }

  _step(event) {
    const hold = this._hold;
    if (!hold) return;
    const prev = hold.state;
    const next = nextHold(prev, event, { holdMs: hold.holdMs });
    if (next === prev) return;
    hold.state = next;
    const audio = this.services?.audio;
    if (next.phase === "showing" || next.phase === "armed") hold.ring?.set(next.x, next.y, next.progress, true);
    if (next.phase === "showing" && prev.phase === "pending") audio?.holdTone?.(true);
    if (next.phase === "cancelled") {
      if (prev.phase === "showing") audio?.holdTone?.(false);
      this._endHold(true);
      return;
    }
    if (next.phase === "armed" && prev.phase !== "armed") {
      audio?.holdTone?.(false);
      this._clearHoldTimers(hold);
      hold.timers.push(this.timers.setTimeout(() => this._endHold(true), RING_LINGER_MS));
      this._armed(hold);
      return;
    }
    if (next.phase === "armed" && next.released) this._endHold(true);
  }

  _clearHoldTimers(hold) {
    for (const id of hold.timers) this.timers.clearTimeout(id);
    hold.timers = [];
    if (hold.interval != null) this.timers.clearInterval(hold.interval);
    hold.interval = null;
  }

  _endHold(removeRing) {
    const hold = this._hold;
    if (!hold) return;
    this._clearHoldTimers(hold);
    for (const [type, fn] of hold.listeners) this.win?.removeEventListener(type, fn, true);
    hold.listeners = [];
    if (removeRing) hold.ring?.remove();
    this._hold = null;
  }

  _armed(hold) {
    this.dispatchEvent(new CustomEvent("hold-armed", { detail: { x: hold.state.x, y: hold.state.y, then: hold.then } }));
    const { mode, panel } = this._s;
    if (mode === "play") return this.holdArmed(hold.then);
    if (hold.then) return; // a find button hold only means something in play
    if (mode !== "edit" || panel) return;
    // Holding an empty spot in edit mode adds a thing there (US-11.3).
    const s = this.services ?? hold.boardEl?.services ?? {};
    const p = hold.boardEl?.toBoard?.(hold.state.x, hold.state.y);
    if (!p) return;
    const at = Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y];
    if (s.engine?.pick?.(at[0], at[1])) return;
    const place = s.store?.currentPlace;
    if (place && s.store?.canAddThing && !s.store.canAddThing(place.id)) {
      const n = s.store.maxThings ?? 8;
      s.shell?.toast?.(`This scene has ${n} things, the most it can hold. Delete one to add another, or allow more in Settings.`);
      return;
    }
    this.openPanel("guided", { at });
  }

  _domRing() {
    const doc = this.doc;
    if (!doc?.createElement) return null;
    import("./components/kf-hold-ring/define.js").catch(() => {});
    const el = doc.createElement("kf-hold-ring");
    (doc.getElementById("parent-layer") ?? doc.body).append(el);
    return {
      set(x, y, progress, visible) {
        el.setAttribute("x", String(Math.round(x)));
        el.setAttribute("y", String(Math.round(y)));
        el.setAttribute("progress", progress.toFixed(3));
        el.toggleAttribute("hidden", !visible);
      },
      remove() { el.remove(); },
    };
  }

  // ---- ways in without the hold (US-7.6) ----

  _onKey(e) {
    if (e.key !== "e" || e.ctrlKey || e.metaKey || e.altKey || this._s.mode !== "play") return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? "") || t.isContentEditable)) return;
    this.holdArmed();
  }

  /** A visually hidden "Edit" button for VoiceOver, present only in play. */
  _a11yButton() {
    const root = this.doc?.getElementById?.("parent-layer");
    if (!root) return;
    const b = this.doc.createElement("button");
    b.type = "button";
    b.className = "kf-sr-edit";
    b.textContent = "Edit";
    b.setAttribute("aria-label", "Edit (grown-ups)");
    b.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;";
    b.addEventListener("click", () => this.holdArmed());
    root.append(b);
    this._a11y = b;
  }
}
