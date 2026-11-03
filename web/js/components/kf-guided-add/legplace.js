// Pure logic of leg placing (no DOM): pick how many legs, then tap where each one goes, like eyes.
// State {target, legs}: target = chosen count (null = not chosen yet), legs = hips placed so far
// (board coordinates, already snapped inside the outline by the caller). Unit tested in legplace.test.js.
import { LEG_COUNTS, MAX_LEGS } from "../../farm/legs.js";

export { LEG_COUNTS, MAX_LEGS };
/** Highlighted in the count picker when nothing is chosen yet. */
export const SUGGESTED_COUNT = 2;

/** Fresh state from what a thing (or draft) already has. */
export function legState(legs = [], target) {
  const l = Array.isArray(legs) ? legs.slice(0, MAX_LEGS) : [];
  const t = Number.isInteger(target) && target >= 0 ? Math.min(MAX_LEGS, Math.max(target, l.length)) : l.length ? l.length : null;
  return { target: t, legs: l };
}

/** 'count' (pick how many), 'place' (tap where the next leg goes) or 'done'. */
export function legPhase(state) {
  if (state.target === null || state.target === undefined) return "count";
  return state.legs.length < state.target ? "place" : "done";
}

/** Picks the count. Fewer than placed drops the newest legs; more lets the parent place the rest. */
export function chooseCount(state, n) {
  const target = Math.max(0, Math.min(MAX_LEGS, Math.round(n)));
  return { target, legs: state.legs.slice(0, target) };
}

/** Back to the count picker, keeping the legs placed so far. */
export function recount(state) {
  return { target: null, legs: state.legs };
}

/** Index of the placed leg within r (board-x units; y scaled by the 4:3 aspect) of pt, nearest first, or -1. */
export function legAt(legs, [x, y], r) {
  let best = -1, bestD = Infinity;
  legs.forEach((l, i) => {
    const d = Math.hypot(l.x - x, (l.y - y) * 0.75);
    if (d <= r && d < bestD) (best = i), (bestD = d);
  });
  return best;
}

/**
 * A tap on the preview at board point `pt` (raw, for hitting a leg) that would place a leg at
 * `snapped` (inside the outline). Tapping a placed leg takes it off (the next tap puts it back
 * somewhere else: that is how a leg moves); otherwise the next leg goes there while legs are missing.
 * @returns {{state: {target:number|null, legs:any[]}, action: 'removed'|'placed'|'none', index: number}}
 */
export function tapLeg(state, pt, snapped, r) {
  const hit = legAt(state.legs, pt, r);
  if (hit >= 0) return { state: { ...state, legs: state.legs.filter((_, i) => i !== hit) }, action: "removed", index: hit };
  if (legPhase(state) !== "place") return { state, action: "none", index: -1 };
  const leg = { x: snapped[0], y: snapped[1] };
  return { state: { ...state, legs: [...state.legs, leg] }, action: "placed", index: state.legs.length };
}

/** Takes off the last placed leg. */
export function undoLeg(state) {
  return { ...state, legs: state.legs.slice(0, -1) };
}

/** The big line above the picture. */
export function legHeading(state) {
  const phase = legPhase(state);
  if (phase === "count") return "How many legs?";
  if (phase === "place") return `Tap where leg ${state.legs.length + 1} goes`;
  if (state.target === 0) return "No legs";
  return state.target === 1 ? "One leg" : `${state.target} legs`;
}

/** The small line under it. */
export function legNote(state) {
  const phase = legPhase(state);
  if (phase === "count") return "Pick a number, then tap where each leg goes. Legs hang straight down.";
  if (phase === "place") return `Tap near the bottom of the shape. Tap a leg to take it off. ${state.legs.length} of ${state.target} placed.`;
  if (state.target === 0) return "It floats, rolls or stands on its own. That's fine too.";
  return "Tap a leg to move it: it comes off, then tap where it goes.";
}
