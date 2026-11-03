// Pure helpers for the add-a-thing flow (no DOM). Unit tested in steps.test.js.

export const STEPS = Object.freeze(["draw", "felt", "eyes", "moves", "name", "ask", "sound"]);
export const STEP_LABELS = Object.freeze(["Draw", "Felt", "Eyes", "Moves", "Name", "Ask", "Sound"]);

/** Size of a new thing in board units (x: board width, y: board height). */
export const THING_SIZE = Object.freeze({ w: 0.24, h: 0.32 });

export const MOTIONS = Object.freeze([
  { preset: "walk", label: "Walks", icon: "🐾" },
  { preset: "float", label: "Floats", icon: "〰" },
]);

export function newDraft(placeId, at) {
  return { id: null, placeId, step: 0, at, thing: { names: {}, cues: {}, eyes: [], outline: null, color: null, motion: null }, clips: [] };
}

/** Fills in fields a draft from an older build may lack. */
export function normalizeDraft(d, fallbackAt) {
  const t = d.thing ?? {};
  return {
    ...d,
    step: Math.max(0, Math.min(STEPS.length - 1, Number.isInteger(d.step) ? d.step : 0)),
    at: d.at ?? fallbackAt,
    thing: { names: {}, cues: {}, eyes: [], outline: null, color: null, motion: null, ...t },
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

/** Cues without empty overrides (empty lines fall back to the template). */
export function cleanCues(cues = {}) {
  const out = {};
  for (const [lang, cue] of Object.entries(cues)) {
    const c = {};
    if (cue?.article) c.article = cue.article;
    if (cue?.lines?.some((l) => l && l.trim())) c.lines = [0, 1, 2].map((i) => (cue.lines[i] ?? "").trim());
    if (Object.keys(c).length) out[lang] = c;
  }
  return out;
}

/** Moves eyes to the same relative spot of a redrawn outline, then snaps them inside. */
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
