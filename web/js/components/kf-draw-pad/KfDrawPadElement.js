// <kf-draw-pad>: a full-board overlay for drawing one stroke at a time (US-2.2, US-3.1).
//   mode = 'outline' | 'shape' | 'yarn'   (attribute or property)
//   color = palette key for the live line (default ink)
// Emits (bubbling, composed):
//   kf-stroke       {points, closed}   board coords, simplified and smoothed; outline/shape are closed loops
//   kf-stroke-open  {points, gap:{a,b}}  outline/shape whose ends are too far apart; both ends stay highlighted
//                   until the next stroke or clear() (a listener that accepts the stroke calls clear())
//   kf-tap          {point}           a touch too short to be a stroke (shape editing selects with it)
// Placement: with `services.board` (and no `inline` attribute) it sits exactly over the board; otherwise it
// fills its own box and treats the largest centred 4:3 rect in it as the board.
import { hex, INK } from "../../farm/palette.js";
import { roundPoints } from "../../farm/snapshot.js";
import { simplify, smooth, closeGap, pathLength, toBoard, fromBoard, fitRect } from "../../geometry/stroke.js";

const PALM_PX = 140; // both sides: iPad fingertips report 40–90 px contacts
const MIN_LENGTH = 0.01; // board units; shorter strokes are taps and ignored
const HIGHLIGHT = "#ff8a5b";

export class KfDrawPadElement extends HTMLElement {
  static get observedAttributes() { return ["mode", "color"]; }

  constructor() {
    super();
    this._services = null;
    this.params = null;
    this._canvas = null;
    this._ctx = null;
    this._stroke = null; // {id, type, pts: board points, last: [cx, cy]}
    this._gap = null;
    this._rect = null;
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onCancel = this._onCancel.bind(this);
    this._onResize = () => this._layout();
    this._onContext = (e) => e.preventDefault();
  }

  get services() { return this._services; }
  set services(v) {
    this._services = v;
    if (this.isConnected) this._layout();
  }

  get mode() {
    const m = this.getAttribute("mode");
    return m === "shape" || m === "yarn" ? m : "outline";
  }
  set mode(v) { this.setAttribute("mode", v); }

  get color() { return this.getAttribute("color") || ""; }
  set color(v) { if (v) this.setAttribute("color", v); else this.removeAttribute("color"); }

  attributeChangedCallback() {}

