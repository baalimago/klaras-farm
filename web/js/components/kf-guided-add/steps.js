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
 * Size has no field in the Thing: it is baked into the outline, eyes and legs (meeting 2). A new
 * thing is drawn at THING_SIZE; resizing is the edit-mode scale tool (playtest 3). The thing card
 * reads the size back (sizeScale) so a redraw keeps it (sizeBox) and its preview shows it (sizedFill).
 */
const PREVIEW_FULL = 1.3; // the size scale that fills the card's preview; smaller things show smaller

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

/** How big an outline is next to THING_SIZE: 1 fills the box one way. */
export function sizeScale(outline) {
  if (!Array.isArray(outline) || outline.length < 3) return 1;
  const b = outlineBox(outline);
  // rounded so a refit at the same size is exact (1 stays 1, not 1.0000000000000002)
  return Math.round(Math.max(b.w / THING_SIZE.w, b.h / THING_SIZE.h) * 1e6) / 1e6 || 1;
}

/** The box fitOutline should fill for a size scale. */
export function sizeBox(scale = 1) {
  return { w: THING_SIZE.w * scale, h: THING_SIZE.h * scale };
}

/** Preview fill that shows the thing's size: PREVIEW_FULL and up fill `fill`, smaller sizes fill less. */
export function sizedFill(outline, fill) {
  return fill * Math.max(0.3, Math.min(1, sizeScale(outline) / PREVIEW_FULL));
}

/** Where a new thing is drawn when no spot was held; Finish then places it (play/placement.js). */
export const DEFAULT_SPOT = Object.freeze([0.5, 0.62]);

/**
 * A new draft. `held`: the parent held a spot on the board (US-11.3) and the thing stays where it
 * is drawn there; otherwise Finish puts it on a free spot of the ground (addThing spot "free").
 */
export function newDraft(placeId, at, held = false) {
  // legTarget: the leg count picked on the Legs step (null = not picked yet); not part of the Thing.
  return { id: null, placeId, step: 0, at, held, thing: { names: {}, cues: {}, eyes: [], legs: [], legTarget: null, outline: null, color: null, motion: null }, clips: [] };
}

/**
 * Fills in fields a draft from an older build may lack, and never resumes past a step whose work is
 * missing (playtest 3: a draft could open on Eyes with no body to put them on, a dead end). The step
 * is clamped to furthestStep, so a resumed draft always shows something the parent can do.
 */
export function normalizeDraft(d, fallbackAt) {
  const t = d.thing ?? {};
  const thing = { names: {}, cues: {}, eyes: [], legs: [], legTarget: null, outline: null, color: null, motion: null, ...t };
  // Eyes and legs sit on the body: without it they would be saved off the body drawn next.
  if (!validOutline(thing.outline)) Object.assign(thing, { outline: null, eyes: [], legs: [], legTarget: null });
  if (!Array.isArray(thing.eyes)) thing.eyes = [];
  if (!Array.isArray(thing.legs)) thing.legs = [];
  if (!thing.names || typeof thing.names !== "object") thing.names = {};
  const step = Math.max(0, Math.min(STEPS.length - 1, Number.isInteger(d.step) ? d.step : 0));
  return {
    ...d,
    step: Math.min(step, furthestStep(thing)),
    at: d.at ?? fallbackAt,
    held: d.held === true,
    thing,
    // a draft saved before sounds shared one slot may hold two: the last recorded stays
    clips: Array.isArray(d.clips) ? d.clips.reduce(upsertClip, []) : [],
  };
}

/** An outline a body can be shown and stamped on: at least 3 finite points with some area. */
export function validOutline(outline) {
  if (!Array.isArray(outline) || outline.length < 3) return false;
  if (!outline.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
  let a = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) a += outline[j][0] * outline[i][1] - outline[i][0] * outline[j][1];
  return Math.abs(a / 2) > 1e-6;
}

/** True when the thing has a name in some language (playtest 3: "It doesn't have a name"). */
export function hasName(thing) {
  return Object.keys(cleanNames(thing?.names ?? {})).length > 0;
}

/** Whether a step's work is done, so the steps after it can be shown. A name is needed past Name. */
export function stepDone(step, thing) {
  return step === "name" ? hasName(thing) : canAdvance(step, thing);
}

/** The last step a thing may be on: the first step whose work is not done yet. */
export function furthestStep(thing) {
  for (let i = 0; i < STEPS.length; i++) if (!stepDone(STEPS[i], thing)) return i;
  return STEPS.length - 1;
}

/** Up to two eyes; a third tap moves the oldest eye (US-3.2). */
export function stampEye(eyes, eye) {
  return eyes.length < 2 ? [...eyes, eye] : [eyes[eyes.length - 1], eye];
}

// A thing has one sound whichever language tab recorded it (QA round 3, as saveClip and the thing
// card keep it): sounds share one slot, so a new one replaces the old and every tab shows it.
const sameSlot = (a, b) => a.kind === b.kind && (a.kind === "sound" || (a.language === b.language && a.take === b.take));

/** The draft's clips with `clip` in its slot (a name or question per language and take; one sound). */
export function upsertClip(clips, clip) {
  return [...clips.filter((c) => !sameSlot(c, clip)), clip];
}

/** The clip in a slot; a sound is found from any language tab. */
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
  if (step === "draw") return validOutline(thing.outline);
  if (step === "felt") return !!thing.color;
  if (step === "legs") return !Number.isInteger(thing.legTarget) || (thing.legs?.length ?? 0) >= thing.legTarget;
  if (step === "moves") return !!thing.motion;
  return true;
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
