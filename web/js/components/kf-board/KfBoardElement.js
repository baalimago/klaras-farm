// <kf-board>: the child's felt board. A 4:3 letterboxed canvas, the Renderer, and pointer handling.
// Pointer rules (US-5.1, US-11.1): primary pointer only, palms ignored, no scrolling or context menu.
// Play: a tap reacts on pointerdown (same frame, sound under 50 ms). Edit: a short tap picks a thing
// and dispatches `kf-thing-tap` {thingId} for the edit layer.
import { Renderer } from "../../io/renderer.js";
import { toBoard, fromBoard } from "../../geometry/stroke.js";
import { isPalm } from "../../edit/hold.js";

const guard = (fn) => { try { fn(); } catch (e) { console.error(e); } };

const TAP_MOVE_PX = 10;
const TAP_MS = 500;

export class KfBoardElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    /** @type {Renderer|null} */
    this.renderer = null;
    this._frameEl = null;
    this._canvas = null;
    this._down = null;
    this._ro = null;
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onCancel = this._onCancel.bind(this);
    this._onSession = () => this.renderer?.wake();
    this._onContext = (e) => e.preventDefault();
    this._onResize = () => this._resize();
  }

  /** Builds the board for these services ({store, engine, audio, session, ...}). */
  connect(services) {
    if (this.services) this._teardown();
    this.services = services;
    this.textContent = "";
    const frame = document.createElement("div");
    frame.className = "kf-board-frame";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    frame.append(canvas);
    this.append(frame);
    this._frameEl = frame;
    this._canvas = canvas;
    this.renderer = new Renderer(canvas, { store: services.store, engine: services.engine });

    frame.addEventListener("pointerdown", this._onDown);
    frame.addEventListener("pointermove", this._onMove);
    frame.addEventListener("pointerup", this._onUp);
    frame.addEventListener("pointercancel", this._onCancel);
    frame.addEventListener("lostpointercapture", this._onCancel);
    this.addEventListener("contextmenu", this._onContext);
    services.session?.addEventListener?.("change", this._onSession);

    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(frame);
    window.addEventListener("resize", this._onResize);
    this._resize();
    this.renderer.wake();
  }

  disconnectedCallback() {
    this._teardown();
  }

  // ---------- coordinate helpers ----------
  /** Client rect of the 4:3 board. */
  boardRect() {
    return (this._frameEl ?? this).getBoundingClientRect();
  }

  /** Client px → board coords [x, y] (0..1). */
  toBoard(clientX, clientY) {
    return toBoard(clientX, clientY, this.boardRect());
  }

  /** Board coords → client px [x, y]. */
  toClient(x, y) {
    return fromBoard(x, y, this.boardRect());
  }

  /** Client rect of a thing where it is drawn now (for edit badges), or null. */
  actorRect(thingId) {
    const b = this.renderer?.actorBounds(thingId);
    if (!b) return null;
    const r = this.boardRect();
    return new DOMRect(r.left + b.x * r.width, r.top + b.y * r.height, b.w * r.width, b.h * r.height);
  }

  // ---------- internals ----------
  _resize() {
    if (!this._frameEl || !this.renderer) return;
    const r = this._frameEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setSize(r.width, r.height, dpr);
    // hit targets at least 120 CSS px across (US-5.1), in board widths
    const engine = this.services?.engine;
    if (engine) engine.hitMinRadius = 60 / r.width;
  }

  _mode() {
    return this.services?.session?.state?.mode ?? this.services?.engine?.mode ?? "play";
  }

  _onDown(e) {
    if (!e.isPrimary) return;
    if (isPalm(e)) return;
    const s = this.services;
    if (!s) return;
    // Each step is guarded so a failure in one (audio on an odd device, say) never eats the tap.
    guard(() => s.audio?.unlock?.()); // synchronously, inside the gesture (iPad audio rules)
    guard(() => s.engine?.fingerDown?.(true));
    this._down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false };
    try { this._frameEl.setPointerCapture(e.pointerId); } catch {}
    guard(() => s.session?.holdStart?.(e, this));
    if (this._mode() === "play") {
      const [x, y] = this.toBoard(e.clientX, e.clientY);
      s.engine?.tap?.(x, y);
      s.session?.playTap?.();
    }
    this.renderer?.wake();
  }

  _onMove(e) {
    const d = this._down;
    if (!d || e.pointerId !== d.id) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE_PX) d.moved = true;
  }

  _onUp(e) {
    const d = this._down;
    if (!d || e.pointerId !== d.id) return;
    this._down = null;
    const s = this.services;
    s.engine?.fingerDown?.(false);
    const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE_PX;
    if (!moved && e.timeStamp - d.t < TAP_MS && this._mode() === "edit") {
      const [x, y] = this.toBoard(e.clientX, e.clientY);
      const thingId = s.engine?.pick?.(x, y) ?? null;
      if (thingId) this.dispatchEvent(new CustomEvent("kf-thing-tap", { bubbles: true, composed: true, detail: { thingId } }));
    }
    this.renderer?.wake();
  }

  _onCancel(e) {
    const d = this._down;
    if (!d || (e.pointerId !== undefined && e.pointerId !== d.id)) return;
    this._down = null;
    this.services?.engine?.fingerDown?.(false);
    this.renderer?.wake();
  }

  _teardown() {
    this._ro?.disconnect();
    this._ro = null;
    window.removeEventListener("resize", this._onResize);
    this.services?.session?.removeEventListener?.("change", this._onSession);
    this.removeEventListener("contextmenu", this._onContext);
    this.renderer?.destroy();
    this.renderer = null;
    if (this._canvas) { this._canvas.width = 0; this._canvas.height = 0; }
    this._frameEl?.remove();
    this._frameEl = null;
    this._canvas = null;
    this.services = null;
  }
}
