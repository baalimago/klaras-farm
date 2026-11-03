// Motion building blocks (ARCHITECTURE §6): pure functions of time and parameters.
// Presets in web/data/motions/*.json are data for these blocks.
//
// Units (shared by all blocks and presets):
//   t           seconds of motion time
//   speed       fraction 0..1 of MAX_SPEED (the US-5.3 cap)
//   amp/height  board units (fraction of board height for vertical offsets)
//   rate        steps (or cycles) per second
//   swing/amp of angles: radians
//   squash      returns s: the renderer uses sx = 1 + s, sy = 1 − s
// Negative dy is up. Missing params mean "no motion" (the block returns its rest value).

const TAU = Math.PI * 2;
const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** 40 CSS px/s on the widest board (13" iPad landscape, 1366 px), in board widths per second. */
export const MAX_SPEED = 0.029;

/** Ground speed in board widths per second. */
export function travelSpeed(p) {
  return Math.min(1, Math.max(0, num(p?.speed))) * MAX_SPEED;
}

/** Vertical offset from the way of travelling: hop leaves the ground once per step; ground and water stay on the line. */
export function travel(t, p) {
  if (p?.mode !== "hop") return 0;
  return -num(p.height) * Math.abs(Math.sin(Math.PI * num(p.rate) * t));
}

/** Body bob. shape "bounce": up-only, one bounce per step (walkers). "sine": gentle up and down (floaters). */
export function bob(t, p) {
  const amp = num(p?.amp), rate = num(p?.rate);
  if (p?.shape === "sine") return amp * Math.sin(TAU * rate * t);
  return -amp * Math.abs(Math.sin(Math.PI * rate * t));
}

/** Squash and stretch: widest on contact (t = k/rate), tallest mid-step. */
export function squash(t, p) {
  return num(p?.amp) * Math.cos(TAU * num(p?.rate) * t);
}

/** Body tilt in radians. */
export function tilt(t, p) {
  return num(p?.amp) * Math.sin(TAU * num(p?.rate) * t);
}

/** Swing of leg i in radians: neighbours swing opposite, spread on contact, vertical mid-step. */
export function legs(t, p, i) {
  const a = num(p?.swing) * Math.cos(Math.PI * num(p?.rate) * t);
  return i % 2 ? -a : a;
}

/** Eye openness, tb = seconds since the blink started (negative = no blink). */
export function blink(tb, p) {
  const d = num(p?.duration, 0.18);
  if (!(tb > 0) || tb >= d) return 1;
  return Math.abs(1 - (2 * tb) / d);
}

// ---------- reactions (overlays the world puts on top of the base pose) ----------

/** Tap reaction length (US-5.2: every visual reaction returns to idle within 3 s). */
export const REACT_S = 1.0;
const HOP1_S = 0.55, HOP1_H = 0.07, HOP2_H = 0.035;

/** Tap jump: two hops, the second lower. */
export function jump(t) {
  if (t <= 0 || t >= REACT_S) return 0;
  const first = t < HOP1_S;
  const u = first ? t / HOP1_S : (t - HOP1_S) / (REACT_S - HOP1_S);
  return -(first ? HOP1_H : HOP2_H) * Math.sin(Math.PI * u);
}

/** Squash during the jump: tall in the air (s < 0). */
export function jumpStretch(t) {
  if (t <= 0 || t >= REACT_S) return 0;
  const u = t < HOP1_S ? t / HOP1_S : (t - HOP1_S) / (REACT_S - HOP1_S);
  return -0.08 * Math.sin(Math.PI * u);
}

/** Extra spin for floaters when tapped. */
export function jumpSpin(t) {
  if (t <= 0 || t >= REACT_S) return 0;
  return 0.25 * Math.sin(TAU * 1.5 * t) * (1 - t / REACT_S);
}

/** Drop-in of a new thing (US-2.4, add a thing). */
export const DROP_S = 0.7;
const DROP_FROM = 0.3, FALL = 0.75;

export function drop(t) {
  if (t >= DROP_S) return 0;
  const u = Math.max(0, t) / DROP_S;
  if (u < FALL) return -DROP_FROM * (1 - (u / FALL) ** 2);
  return -DROP_FROM * 0.1 * Math.sin((Math.PI * (u - FALL)) / (1 - FALL));
}

/** Squash during the drop: stretched while falling, wide just after landing. */
export function dropStretch(t) {
  if (t >= DROP_S) return 0;
  const u = Math.max(0, t) / DROP_S;
  if (u < FALL) return -0.05 * (u / FALL);
  return 0.1 * Math.sin((Math.PI * (u - FALL)) / (1 - FALL));
}

/** Edit-mode wiggle, decaying to still so the board can idle while the parent edits. */
export const WIGGLE_S = 2;
export function wiggle(t, amp = 0.07, rate = 2, duration = WIGGLE_S) {
  if (t < 0 || t >= duration) return 0;
  return amp * Math.sin(TAU * rate * t) * (1 - t / duration);
}

/** Sleep (US-5.4): yawn, eyes close, then a still pose (so the board idles). Writes sx, sy, eyeOpen. */
export const YAWN_S = 1.6;
export const SLEEP_SETTLE_S = 2.2;
const SLUMP_SY = 0.97, SLUMP_SX = 1.02;

export function yawn(t, out) {
  if (t < YAWN_S) {
    const k = Math.sin((Math.PI * Math.max(0, t)) / YAWN_S);
    out.sy = 1 + 0.06 * k;
    out.sx = 1 - 0.03 * k;
    out.eyeOpen = 1 - 0.6 * Math.min(1, t / (YAWN_S / 2));
    return out;
  }
  const u = Math.min(1, (t - YAWN_S) / (SLEEP_SETTLE_S - YAWN_S));
  out.sy = 1 + (SLUMP_SY - 1) * u;
  out.sx = 1 + (SLUMP_SX - 1) * u;
  out.eyeOpen = 0.4 * (1 - u);
  return out;
}
