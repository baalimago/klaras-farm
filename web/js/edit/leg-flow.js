// Leg flow (US-3.10, playtest 2): adding and changing a thing's legs as an explicit state machine.
//   choose-count ──count n──▶ placing (leg k of n) ──last leg──▶ done
// The count can change at any time, from any state; fewer than placed drops the newest legs.
// Pointer input is three events (down, move, up): a press on a placed leg drags it, a press
// anywhere else places the next leg while legs are missing, and a stray press never removes one.
// Every change is a new state; the component renders the whole panel from `legView(state)`.
// Pure: no DOM. Points arrive in board coordinates, already snapped inside the outline by the caller.
import { MAX_LEGS, spreadLegs } from "../farm/legs.js";

/** The counts on the picker: every count up to MAX_LEGS. */
export const LEG_CHOICES = Object.freeze(Array.from({ length: MAX_LEGS + 1 }, (_, i) => i));
/** Highlighted on the picker until a count is chosen. */
export const SUGGESTED_LEGS = 2;
/** Undo remembers this many steps. */
export const UNDO_DEPTH = 30;

const copy = (legs) => legs.map((l) => ({ x: l.x, y: l.y }));

/**
 * @typedef {{x:number, y:number}} Leg
 * @typedef {{target: number|null, legs: Leg[], history: Leg[][], drag: null|{index:number, moved:boolean, before: Leg[]}}} LegFlow
 */

/** A fresh flow from what the thing (or draft) already has; `target` is a count picked earlier. */
export function legFlow(legs = [], target = null) {
  const l = Array.isArray(legs) ? copy(legs.slice(0, MAX_LEGS)) : [];
  let t = null;
  if (Number.isInteger(target) && target >= 0) t = Math.min(MAX_LEGS, Math.max(target, l.length));
  else if (l.length) t = l.length;
  return { target: t, legs: l, history: [], drag: null };
}

/** 'choose-count', 'placing' or 'done'. */
export function legPhase(s) {
  if (s.target === null || s.target === undefined) return "choose-count";
  return s.legs.length < s.target ? "placing" : "done";
}

/** A change the parent can undo: remembers the legs before it. */
function commit(s, legs, extra = {}) {
  const history = [...s.history, copy(s.legs)].slice(-UNDO_DEPTH);
  return { ...s, ...extra, legs, history, drag: null };
}

/** Picks (or changes) the count. Fewer than placed drops the newest legs; more asks for the rest. */
export function chooseCount(s, n) {
  const target = Math.max(0, Math.min(MAX_LEGS, Math.round(Number(n) || 0)));
  if (target === s.target && s.legs.length <= target) return s;
  const legs = s.legs.slice(0, target);
  if (legs.length === s.legs.length) return { ...s, target, drag: null };
  return commit(s, legs, { target });
}

/** Index of the placed leg within r of pt (board-x units; y scaled by the 4:3 aspect), nearest first, or -1. */
export function legAt(legs, [x, y], r) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < legs.length; i++) {
    const d = Math.hypot(legs[i].x - x, (legs[i].y - y) * 0.75);
    if (d <= r && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * A press at board point `pt` (raw, for hitting a leg) that would place a leg at `snapped`.
 * On a leg: arms a drag of that leg (nothing changes until it moves). Elsewhere: places the next
 * leg while legs are missing; once all are placed a stray press does nothing.
 * @returns {{state: LegFlow, action: 'grab'|'placed'|'none'}}
 */
export function pressLeg(s, pt, snapped, r) {
  const hit = legAt(s.legs, pt, r);
  if (hit >= 0) return { state: { ...s, drag: { index: hit, moved: false, before: copy(s.legs) } }, action: "grab" };
  if (legPhase(s) !== "placing") return { state: s, action: "none" };
  return { state: commit(s, [...copy(s.legs), { x: snapped[0], y: snapped[1] }]), action: "placed" };
}

/** The pointer moved to `snapped` (inside the outline). Moves the grabbed leg, if any. */
export function moveLeg(s, snapped) {
  if (!s.drag) return s;
  const legs = copy(s.legs);
  legs[s.drag.index] = { x: snapped[0], y: snapped[1] };
  return { ...s, legs, drag: { ...s.drag, moved: true } };
}

/**
 * The pointer came up. A drag ends (Undo can put the leg back). A press on a leg that did not
 * move places the next leg there while legs are missing (legs may sit close), else does nothing.
 * @returns {{state: LegFlow, action: 'moved'|'placed'|'none'}}
 */
export function releaseLeg(s, snapped) {
  const drag = s.drag;
  if (!drag) return { state: s, action: "none" };
  if (drag.moved) {
    const history = [...s.history, drag.before].slice(-UNDO_DEPTH);
    return { state: { ...s, history, drag: null }, action: "moved" };
  }
  const idle = { ...s, drag: null };
  if (legPhase(idle) !== "placing") return { state: idle, action: "none" };
  return { state: commit(idle, [...copy(s.legs), { x: snapped[0], y: snapped[1] }]), action: "placed" };
}

/** The pointer was cancelled (system gesture): a drag keeps where it got to. */
export function cancelPress(s) {
  if (s.drag?.moved) return releaseLeg(s, [0, 0]).state;
  return s.drag ? { ...s, drag: null } : s;
}

/** Puts all `target` legs evenly along the bottom of the outline, to adjust by dragging. */
export function spreadEvenly(s, outline) {
  const n = s.target ?? 0;
  if (!n || !Array.isArray(outline) || outline.length < 3) return s;
  return commit(s, spreadLegs(outline, n));
}

/** Takes every leg off; the count stays, so placing starts again at leg 1. */
export function clearLegs(s) {
  if (!s.legs.length) return s;
  return commit(s, []);
}

/** Steps back one change (a placed, moved, spread or cleared leg, or legs dropped by a count). */
export function undoLeg(s) {
  if (!s.history.length) return s;
  const legs = s.history[s.history.length - 1];
  const target = s.target === null ? null : Math.max(s.target, legs.length);
  return { ...s, target, legs: copy(legs), history: s.history.slice(0, -1), drag: null };
}

/** Everything the panel shows, from the state alone. */
export function legView(s) {
  const phase = legPhase(s);
  const n = s.target ?? 0;
  const placed = s.legs.length;
  let heading = "How many legs?";
  let note = "Pick a number. Then tap where each leg goes, or tap Spread evenly.";
  if (phase === "placing") {
    heading = `Tap where leg ${placed + 1} of ${n} goes`;
    note = `Tap near the bottom of the shape. Drag a leg to move it. ${placed} of ${n} placed.`;
  } else if (phase === "done" && n === 0) {
    heading = "No legs";
    note = "It floats, rolls or stands on its own. That's fine too.";
  } else if (phase === "done") {
    heading = n === 1 ? "One leg" : `${n} legs`;
    note = "Drag a leg to move it. Pick another number to change how many.";
  }
  return {
    phase,
    heading,
    note,
    counts: LEG_CHOICES.map((c) => ({
      n: c,
      label: c === 1 ? "1 leg" : `${c} legs`,
      pressed: s.target === c,
      suggested: s.target === null && c === SUGGESTED_LEGS,
    })),
    canSpread: n > 0,
    canUndo: s.history.length > 0,
    canClear: placed > 0,
  };
}
