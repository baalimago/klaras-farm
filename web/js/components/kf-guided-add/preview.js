// Static felt preview of one thing on a 4:3 canvas (parent UI, redrawn only when data changes).
// Uses package A's io/felt.js paintThingSprite when available, else a flat fill with a stitch line.
// A view {vx, vy, s} maps the board square [vx, vx+s] × [vy, vy+s] (board units) onto the canvas,
// which keeps proportions because the canvas is 4:3 like the board.
import { hex, INK } from "../../farm/palette.js";

export const FULL_VIEW = Object.freeze({ vx: 0, vy: 0, s: 1 });

let feltLoading = null;
function loadFelt() {
  feltLoading ??= import("../../io/felt.js").catch(() => null);
  return feltLoading;
}

/** A view that shows the outline at `fill` of the canvas, its centre at (centerX, 0.5) of the canvas. */
export function viewFor(outline, { fill = 0.5, centerX = 0.5, centerY = 0.5, geo } = {}) {
  if (!outline?.length) return FULL_VIEW;
  const b = geo.bbox(outline);
  const s = Math.max(b.w, b.h, 0.02) / fill;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { vx: cx - centerX * s, vy: cy - centerY * s, s };
}

export class ThingPreview {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, geo) {
    this.canvas = canvas;
    this.geo = geo;
    this.view = FULL_VIEW;
    this._seq = 0;
  }

  setView(view) { this.view = view; }

  /** Client point → board point through the current view. */
  toBoard(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const { vx, vy, s } = this.view;
    return [vx + ((clientX - r.left) / (r.width || 1)) * s, vy + ((clientY - r.top) / (r.height || 1)) * s];
  }

  toClient(x, y) {
    const r = this.canvas.getBoundingClientRect();
    const { vx, vy, s } = this.view;
    return [r.left + ((x - vx) / s) * r.width, r.top + ((y - vy) / s) * r.height];
  }

  /** Eye radius in board-x units. */
  eyeRadius(thing) {
    const b = thing.outline?.length ? this.geo.bbox(thing.outline) : { w: 0.2, h: 0.2 };
    return Math.max(0.008, Math.min(b.w, b.h) * 0.09);
  }

  async draw(thing, { backdrop = true } = {}) {
    const seq = ++this._seq;
    const felt = thing.outline?.length && thing.color ? await loadFelt() : null;
    if (seq !== this._seq) return; // a newer draw started
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round((r.width || 400) * dpr));
    const H = Math.max(1, Math.round((r.height || 300) * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (backdrop) {
      ctx.fillStyle = hex("cream");
      ctx.fillRect(0, 0, W, H);
    }
    const { vx, vy, s } = this.view;
    const X = (x) => ((x - vx) / s) * W;
    const Y = (y) => ((y - vy) / s) * H;
    const outline = thing.outline;
    if (!outline?.length) return;

    let painted = false;
    if (felt?.paintThingSprite) {
      try {
        const sprite = felt.paintThingSprite({ ...thing, eyes: [] }, W / s / dpr, dpr);
        const [cx, cy] = this.geo.centroid(outline);
        ctx.drawImage(sprite.canvas, X(cx) - sprite.ax, Y(cy) - sprite.ay);
        painted = true;
      } catch {
        painted = false;
      }
    }
    if (!painted) {
      ctx.beginPath();
      outline.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
      ctx.fillStyle = thing.color ? hex(thing.color) : "rgba(255,255,255,0.6)";
      ctx.fill();
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = thing.color ? "rgba(74,51,38,0.35)" : INK;
      if (thing.color) ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const er = (this.eyeRadius(thing) / s) * W;
    for (const e of thing.eyes ?? []) {
      ctx.beginPath();
      ctx.arc(X(e.x), Y(e.y), er, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = Math.max(1, er * 0.18);
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(e.x), Y(e.y), er * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
  }
}