  connectedCallback() {
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      this._canvas.setAttribute("aria-hidden", "true");
      this._ctx = this._canvas.getContext("2d");
    }
    if (!this._canvas.isConnected) this.append(this._canvas);
    this.addEventListener("pointerdown", this._onDown);
    this.addEventListener("pointermove", this._onMove);
    this.addEventListener("pointerup", this._onUp);
    this.addEventListener("pointercancel", this._onCancel);
    this.addEventListener("contextmenu", this._onContext);
    window.addEventListener("resize", this._onResize);
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(this);
    this._layout();
  }

  disconnectedCallback() {
    this.removeEventListener("pointerdown", this._onDown);
    this.removeEventListener("pointermove", this._onMove);
    this.removeEventListener("pointerup", this._onUp);
    this.removeEventListener("pointercancel", this._onCancel);
    this.removeEventListener("contextmenu", this._onContext);
    window.removeEventListener("resize", this._onResize);
    this._ro?.disconnect();
    this._stroke = null;
  }

  /** Clears the live stroke and any highlighted gap. */
  clear() {
    this._stroke = null;
    this._gap = null;
    this._repaint();
  }

  /** Client rect of the board this pad draws on. */
  boardRect() {
    const board = this._overlayBoard();
    if (board) return board.boardRect();
    const r = this.getBoundingClientRect();
    return fitRect(r.width, r.height, 4 / 3, r.left, r.top);
  }

  // ---------- layout ----------
  _overlayBoard() {
    const b = this._services?.board;
    return b && typeof b.boardRect === "function" && !this.hasAttribute("inline") ? b : null;
  }

  _layout() {
    const board = this._overlayBoard();
    if (board) {
      const r = board.boardRect();
      this.dataset.overlay = "";
      Object.assign(this.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    } else if ("overlay" in this.dataset) {
      delete this.dataset.overlay;
      for (const k of ["left", "top", "width", "height"]) this.style[k] = "";
    }
    const r = this.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this._canvas && (this._canvas.width !== w || this._canvas.height !== h)) {
      this._canvas.width = w;
      this._canvas.height = h;
    }
    this._dpr = dpr;
    this._repaint();
  }

  // ---------- pointer ----------
  _onDown(e) {
    if (!e.isPrimary || this._stroke) return;
    if (e.pointerType === "touch" && (e.width > PALM_PX && e.height > PALM_PX)) return;
    e.preventDefault();
    try { this.setPointerCapture(e.pointerId); } catch {}
    this._gap = null;
    this._rect = this.boardRect();
    this._origin = this.getBoundingClientRect();
    this._stroke = { id: e.pointerId, pts: [toBoard(e.clientX, e.clientY, this._rect)], last: [e.clientX, e.clientY] };
    this._repaint();
  }

  _onMove(e) {
    const s = this._stroke;
    if (!s || e.pointerId !== s.id) return;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    const c = this._ctx, o = this._origin, k = this._dpr;
    c.setTransform(k, 0, 0, k, -o.left * k, -o.top * k);
    c.strokeStyle = this.color ? hex(this.color) : INK;
    c.lineWidth = 4;
    c.lineCap = c.lineJoin = "round";
    c.beginPath();
    c.moveTo(s.last[0], s.last[1]);
    for (const ev of list) {
      s.pts.push(toBoard(ev.clientX, ev.clientY, this._rect));
      c.lineTo(ev.clientX, ev.clientY);
      s.last = [ev.clientX, ev.clientY];
    }
    c.stroke();
  }

  _onUp(e) {
    const s = this._stroke;
    if (!s || e.pointerId !== s.id) return;
    this._stroke = null;
    s.pts.push(toBoard(e.clientX, e.clientY, this._rect));
    this._finish(s.pts);
  }

  _onCancel(e) {
    if (this._stroke && e.pointerId === this._stroke.id) this.clear();
  }

  /** Turns raw board points into a stroke event. */
  _finish(raw) {
    if (pathLength(raw) < MIN_LENGTH) {
      this.clear();
      this._emit("kf-tap", { point: raw[0] });
      return;
    }
    if (this.mode === "yarn") {
      const pts = dedupe(roundPoints(simplify(smooth(simplify(raw, 0.002), 2), 0.0008)));
      this.clear();
      if (pts.length >= 2) this._emit("kf-stroke", { points: pts, closed: false });
      return;
    }
    const base = simplify(raw, 0.0015);
    const r = closeGap(base);
    if (r.closed) {
      const pts = dedupe(roundPoints(simplify(smooth(r.points, 2, true), 0.0008)), true);
      this.clear();
      if (pts.length >= 3) this._emit("kf-stroke", { points: pts, closed: true });
      return;
    }
    this._gap = r.gap;
    this._openPoints = base;
    this._repaint();
    this._emit("kf-stroke-open", { points: roundPoints(base), gap: r.gap });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }

  _repaint() {
    const c = this._ctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this._canvas.width, this._canvas.height);
    if (!this._gap) return;
    // the open stroke stays visible, with both ends highlighted ("close the outline")
    const rect = this.boardRect(), o = this.getBoundingClientRect(), k = this._dpr || 1;
    c.setTransform(k, 0, 0, k, -o.left * k, -o.top * k);
    c.strokeStyle = this.color ? hex(this.color) : INK;
    c.lineWidth = 4;
    c.lineCap = c.lineJoin = "round";
    c.beginPath();
    (this._openPoints ?? []).forEach(([x, y], i) => {
      const [cx, cy] = fromBoard(x, y, rect);
      if (i) c.lineTo(cx, cy); else c.moveTo(cx, cy);
    });
    c.stroke();
    c.strokeStyle = HIGHLIGHT;
    c.fillStyle = "rgba(255,138,91,.25)";
    c.lineWidth = 4;
    for (const p of [this._gap.a, this._gap.b]) {
      const [cx, cy] = fromBoard(p[0], p[1], rect);
      c.beginPath();
      c.arc(cx, cy, 16, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
}

function dedupe(pts, closed = false) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  if (closed && out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}
