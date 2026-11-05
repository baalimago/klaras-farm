// <kf-board>: the child's felt board. A 4:3 letterboxed canvas, the Renderer, and pointer handling.
// Pointer rules (US-5.1, US-11.1): primary pointer only, palms ignored, no scrolling or context menu.
// Play: a tap reacts on pointerdown (same frame, sound under 50 ms). Edit: a short tap picks a thing
// and dispatches `kf-thing-tap` {thingId} for the edit layer; pressing a thing and moving drags it
// (US-11.3): the thing follows the finger 1:1 from the first pixel (engine.grab / dragTo, drawn in
// the renderer's next frame, board rect read once per drag), and the store is written once, on release.
// Drag events: `kf-thing-grab` {thingId} once the press has moved past the tap slop, `kf-thing-drop` {thingId}.
// Resize (edit mode, driven by the selection ring's handle in <kf-edit-layer>): resizeStart /
// resizeTo / resizeEnd. The thing grows or shrinks about its feet under the finger (engine.grabResize /
// resizeTo, a scaled sprite in the renderer's next frame; the scale is edit/selection.js
// resizeGestureTo: the finger's distance from the feet over its distance at the start, clamped by
// geometry/transform.js clampThingScale), and the store is written once, on release (scaledThingPatch:
// outline, eyes and legs, then movedThingPatch if the thing was off its home), so the saved thing is
// where the preview showed it. A failed write is reported like any other (reportFailure: a toast).
// Event: `kf-thing-resized` {thingId}.
import { Renderer } from "../../io/renderer.js";
import { toBoard, fromBoard } from "../../geometry/stroke.js";
import { movedThingPatch, scaledThingPatch } from "../../geometry/transform.js";
import { isPalm } from "../../edit/hold.js";
import { resizeGesture, resizeGestureTo } from "../../edit/selection.js";
import { editSound } from "../kf-dialog/feedback.js";
import { reportFailure } from "../kf-dialog/dom.js";

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
    this._drag = null; // edit mode: {id, rect, cx, cy, x, y, lifted}
    this._sizing = null; // edit mode: a resize gesture (edit/selection.js resizeGesture) or null
    this._ro = null;
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onCancel = this._onCancel.bind(this);
    this._onSession = () => this.renderer?.wake();
    this._onSpread = (e) => this._saveSpread(e.detail?.moves ?? []);
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
    services.engine?.addEventListener?.("spread", this._onSpread);

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

  /**
   * Scene tools: draw one scene piece moved/scaled (board units) until setLift(null). See Renderer.setLift.
   * @param {{id: string, dx?: number, dy?: number, s?: number, cx?: number, cy?: number} | null} lift
   */
  setLift(lift) {
    this.renderer?.setLift(lift);
  }

  /** Client rect of a thing where it is drawn now (for edit badges), or null. */
  actorRect(thingId) {
    const b = this.renderer?.actorBounds(thingId);
    if (!b) return null;
    const r = this.boardRect();
    return new DOMRect(r.left + b.x * r.width, r.top + b.y * r.height, b.w * r.width, b.h * r.height);
  }

  // ---------- resize (edit mode) ----------
  /**
   * Starts resizing a thing from a press at (clientX, clientY), usually on its resize handle.
   * Returns the pivot (its feet) in client px [x, y], or null when it cannot (not edit mode, a panel
   * is open, a drag or resize is going on, no such thing).
   */
  resizeStart(thingId, clientX, clientY) {
    const s = this.services;
    const engine = s?.engine;
    if (this._drag || this._sizing || typeof engine?.grabResize !== "function") return null;
    if (this._mode() !== "edit" || s.session?.state?.panel) return null;
    const thing = s.store?.snapshot?.things?.find((t) => t.id === thingId);
    if (!thing) return null;
    const start = engine.grabResize(thingId);
    if (!start) return null;
    const rect = this.boardRect(); // once per resize: no layout reads while it changes
    const pivot = [rect.left + start.px * rect.width, rect.top + start.py * rect.height];
    this._sizing = resizeGesture(thingId, thing, pivot, [clientX, clientY]);
    editSound(s, "pick");
    this.renderer?.wake();
    return pivot;
  }

  /** Follows the finger: shows the thing at the clamped scale for (clientX, clientY) and returns it. */
  resizeTo(clientX, clientY) {
    if (!this._sizing) return 1;
    const r = (this._sizing = resizeGestureTo(this._sizing, [clientX, clientY]));
    this.services?.engine?.resizeTo?.(r.s);
    return r.s;
  }

  /**
   * Lets go: with `commit`, one store write of the resized thing; without (a cancelled pointer), it
   * goes back to its size. Returns the saved scale, or null when nothing changed.
   */
  resizeEnd(commit = true) {
    const r = this._sizing;
    this._sizing = null;
    const s = this.services;
    if (!r || !s?.engine) return null;
    const out = s.engine.release?.(commit) ?? null;
    this.renderer?.wake();
    if (!out) return null;
    editSound(s, "drop");
    const thing = s.store?.snapshot?.things?.find((t) => t.id === r.id);
    if (thing) {
      let patch = scaledThingPatch(thing, out.s);
      if (out.dx || out.dy) patch = movedThingPatch({ ...thing, ...patch }, out.dx, out.dy);
      guard(() => s.store.updateThing({ thingId: r.id, patch }).catch((err) => reportFailure(s, err)));
    }
    this.dispatchEvent(new CustomEvent("kf-thing-resized", { bubbles: true, composed: true, detail: { thingId: r.id } }));
    return out.s;
  }

  /** The thing being resized, or null. */
  get resizing() { return this._sizing?.id ?? null; }

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
    } else if (this._mode() === "edit" && !s.session?.state?.panel) {
      guard(() => this._grab(e));
    }
    this.renderer?.wake();
  }

  /** Edit mode: a press on a thing picks it up (it follows the finger from the first pixel). */
  _grab(e) {
    const engine = this.services?.engine;
    if (typeof engine?.grab !== "function") return;
    const rect = this.boardRect(); // once per drag: no layout reads while moving
    const id = engine.pick?.((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    const start = id ? engine.grab(id) : null;
    if (!start) return;
    this._drag = { id, rect, cx: e.clientX, cy: e.clientY, x: start.x, y: start.y, lifted: false };
  }

  /** Follows the pointer exactly: the newest position wins (coalesced events add nothing to a drag). */
  _dragTo(clientX, clientY) {
    const g = this._drag;
    this.services?.engine?.dragTo?.(g.x + (clientX - g.cx) / g.rect.width, g.y + (clientY - g.cy) / g.rect.height);
    if (!g.lifted && Math.hypot(clientX - g.cx, clientY - g.cy) > TAP_MOVE_PX) {
      g.lifted = true;
      editSound(this.services, "pick");
      this.dispatchEvent(new CustomEvent("kf-thing-grab", { bubbles: true, composed: true, detail: { thingId: g.id } }));
    }
  }

  /** Puts a dragged thing down: one store write. A press that never left the tap slop goes back. */
  _drop(commit) {
    const g = this._drag;
    this._drag = null;
    const s = this.services;
    const engine = s?.engine;
    if (!g || !engine) return;
    if (!g.lifted || !commit) {
      engine.release?.(false);
      return;
    }
    const d = engine.release?.(true);
    editSound(s, "drop");
    this.dispatchEvent(new CustomEvent("kf-thing-drop", { bubbles: true, composed: true, detail: { thingId: g.id } }));
    const thing = s.store?.snapshot?.things?.find((t) => t.id === g.id);
    if (!d || !thing || (d.dx === 0 && d.dy === 0)) return;
    s.store.updateThing({ thingId: g.id, patch: movedThingPatch(thing, d.dx, d.dy) }).catch((err) => console.error(err));
  }

  /**
   * Edit mode spread things apart (play/world.js spreadActors): save each move like a drop, so the
   * layout sticks across scenes and reloads. The engine already shows the glide.
   */
  _saveSpread(moves) {
    const s = this.services;
    for (const m of moves) {
      const thing = s?.store?.snapshot?.things?.find((t) => t.id === m.thingId);
      if (!thing) continue;
      guard(() => s.store.updateThing({ thingId: m.thingId, patch: movedThingPatch(thing, m.dx, m.dy) }).catch((err) => console.error(err)));
    }
  }

  _onMove(e) {
    const d = this._down;
    if (!d || e.pointerId !== d.id) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE_PX) d.moved = true;
    if (this._drag) guard(() => this._dragTo(e.clientX, e.clientY));
  }

  _onUp(e) {
    const d = this._down;
    if (!d || e.pointerId !== d.id) return;
    this._down = null;
    const s = this.services;
    s.engine?.fingerDown?.(false);
    if (this._drag) {
      const lifted = this._drag.lifted;
      guard(() => this._dragTo(e.clientX, e.clientY));
      guard(() => this._drop(true));
      if (lifted) return void this.renderer?.wake();
    }
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
    guard(() => this._drop(false));
    this.services?.engine?.fingerDown?.(false);
    this.renderer?.wake();
  }

  _teardown() {
    this._ro?.disconnect();
    this._ro = null;
    window.removeEventListener("resize", this._onResize);
    this.services?.session?.removeEventListener?.("change", this._onSession);
    this.services?.engine?.removeEventListener?.("spread", this._onSpread);
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
