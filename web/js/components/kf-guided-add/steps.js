// Pure helpers for the add-a-thing flow (no DOM). Unit tested in steps.test.js.
import { DEFAULT_QUESTIONS, MAX_CUE_LINES } from "../../farm/scripts.js";

export const STEPS = Object.freeze(["draw", "felt", "eyes", "legs", "moves", "name", "ask", "sound"]);
export const STEP_LABELS = Object.freeze(["Body", "Felt", "Eyes", "Legs", "Moves", "Name", "Ask", "Sound"]);

/** Size of a new thing in board units (x: board width, y: board height). */
export const THING_SIZE = Object.freeze({ w: 0.24, h: 0.32 });

/** How a thing can move: the walkers (feet on the ground, legs swing) first, then the floater. */
export const MOTIONS = Object.freeze([
  { preset: "walk", label: "Walks", icon: "🐾" },
  { preset: "hop", label: "Hops", icon: "🐇" },
  { preset: "scuttle", label: "Scuttles", icon: "🦀" },
  { preset: "float", label: "Floats", icon: "〰" },
]);

/**
 * Sizes the parent can pick (meeting 2: "some smaller, some bigger"). The size is baked into the
 * outline, eyes and legs, so it needs no field in the Thing. scale 1 fills THING_SIZE one way.
 */
export const THING_SIZES = Object.freeze([
  { id: "small", label: "Small", scale: 0.7 },
  { id: "medium", label: "Medium", scale: 1 },
  { id: "big", label: "Big", scale: 1.3 },
]);

function outlineBox(outline) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of outline) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** How big an outline is next to THING_SIZE: 1 is Medium (it fills the box one way). */
export function sizeScale(outline) {
  if (!Array.isArray(outline) || outline.length < 3) return 1;
  const b = outlineBox(outline);
  // rounded so a refit at the same size is exact (Medium stays 1, not 1.0000000000000002)
  return Math.round(Math.max(b.w / THING_SIZE.w, b.h / THING_SIZE.h) * 1e6) / 1e6 || 1;
}

/** The picked size an outline is closest to (on a ratio scale), for the pressed button. */
export function nearestSize(outline) {
  const k = Math.log(sizeScale(outline));
  let best = THING_SIZES[1];
  for (const sz of THING_SIZES) if (Math.abs(Math.log(sz.scale) - k) < Math.abs(Math.log(best.scale) - k)) best = sz;
  return best.id;
}

/** The box fitOutline should fill for a size scale. */
export function sizeBox(scale = 1) {
  return { w: THING_SIZE.w * scale, h: THING_SIZE.h * scale };
}

/**
 * The thing's outline, eyes and legs at another size: scaled about the bottom centre (its feet stay
 * where they stand) and moved back onto the board if it grew past an edge.
 * @param {{outline: [number, number][], eyes?: {x: number, y: number}[], legs?: {x: number, y: number}[]}} thing
 * @param {number} scale  target size scale (THING_SIZES[i].scale)
 */
export function resizeThing(thing, scale) {
  const b = outlineBox(thing.outline);
  const k = scale / sizeScale(thing.outline);
  const ax = b.x + b.w / 2, ay = b.y + b.h;
  const w = b.w * k, h = b.h * k;
  const nx = Math.min(Math.max(ax - w / 2, 0), Math.max(0, 1 - w));
  const ny = Math.min(Math.max(ay - h, 0), Math.max(0, 1 - h));
  const mx = (x) => nx + (x - b.x) * k;
  const my = (y) => ny + (y - b.y) * k;
  const point = (p) => ({ ...p, x: mx(p.x), y: my(p.y) });
  return {
    outline: thing.outline.map(([x, y]) => [mx(x), my(y)]),
    eyes: (thing.eyes ?? []).map(point),
    legs: (thing.legs ?? []).map(point),
  };
}

/** Preview fill that shows the picked size: Big fills `fill`, smaller sizes fill less. */
export function sizedFill(outline, fill) {
  const biggest = THING_SIZES[THING_SIZES.length - 1].scale;
  return fill * Math.max(0.3, Math.min(1, sizeScale(outline) / biggest));
}

