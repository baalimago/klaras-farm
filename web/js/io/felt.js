// Felt painter: everything slow (texture, shadows, dashed stitches, clipping) happens here, once,
// into caches. The Renderer only blits the results. Look: design/sketches/final.html (Sunny).
// Coordinates: callers pass a size {w, h} in canvas pixels; board points [x, y] map to [x*w, y*h].
import { hex, INK, SUNNY } from "../farm/palette.js";
import { bbox, centroid, signedArea } from "../geometry/stroke.js";

export const STITCH = "rgba(255,248,235,.75)";
export const BUTTON = "#2b211b";
export const BUTTON_HOLE = "#e9dcc6";
export const CONFETTI = ["red", "sun", "blue", "leaf", "pink"];

// ---------- small utilities ----------
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** iOS caps total canvas memory: free a canvas we no longer need. */
export function releaseCanvas(c) {
  if (c) { c.width = 0; c.height = 0; }
}

/** Darken (f < 1) or lighten (f > 1) a #rrggbb colour. */
export function shade(color, f) {
  const n = parseInt(color.slice(1), 16);
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// ---------- the felt texture tile (made once per document) ----------
let tile = null;
export function feltTile() {
  if (tile) return tile;
  const size = 140;
  tile = makeCanvas(size, size);
  const g = tile.getContext("2d");
  const r = mulberry(5);
  for (let i = 0; i < 1500; i++) {
    const a = 0.42 * r();
    g.fillStyle = r() > 0.3 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    const w = 1 + r() * 2.5;
    g.save();
    g.translate(r() * size, r() * size);
    g.rotate(r() * 3);
    g.fillRect(0, 0, w * 2, 0.8);
    g.restore();
  }
  return tile;
}

function feltPattern(c, U) {
  const p = c.createPattern(feltTile(), "repeat");
  const k = Math.max(1, U / 1.6);
  if (p && k !== 1 && typeof p.setTransform === "function" && typeof DOMMatrix === "function") p.setTransform(new DOMMatrix().scale(k));
  return p;
}

// ---------- paths ----------
/** A closed path through edge midpoints (soft corners), or straight segments for few points. */
export function smoothPath(c, pts, closed, straight = false) {
  c.beginPath();
  const n = pts.length;
  if (n === 0) return;
  if (n <= 6 || straight) {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (closed) c.closePath();
    return;
  }
  if (closed) {
    c.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    c.closePath();
  } else {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) c.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    c.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}

/** Polygon offset inward by d (vertex normals with a limited miter). */
export function insetPolygon(pts, d) {
  const n = pts.length;
  const s = signedArea(pts) > 0 ? 1 : -1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let e1x = p[0] - a[0], e1y = p[1] - a[1], e2x = b[0] - p[0], e2y = b[1] - p[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    const n1x = -e1y * s, n1y = e1x * s, n2x = -e2y * s, n2y = e2x * s;
    let nx = n1x + n2x, ny = n1y + n2y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const k = d / Math.max(0.4, nx * n1x + ny * n1y);
    out[i] = [p[0] + nx * k, p[1] + ny * k];
  }
  return out;
}

// ---------- felt pieces ----------
/**
 * A felt shape: fill, fabric texture, optional soft drop shadow and inset dashed stitch.
 * Slow (shadowBlur, dashes, clip): only for caches.
 */
export function paintFeltShape(c, pts, fill, { U = 1, shadow = true, stitch = true, straight = false } = {}) {
  if (pts.length < 3) return;
  c.save();
  if (shadow) {
    c.shadowColor = "rgba(50,30,15,.22)";
    c.shadowBlur = 6 * U;
    c.shadowOffsetY = 3 * U;
  }
  c.fillStyle = fill;
  smoothPath(c, pts, true, straight);
  c.fill();
  c.restore();
  c.save();
  c.globalAlpha = 0.4;
  c.fillStyle = feltPattern(c, U);
  smoothPath(c, pts, true, straight);
  c.fill();
  c.restore();
  if (stitch) {
    const b = bbox(pts);
    const d = 5 * U;
    if (Math.min(b.w, b.h) > d * 4) {
      c.save();
      smoothPath(c, pts, true, straight);
      c.clip();
      c.setLineDash([4 * U, 3.5 * U]);
      c.strokeStyle = STITCH;
      c.lineWidth = 1.4 * U;
      c.lineJoin = "round";
      smoothPath(c, insetPolygon(pts, d), true, straight);
      c.stroke();
      c.restore();
    }
  }
}

/** A yarn line: soft shadow, the yarn, and a dashed highlight for the twist. */
export function paintYarn(c, pts, color, { U = 1, w = 1 } = {}) {
  if (pts.length < 2) return;
  c.save();
  c.lineCap = c.lineJoin = "round";
  c.strokeStyle = "rgba(40,25,10,.25)";
  c.lineWidth = 5 * w * U;
  c.translate(0, 2 * U);
  smoothPath(c, pts, false);
  c.stroke();
  c.translate(0, -2 * U);
  c.strokeStyle = color;
  c.lineWidth = 4 * w * U;
  smoothPath(c, pts, false);
  c.stroke();
  c.setLineDash([2 * U, 3 * U]);
  c.strokeStyle = "rgba(255,255,255,.25)";
  c.lineWidth = 1.2 * U;
  smoothPath(c, pts, false);
  c.stroke();
  c.restore();
}

function blob(cx, cy, rx, ry, r, n = 30, wob = 0.1, fluffy = 0) {
  const p1 = r() * 6.28, p2 = r() * 6.28, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob * (Math.sin(a * 2 + p1) * 0.5 + Math.sin(a * 3 + p2) * 0.3) + fluffy * Math.abs(Math.sin(a * 5.5));
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

function wavyBand(w, h, y0, amp, freq, phase = 0, step = 24) {
  const pts = [];
  for (let x = 0; x <= w + step; x += step) pts.push([Math.min(x, w), h * y0 + Math.sin((x / w) * freq + phase) * amp]);
  pts.push([w, h], [0, h]);
  return pts;
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/**
 * Paints a place: sky, backdrop ground (meadow, sea, room, blank), felt clouds, the scene pieces and the
 * stitched border. `scene: true` adds dashed outlines on pieces (scene tools). Used for the board's
 * background cache and for scene thumbnails.
 * @param {CanvasRenderingContext2D} c
 * @param {import('../types.js').Place} place
 * @param {{w:number, h:number}} size  canvas pixels
 * @param {{scene?: boolean, border?: boolean}} [opts]
 */
export function paintBackground(c, place, size, { scene = false, border = true } = {}) {
  const { w, h } = size;
  const U = h / 600;
  const sky = hex(place?.skyColor ?? "sky");
  const ground = hex(place?.groundColor ?? "grass");
  const r = mulberry(seedOf(place?.id ?? "place"));
  const base = { U, shadow: false, stitch: false, straight: true };
  c.save();
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  switch (place?.backdrop) {
    case "sea": {
      paintFeltShape(c, rect(0, 0, w, h), ground, base);
      paintFeltShape(c, rect(0, 0, w, h * 0.1), sky, base);
      paintFeltShape(c, wavyBand(w, h, 0.45, 8 * U, 7), shade(ground, 0.88), base);
      paintFeltShape(c, wavyBand(w, h, 0.83, h * 0.015, 4, 1), SUNNY.sand, base);
      const wave = [];
      for (let x = 0; x <= w; x += 16 * U) wave.push([x, h * 0.1 + Math.sin(x / (22 * U)) * 3 * U]);
      paintYarn(c, wave, SUNNY.white, { U, w: 0.4 });
      break;
    }
    case "room": {
      paintFeltShape(c, rect(0, 0, w, h), sky, base);
      paintFeltShape(c, rect(0, h * 0.62, w, h), ground, base);
      c.strokeStyle = shade(ground, 0.88);
      c.lineWidth = 2 * U;
      c.beginPath();
      for (let k = 1; k < 8; k++) {
        c.moveTo((w * k) / 8, h * 0.62);
        c.lineTo(w * (k / 8 - 0.5) * 1.6 + w * 0.5, h);
      }
      c.moveTo(0, h * 0.76);
      c.lineTo(w, h * 0.76);
      c.stroke();
      paintYarn(c, [[0, h * 0.62], [w, h * 0.62]], shade(sky, 0.85), { U, w: 0.8 });
      break;
    }
    case "blank": {
      paintFeltShape(c, rect(0, 0, w, h), sky, base);
      paintFeltShape(c, rect(0, h * 0.72, w, h), ground, base);
      paintClouds(c, w, h, U, r);
      break;
    }
    case "meadow":
    default: {
      paintFeltShape(c, rect(0, 0, w, h), sky, base);
      paintFeltShape(c, wavyBand(w, h, 0.5, h * 0.03, 5), ground, base);
      paintClouds(c, w, h, U, r);
    }
  }
  for (const piece of place?.pieces ?? []) {
    const pts = piece.stroke.map(([x, y]) => [x * w, y * h]);
    if (piece.kind === "yarn") paintYarn(c, pts, hex(piece.color), { U, w: 1.8 });
    else paintFeltShape(c, pts, hex(piece.color), { U });
  }
  if (scene) {
    c.save();
    c.setLineDash([6 * U, 5 * U]);
    c.strokeStyle = INK;
    c.globalAlpha = 0.7;
    c.lineWidth = 2 * U;
    c.lineCap = c.lineJoin = "round";
    for (const piece of place?.pieces ?? []) {
      const pts = piece.stroke.map(([x, y]) => [x * w, y * h]);
      smoothPath(c, pts, piece.kind === "shape");
      c.stroke();
    }
    c.restore();
  }
  if (border) paintBorder(c, w, h, U);
  c.restore();
}

function paintClouds(c, w, h, U, r) {
  const cloud = hex("cloud");
  paintFeltShape(c, blob(w * 0.2, h * 0.12, w * 0.07, h * 0.035, r, 34, 0.1, 0.12), cloud, { U });
  paintFeltShape(c, blob(w * 0.56, h * 0.08, w * 0.05, h * 0.026, r, 30, 0.1, 0.12), cloud, { U });
}

/** The stitched border around the board. */
export function paintBorder(c, w, h, U) {
  c.save();
  c.setLineDash([7 * U, 6 * U]);
  c.strokeStyle = "rgba(255,250,240,.8)";
  c.lineWidth = 2.2 * U;
  const m = 14 * U;
  c.beginPath();
  if (c.roundRect) c.roundRect(m, m, w - 2 * m, h - 2 * m, 16 * U);
  else c.rect(m, m, w - 2 * m, h - 2 * m);
  c.stroke();
  c.restore();
}

/**
 * Pre-renders a thing's felt body (fill, texture, inset stitch, soft shadow) once.
 * Eyes and legs are not baked: they move, so the Renderer draws them per frame.
 * @param {import('../types.js').Thing} thing
 * @param {number} pxPerBoardUnit  CSS px per board x unit, i.e. the board's CSS width (y uses 3/4 of it)
 * @param {number} [dpr]
 * @returns {{canvas: HTMLCanvasElement, ax: number, ay: number, ox: number, oy: number}}
 *   ax, ay: the anchor (outline centroid) in sprite px; ox, oy: the sprite's top-left in board px
 */
export function paintThingSprite(thing, pxPerBoardUnit, dpr = 1) {
  const W = pxPerBoardUnit * dpr, H = W * 0.75, U = H / 600;
  const pts = thing.outline.map(([x, y]) => [x * W, y * H]);
  const b = bbox(pts);
  const pad = Math.ceil(12 * U) + 2;
  const canvas = makeCanvas(b.w + 2 * pad, b.h + 2 * pad);
  const c = canvas.getContext("2d");
  const ox = b.x - pad, oy = b.y - pad;
  c.translate(-ox, -oy);
  paintFeltShape(c, pts, hex(thing.color), { U });
  const [cx, cy] = centroid(thing.outline);
  return { canvas, ax: cx * W - ox, ay: cy * H - oy, ox, oy };
}

// ---------- small shared sprites ----------
export const EYE_SPRITE_R = 32;
let eye = null;
/** A felt button eye (four holes) of radius EYE_SPRITE_R, centred in its canvas. */
export function eyeSprite() {
  if (eye) return eye;
  const R = EYE_SPRITE_R;
  eye = makeCanvas(R * 2, R * 2);
  const c = eye.getContext("2d");
  c.fillStyle = BUTTON;
  c.beginPath();
  c.arc(R, R, R * 0.96, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,.18)";
  c.lineWidth = R * 0.1;
  c.beginPath();
  c.arc(R, R, R * 0.7, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = BUTTON_HOLE;
  for (const [a, b] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) {
    c.beginPath();
    c.arc(R + a * R, R + b * R, R * 0.14, 0, Math.PI * 2);
    c.fill();
  }
  return eye;
}

let groundShadow = null;
/** A soft contact shadow (radial gradient, no blur), 128 × 32. */
export function groundShadowSprite() {
  if (groundShadow) return groundShadow;
  groundShadow = makeCanvas(128, 32);
  const c = groundShadow.getContext("2d");
  c.translate(64, 16);
  c.scale(1, 0.25);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 64);
  g.addColorStop(0, "rgba(30,30,40,.22)");
  g.addColorStop(1, "rgba(30,30,40,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 64, 0, Math.PI * 2);
  c.fill();
  return groundShadow;
}

/** Felt confetti dots (one sprite per colour) of radius r px. */
export function confettiSprites(r) {
  return CONFETTI.map((key) => {
    const s = makeCanvas(r * 2 + 2, r * 2 + 2);
    const c = s.getContext("2d");
    c.translate(r + 1, r + 1);
    c.fillStyle = hex(key);
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.setLineDash([Math.max(1, r * 0.35), Math.max(1, r * 0.35)]);
    c.strokeStyle = "rgba(255,255,255,.6)";
    c.lineWidth = Math.max(1, r * 0.18);
    c.beginPath();
    c.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    c.stroke();
    return s;
  });
}
