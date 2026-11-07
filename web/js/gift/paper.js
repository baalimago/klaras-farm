// Painting the wrapping paper: a base colour, an optional watercolour wash, a printed motif,
// and a ribbon with a bow. It draws onto any CanvasRenderingContext2D-like object it is given
// (in CSS pixels) and touches nothing else, so it runs the same in a test with a fake context.
// The same seed paints the same paper, so a rotation repaints it without a visible jump.

/**
 * @typedef {{
 *   base: string, back: string, wash?: string[], ink: string[],
 *   motif: 'dots'|'leaves'|'stars'|'confetti'|'stripes',
 *   ribbon: string, ribbonShade: string, ribbonShine: string, confetti?: string[]
 * }} PaperTheme
 *   back: the paper's white underside, seen along every tear and on falling pieces
 */

/** @type {Record<string, PaperTheme>} */
export const THEMES = Object.freeze({
  classic: {
    base: "#d8434f", back: "#fbf7ef", ink: ["#fff4e6", "#ffcf5a"], motif: "dots",
    ribbon: "#ffcf5a", ribbonShade: "#d9a227", ribbonShine: "#fff0b8",
  },
  // Watercolour autumn, to sit with Klara's Farm's splash: cream paper, washes of rust, mustard and
  // sage, little falling leaves, and a berry-red ribbon.
  autumn: {
    base: "#f6e7d2", back: "#fffaf2",
    wash: ["#e8a27a", "#e2b85f", "#a9c391", "#e0928a"],
    ink: ["#c4643f", "#d49c34", "#7d9c64", "#b24f47"], motif: "leaves",
    ribbon: "#b8473f", ribbonShade: "#8a322d", ribbonShine: "#e9897c",
    confetti: ["#c4643f", "#e2b85f", "#7d9c64", "#e0928a", "#8fc1d9", "#fffaf2"],
  },
  starry: {
    base: "#2f4a8a", back: "#f7f5ff", ink: ["#ffe27a", "#ffffff"], motif: "stars",
    ribbon: "#ff8fb8", ribbonShade: "#d9668f", ribbonShine: "#ffd0e2",
  },
});

/** A theme by name, a full theme object, or a partial one laid over `classic`. */
export function resolveTheme(theme) {
  if (typeof theme === "string") return THEMES[theme] ?? THEMES.classic;
  return { ...THEMES.classic, ...(theme ?? {}) };
}

/** The confetti colours for a theme. */
export function confettiColours(theme) {
  return theme.confetti ?? [...theme.ink, theme.ribbon, theme.ribbonShine];
}

/** A small seeded generator (mulberry32): the same seed, the same paper. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paint the whole sheet.
 * @param {CanvasRenderingContext2D} ctx  already scaled to CSS pixels
 * @param {number} w @param {number} h
 * @param {PaperTheme} theme
 * @param {() => number} rng
 */
export function paintPaper(ctx, w, h, theme, rng) {
  ctx.fillStyle = theme.base;
  ctx.fillRect(0, 0, w, h);
  if (theme.wash?.length) paintWash(ctx, w, h, theme.wash, rng);
  if (theme.motif === "stripes") paintStripes(ctx, w, h, theme.ink);
  else paintMotifs(ctx, w, h, theme, rng);
  paintRibbon(ctx, w, h, theme);
}

function paintWash(ctx, w, h, colours, rng) {
  const unit = Math.min(w, h);
  const count = 14;
  for (let i = 0; i < count; i++) {
    const x = rng() * w, y = rng() * h, r = unit * (0.18 + rng() * 0.3);
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    const c = colours[i % colours.length];
    g.addColorStop(0, withAlpha(c, 0.32));
    g.addColorStop(0.7, withAlpha(c, 0.14));
    g.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function paintStripes(ctx, w, h, ink) {
  const band = Math.min(w, h) * 0.05;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 4);
  const span = Math.hypot(w, h);
  for (let i = 0, x = -span / 2; x < span / 2; i++, x += band * 2) {
    ctx.fillStyle = ink[i % ink.length];
    ctx.fillRect(x, -span / 2, band, span);
  }
  ctx.restore();
}

function paintMotifs(ctx, w, h, theme, rng) {
  const gap = Math.max(40, Math.min(w, h) * 0.085);
  let k = 0;
  for (let row = 0, y = gap * 0.4; y < h + gap; row++, y += gap * 0.87) {
    const shift = row % 2 ? gap / 2 : 0;
    for (let x = -gap / 2 + shift; x < w + gap; x += gap) {
      const px = x + (rng() - 0.5) * gap * 0.35, py = y + (rng() - 0.5) * gap * 0.35;
      ctx.fillStyle = theme.ink[k++ % theme.ink.length];
      ctx.strokeStyle = ctx.fillStyle;
      motif(ctx, theme.motif, px, py, gap, rng);
    }
  }
}

function motif(ctx, kind, x, y, gap, rng) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rng() * Math.PI * 2);
  if (kind === "leaves") leaf(ctx, gap * (0.34 + rng() * 0.1));
  else if (kind === "stars") star(ctx, gap * (0.16 + rng() * 0.06));
  else if (kind === "confetti") confettiBit(ctx, gap, rng);
  else dot(ctx, gap * (0.11 + rng() * 0.03));
  ctx.restore();
}

