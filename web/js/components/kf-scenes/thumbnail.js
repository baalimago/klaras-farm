// Scene thumbnails for the shelf. Uses io/felt.js paintBackground (package A) when it loads;
// otherwise, or if it throws, paints plain Sunny colours: sky, ground band and the pieces.
import { hex } from "../../farm/palette.js";

let feltPromise = null;
function loadFelt() {
  feltPromise ??= import("../../io/felt.js").catch(() => null);
  return feltPromise;
}

/** Ground line (fraction of board height) per backdrop, for the plain fallback. */
const GROUND_AT = { meadow: 0.6, sea: 0.55, room: 0.68, blank: 0.82 };

/**
 * Paints `place` into `canvas` (which is 4:3). `canvas.width/height` are device pixels.
 * @param {HTMLCanvasElement} canvas
 * @param {import('../../types.js').Place} place
 */
export async function paintThumbnail(canvas, place) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const hgt = canvas.height;
  const felt = await loadFelt();
  if (felt?.paintBackground) {
    try {
      ctx.save();
      // Package A's size argument: {w, h} in pixels. width/height given too in case it reads those.
      felt.paintBackground(ctx, place, { w, h: hgt, width: w, height: hgt });
      ctx.restore();
      return;
    } catch (e) {
      ctx.restore();
      console.warn("felt thumbnail failed, using plain colours", e);
    }
  }
  paintPlain(ctx, place, w, hgt);
}

export function paintPlain(ctx, place, w, hgt) {
  ctx.clearRect(0, 0, w, hgt);
  ctx.fillStyle = hex(place.skyColor);
  ctx.fillRect(0, 0, w, hgt);
  const g = (GROUND_AT[place.backdrop] ?? 0.6) * hgt;
  ctx.fillStyle = hex(place.groundColor);
  ctx.beginPath();
  if (place.backdrop === "sea") {
    ctx.moveTo(0, g);
    for (let x = 0; x <= w; x += w / 8) ctx.quadraticCurveTo(x + w / 16, g - hgt * 0.03, x + w / 8, g);
    ctx.lineTo(w, hgt);
    ctx.lineTo(0, hgt);
  } else {
    ctx.rect(0, g, w, hgt - g);
  }
  ctx.fill();
  for (const piece of place.pieces ?? []) {
    const pts = piece.stroke ?? [];
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * hgt);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * hgt);
    if (piece.kind === "shape") {
      ctx.closePath();
      ctx.fillStyle = hex(piece.color);
      ctx.fill();
    } else {
      ctx.strokeStyle = hex(piece.color);
      ctx.lineWidth = Math.max(2, w * 0.012);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
}