export function newDraft(placeId, at) {
  // legTarget: the leg count picked on the Legs step (null = not picked yet); not part of the Thing.
  return { id: null, placeId, step: 0, at, thing: { names: {}, cues: {}, eyes: [], legs: [], legTarget: null, outline: null, color: null, motion: null }, clips: [] };
}

/** Fills in fields a draft from an older build may lack. */
export function normalizeDraft(d, fallbackAt) {
  const t = d.thing ?? {};
  return {
    ...d,
    step: Math.max(0, Math.min(STEPS.length - 1, Number.isInteger(d.step) ? d.step : 0)),
    at: d.at ?? fallbackAt,
    thing: { names: {}, cues: {}, eyes: [], legs: [], legTarget: null, outline: null, color: null, motion: null, ...t },
    clips: Array.isArray(d.clips) ? d.clips : [],
  };
}

/** Up to two eyes; a third tap moves the oldest eye (US-3.2). */
export function stampEye(eyes, eye) {
  return eyes.length < 2 ? [...eyes, eye] : [eyes[eyes.length - 1], eye];
}

const sameSlot = (a, b) => a.language === b.language && a.kind === b.kind && a.take === b.take;

export function upsertClip(clips, clip) {
  return [...clips.filter((c) => !sameSlot(c, clip)), clip];
}

export function findClip(clips, { language, kind, take = 1 }) {
  return clips.find((c) => sameSlot(c, { language, kind, take })) ?? null;
}

/** A clip as kept in a draft or handed to addThing: no id, thingId or createdAt. */
export function stripClip(clip) {
  const { id, thingId, createdAt, ...rest } = clip;
  return rest;
}

export function latestDraft(drafts, placeId) {
  return drafts.filter((d) => d.placeId === placeId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
}

export function canAdvance(step, thing) {
  if (step === "draw") return Array.isArray(thing.outline) && thing.outline.length >= 3;
  if (step === "felt") return !!thing.color;
  if (step === "legs") return !Number.isInteger(thing.legTarget) || (thing.legs?.length ?? 0) >= thing.legTarget;
  if (step === "moves") return !!thing.motion;
  return true;
}

/** A spot in the ground band as far as possible from the things already there. */
export function freeSpot(centers, y = 0.62) {
  const xs = [0.5, 0.3, 0.7, 0.18, 0.82, 0.4, 0.6];
  let best = xs[0], bestD = -1;
  for (const x of xs) {
    const d = centers.length ? Math.min(...centers.map(([cx, cy]) => Math.hypot(cx - x, (cy - y) * 0.75))) : 1;
    if (d > bestD + 1e-9) (bestD = d), (best = x);
  }
  return [best, y];
}

export function cleanNames(names = {}) {
  const out = {};
  for (const [lang, name] of Object.entries(names)) {
    const v = String(name ?? "").trim();
    if (v) out[lang] = v;
  }
  return out;
}

/**
 * Cues as handed to addThing: trimmed lines, all of them (1 to MAX_CUE_LINES; their number is how
 * many questions there are, an empty line plays the example). Only the untouched default, that
 * many empty lines, is left out, since it means the same as no lines.
 */
export function cleanCues(cues = {}) {
  const out = {};
  for (const [lang, cue] of Object.entries(cues)) {
    const c = {};
    if (cue?.article) c.article = cue.article;
    const lines = Array.isArray(cue?.lines) ? cue.lines.slice(0, MAX_CUE_LINES).map((l) => String(l ?? "").trim()) : [];
    if (lines.some(Boolean) || (lines.length && lines.length !== DEFAULT_QUESTIONS)) c.lines = lines;
    if (Object.keys(c).length) out[lang] = c;
  }
  return out;
}

/** Moves eyes (or legs: any {x, y} list) to the same relative spot of a redrawn outline, then snaps them inside. */
export function refitEyes(eyes, oldOutline, newOutline, snap) {
  const box = (pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x || 1e-6, h: Math.max(...ys) - y || 1e-6 };
  };
  const a = box(oldOutline), b = box(newOutline);
  return eyes.map((e) => {
    const p = [b.x + ((e.x - a.x) / a.w) * b.w, b.y + ((e.y - a.y) / a.h) * b.h];
    const [x, y] = snap(p, newOutline);
    return { x, y };
  });
}
