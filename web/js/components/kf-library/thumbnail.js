// Felt pictures of things for the animal library, painted like the scene thumbnails (kf-scenes/
// thumbnail.js): io/felt.js when it loads (felt body, button eyes, yarn legs), plain colours if not.
// Contract: paintThingThumb(canvas, thing) fills `canvas` (its width/height are device pixels) with
// the thing centred on cream felt. Each thing is painted once into a cached canvas, keyed by the
// thing object (snapshots are immutable, so a changed thing is a new object); later calls only
// copy it. Never per frame; never throws (resolves false when nothing could be painted).
import { hex, INK } from "../../farm/palette.js";
import { footY, legLength } from "../../farm/legs.js";
import { bbox } from "../../geometry/stroke.js";

export const THUMB_W = 240;
export const THUMB_H = 180;
const FILL = 0.8; // of the picture the thing (with its legs) may fill

let feltPromise = null;
function loadFelt() {
  feltPromise ??= import("../../io/felt.js").catch(() => null);
  return feltPromise;
}

/** @type {WeakMap<object, Promise<HTMLCanvasElement|null>>} */
const cache = new WeakMap();

/** How many pictures have been painted (not copied) since load: tests check the cache with it. */
export const stats = { painted: 0 };

/** @param {HTMLCanvasElement} canvas @param {import('../../types.js').Thing} thing */
export async function paintThingThumb(canvas, thing) {
  try {
    if (!cache.has(thing)) cache.set(thing, paintOnce(thing));
    const picture = await cache.get(thing);
    const ctx = canvas.getContext("2d");
    if (!picture || !ctx) return false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
    return true;
  } catch (e) {
    console.warn("kf-library: thumbnail failed", e);
    return false;
  }
}

async function paintOnce(thing) {
  const felt = await loadFelt();
  const c = document.createElement("canvas");
  c.width = THUMB_W;
  c.height = THUMB_H;
  const ctx = c.getContext("2d");
  if (!ctx || !thing?.outline?.length) return null;
  stats.painted++;
  ctx.fillStyle = hex("cream");
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const view = viewOf(thing);
  paintLegs(ctx, thing, view);
  if (!(felt && paintFelt(ctx, felt, thing, view))) paintPlain(ctx, thing, view);
  paintEyes(ctx, felt, thing, view);
  return c;
}

/**
 * Board units → picture pixels: W is the width of the whole board in picture px, (ox, oy) the
 * picture position of the board's top-left. The thing and its feet fill FILL of the picture.
 */
function viewOf(thing) {
  const b = bbox(thing.outline);
  const len = legLength(thing.outline);
  const bottom = Math.max(b.y + b.h, ...(thing.legs ?? []).map((l) => footY(thing.outline, l, len)));
  const h = Math.max(0.01, bottom - b.y);
  const w = Math.max(0.01, b.w);
  // A board unit across is W px, down is 0.75 W px (the board is 4:3).
  const W = Math.min((FILL * THUMB_W) / w, (FILL * THUMB_H) / (h * 0.75));
  const ox = THUMB_W / 2 - (b.x + w / 2) * W;
  const oy = THUMB_H / 2 - (b.y + h / 2) * W * 0.75;
  return { W, H: W * 0.75, ox, oy, U: (W * 0.75) / 600, b };
}

const px = (v, x, y) => [v.ox + x * v.W, v.oy + y * v.H];

function paintLegs(ctx, thing, v) {
  const legs = thing.legs ?? [];
  if (!legs.length) return;
  const len = legLength(thing.outline);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, 4 * v.U);
  ctx.beginPath();
  for (const l of legs) {
    const [x, y] = px(v, l.x, l.y);
    const [, fy] = px(v, l.x, footY(thing.outline, l, len));
    ctx.moveTo(x, y);
    ctx.lineTo(x, fy);
    ctx.lineTo(x + 4 * v.U, fy);
  }
  ctx.stroke();
}

function paintFelt(ctx, felt, thing, v) {
  try {
    const sprite = felt.paintThingSprite({ ...thing, eyes: [] }, v.W, 1);
    ctx.drawImage(sprite.canvas, v.ox + sprite.ox, v.oy + sprite.oy);
    felt.releaseCanvas?.(sprite.canvas);
    return true;
  } catch (e) {
    console.warn("kf-library: felt picture failed, using plain colours", e);
    return false;
  }
}

function paintPlain(ctx, thing, v) {
  ctx.beginPath();
  thing.outline.forEach(([x, y], i) => {
    const [X, Y] = px(v, x, y);
    if (i) ctx.lineTo(X, Y);
    else ctx.moveTo(X, Y);
  });
  ctx.closePath();
  ctx.fillStyle = hex(thing.color);
  ctx.fill();
}

function paintEyes(ctx, felt, thing, v) {
  const r = Math.max(4 * v.U, Math.min(10 * v.U, 0.085 * Math.min(v.b.w * v.W, v.b.h * v.H)));
  const eye = felt?.eyeSprite?.();
  for (const e of thing.eyes ?? []) {
    const [x, y] = px(v, e.x, e.y);
    if (eye) {
      ctx.drawImage(eye, x - r, y - r, r * 2, r * 2);
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }
}