function dot(ctx, r) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx, len) {
  const half = len / 2, wide = len * 0.24;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(-half, 0);
  ctx.quadraticCurveTo(0, -wide * 2, half, 0);
  ctx.quadraticCurveTo(0, wide * 2, -half, 0);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1, len * 0.04);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.moveTo(-half * 1.25, 0);
  ctx.lineTo(half * 0.8, 0);
  ctx.stroke();
}

function star(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function confettiBit(ctx, gap, rng) {
  if (rng() < 0.5) return dot(ctx, gap * 0.07);
  ctx.fillRect(-gap * 0.12, -gap * 0.04, gap * 0.24, gap * 0.08);
}

/** A ribbon each way through the middle and a bow where they cross. */
function paintRibbon(ctx, w, h, theme) {
  const band = Math.max(26, Math.min(w, h) * 0.075);
  const cx = w / 2, cy = h / 2;
  ribbonBand(ctx, cx - band / 2, 0, band, h, theme, false);
  ribbonBand(ctx, 0, cy - band / 2, w, band, theme, true);
  bow(ctx, cx, cy, band, theme);
}

function ribbonBand(ctx, x, y, bw, bh, theme, across) {
  ctx.fillStyle = theme.ribbon;
  ctx.fillRect(x, y, bw, bh);
  const edge = (across ? bh : bw) * 0.12;
  ctx.fillStyle = theme.ribbonShade;
  if (across) { ctx.fillRect(x, y, bw, edge); ctx.fillRect(x, y + bh - edge, bw, edge); }
  else { ctx.fillRect(x, y, edge, bh); ctx.fillRect(x + bw - edge, y, edge, bh); }
  ctx.fillStyle = theme.ribbonShine;
  ctx.globalAlpha = 0.6;
  if (across) ctx.fillRect(x, y + bh * 0.38, bw, bh * 0.08);
  else ctx.fillRect(x + bw * 0.38, y, bw * 0.08, bh);
  ctx.globalAlpha = 1;
}

function bow(ctx, cx, cy, band, theme) {
  const loop = band * 1.9;
  ctx.save();
  ctx.translate(cx, cy);
  for (const side of [-1, 1]) {
    // a tail hanging down and out
    ctx.fillStyle = theme.ribbonShade;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(side * band * 0.9, band * 1.9);
    ctx.lineTo(side * band * 0.35, band * 1.65);
    ctx.lineTo(side * band * 0.1, band * 2.0);
    ctx.closePath();
    ctx.fill();
    // a loop
    ctx.fillStyle = theme.ribbon;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(side * loop * 0.6, -loop * 0.75, side * loop * 1.15, -loop * 0.2, side * loop * 0.9, loop * 0.25);
    ctx.bezierCurveTo(side * loop * 0.7, loop * 0.5, side * loop * 0.3, loop * 0.2, 0, 0);
    ctx.fill();
    ctx.strokeStyle = theme.ribbonShade;
    ctx.lineWidth = Math.max(2, band * 0.08);
    ctx.stroke();
    ctx.strokeStyle = theme.ribbonShine;
    ctx.lineWidth = Math.max(1.5, band * 0.06);
    ctx.beginPath();
    ctx.moveTo(side * loop * 0.2, -loop * 0.12);
    ctx.quadraticCurveTo(side * loop * 0.55, -loop * 0.4, side * loop * 0.8, -loop * 0.05);
    ctx.stroke();
  }
  // the knot
  ctx.fillStyle = theme.ribbonShade;
  ctx.beginPath();
  ctx.ellipse(0, 0, band * 0.42, band * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.ribbon;
  ctx.beginPath();
  ctx.ellipse(0, -band * 0.04, band * 0.32, band * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** "#rrggbb" (or "#rgb") with an alpha, as rgba(). Other colour strings pass through unchanged. */
export function withAlpha(hex, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
