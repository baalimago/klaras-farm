// Edit-mode selection and resize of things (QA round 3), pure: state + event → state.
// <kf-edit-layer> keeps one of these and renders the selection ring, its resize handle and the
// badges from it after every event; <kf-board> keeps a resize gesture (resizeGesture) for the scale.
//
//   none ──tap/grab/pencil {id}──▶ selected(id) ──handle-down {id, pointerId, pivot, corner}──▶ resizing
//   selected(id) ──tap {id}──▶ selected(id), and tapAction says 'open-card' (a second tap opens its card)
//   selected(a) ──tap/grab/pencil {b}──▶ selected(b)          tap-empty: unchanged (tap-away keeps it)
//   resizing ──handle-move {pointerId, k}──▶ resizing (k)    the handle rides the scaled corner
//   resizing ──handle-up | handle-cancel | lost-capture {pointerId}──▶ selected(id)
//            (resizeOutcome: 'commit' for handle-up, 'cancel' otherwise; a different pointer is ignored)
//   any ──things {ids} without the selected id──▶ none       (deleted; a resize going on is cancelled)
//   any ──leave──▶ none                                       (edit mode ends; a resize is cancelled)
//   resizing ignores tap, grab, pencil and handle-down: one finger resizes, nothing else changes it.
//
// States (frozen-shape plain objects; unchanged events return the same object):
//   {phase: 'none', id: null}
//   {phase: 'selected', id}
//   {phase: 'resizing', id, pointerId, pivot: [x, y], corner: [x, y], k}
//     pivot: the thing's feet, client px (the board's resizeStart); corner: where the handle was
//     placed, client px; k: the scale shown now (the board's resizeTo, already clamped).
import { clampThingScale } from "../geometry/transform.js";

export const NO_SELECTION = Object.freeze({ phase: "none", id: null });

export function initialSelection() {
  return NO_SELECTION;
}

/** The selected (or resizing) thing's id, or null. */
export const selectedId = (s) => (s.phase === "none" ? null : s.id);

/** True while the handle is under a finger. */
export const isResizing = (s) => s.phase === "resizing";

/** True when this pointer is the one resizing. */
export const ownsPointer = (s, pointerId) => s.phase === "resizing" && s.pointerId === pointerId;

/** What a tap on thing `id` does: 'select' it, 'open-card' (it is already selected), or 'ignore'. */
export function tapAction(s, id) {
  if (!id || s.phase === "resizing") return "ignore";
  return s.phase === "selected" && s.id === id ? "open-card" : "select";
}

/** How far the handle has moved from its corner while resizing [dx, dy] (px): the corner scaled by k about the pivot. */
export function handleOffset(s) {
  if (s.phase !== "resizing") return [0, 0];
  const [px, py] = s.pivot, [cx, cy] = s.corner;
  return [(cx - px) * (s.k - 1), (cy - py) * (s.k - 1)];
}

/** Whether going from `prev` to `next` on event `e` ends a resize: 'commit', 'cancel' or null. */
export function resizeOutcome(prev, next, e) {
  if (prev.phase !== "resizing" || next.phase === "resizing") return null;
  return e.type === "handle-up" ? "commit" : "cancel";
}

const select = (s, id) => (s.phase === "selected" && s.id === id ? s : { phase: "selected", id });

/**
 * @param {{phase: string, id: string|null}} s
 * @param {{type: string, id?: string, ids?: string[], pointerId?: number, pivot?: number[], corner?: number[], k?: number}} e
 */
export function nextSelection(s, e) {
  switch (e.type) {
    case "tap":
    case "grab":
    case "pencil":
      if (!e.id || s.phase === "resizing") return s;
      return select(s, e.id);
    case "tap-empty":
      return s;
    case "handle-down":
      if (s.phase !== "selected" || s.id !== e.id || !isPoint(e.pivot) || !isPoint(e.corner)) return s;
      return { phase: "resizing", id: s.id, pointerId: e.pointerId, pivot: [...e.pivot], corner: [...e.corner], k: 1 };
    case "handle-move":
      if (!ownsPointer(s, e.pointerId) || !(e.k > 0) || !Number.isFinite(e.k) || e.k === s.k) return s;
      return { ...s, k: e.k };
    case "handle-up":
    case "handle-cancel":
    case "lost-capture":
      return ownsPointer(s, e.pointerId) ? { phase: "selected", id: s.id } : s;
    case "things":
      return s.phase !== "none" && !(e.ids ?? []).includes(s.id) ? NO_SELECTION : s;
    case "leave":
      return NO_SELECTION;
    default:
      return s;
  }
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

// ---------- the board's half: the scale under the finger ----------

/**
 * A resize gesture on `thing` (as stored) about `pivot` (its feet, client px), from a press at `at`
 * (client px). Its scale `s` is the finger's distance from the feet over the distance at the start.
 * @returns {{id: string, thing: object, pivot: number[], d0: number, s: number}}
 */
export function resizeGesture(id, thing, pivot, at) {
  return { id, thing, pivot: [...pivot], d0: Math.hypot(at[0] - pivot[0], at[1] - pivot[1]), s: 1 };
}

/** The gesture with the finger at `at`: `s` clamped to the thing's size limits (geometry/transform.js clampThingScale). */
export function resizeGestureTo(g, at) {
  const raw = g.d0 < 1 ? 1 : Math.hypot(at[0] - g.pivot[0], at[1] - g.pivot[1]) / g.d0;
  return { ...g, s: clampThingScale(g.thing, raw) };
}
