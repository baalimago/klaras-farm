// The onboarding tour for the grown-up, as a pure step machine (playtest round 3, decided order):
// an example creature, how to edit, scenes, how to record sounds.
//
//   off ──start──▶ on(0) ──next──▶ on(1) ──next──▶ on(2) ──next──▶ on(3) ──next──▶ done
//                  on(i) ──back──▶ on(i-1) (not before the first card)
//                  on(i) ──skip──▶ done          done ──start──▶ on(0) (Settings "Show the tour again")
//
// `tourCard(step, ctx)` says what a card shows and what it points at, from the mode the app is in:
// the real control when it is on screen (an animal, its ✎ pencil, the Scenes button), else nothing,
// with words that say how to get there.

export const TOUR_STEPS = Object.freeze(["creature", "edit", "scenes", "sounds"]);

/** @typedef {{phase:'off'|'on'|'done', index:number}} TourState */

/** @returns {TourState} */
export function initialTour() {
  return { phase: "off", index: 0 };
}

/**
 * @param {TourState} s
 * @param {{type:'start'|'next'|'back'|'skip'}} e
 * @returns {TourState}
 */
export function nextTour(s, e) {
  switch (e.type) {
    case "start":
      return { phase: "on", index: 0 };
    case "next":
      if (s.phase !== "on") return s;
      return s.index + 1 < TOUR_STEPS.length ? { phase: "on", index: s.index + 1 } : { phase: "done", index: s.index };
    case "back":
      return s.phase === "on" && s.index > 0 ? { phase: "on", index: s.index - 1 } : s;
    case "skip":
      return s.phase === "on" ? { phase: "done", index: s.index } : s;
    default:
      return s;
  }
}

/** The step a state shows, or null when the tour is not on screen. */
export function tourStep(s) {
  return s.phase === "on" ? TOUR_STEPS[s.index] : null;
}

/** Selectors of the real controls a card can point at (owned by <kf-edit-layer>). */
export const PENCIL = "kf-edit-layer .kf-badge.pencil";
export const SCENES_BUTTON = 'kf-edit-layer [data-action="scenes"]';

/**
 * What one card says and points at.
 * @param {string} step  one of TOUR_STEPS
 * @param {{mode: string, holdMs: number}} ctx  mode: the Session mode; holdMs: the hold into edit mode
 * @returns {{title: string, body: string, target: null | {kind:'actor'} | {kind:'selector', selector:string}}}
 *   target 'actor': an animal on the board
 */
export function tourCard(step, { mode, holdMs }) {
  const editing = mode === "edit";
  const hold = `${Math.round(holdMs / 100) / 10} s`;
  switch (step) {
    case "creature":
      return {
        title: "This is a felt animal",
        body: editing
          ? "In play, Klara taps it to hear it: it jumps and says its name."
          : "Tap it to hear it: it jumps and says its name. Klara can tap every animal.",
        target: { kind: "actor" },
      };
    case "edit":
      return editing
        ? { title: "Change an animal", body: "Tap an animal to select it, then drag the round handle on its ring to make it bigger or smaller. Tap it again, or its ✎ pencil, to change its look, name and sounds. Done takes you back to play.", target: { kind: "selector", selector: PENCIL } }
        : { title: "How to edit", body: `Press and hold the scene for ${hold}. A ring fills, then a quick grown-up check opens edit mode. There, tap an animal to select it: the round handle on its ring resizes it, and a second tap (or its ✎ pencil) opens its card.`, target: null };
    case "scenes":
      return editing
        ? { title: "Scenes", body: "Tap Scenes to switch to another scene, or to make a new one.", target: { kind: "selector", selector: SCENES_BUTTON } }
        : { title: "Scenes", body: "In edit mode, tap Scenes to switch to another scene, or to make a new one.", target: null };
    case "sounds":
      return {
        title: "What does the fox say?",
        body: editing
          ? "Record it on its card: tap the ✎ pencil, then record its sound and its name in your own voice."
          : "Record it on its card in edit mode (the ✎ pencil): its sound and its name, in your own voice. Hold a round game button to record your own questions.",
        target: editing ? { kind: "selector", selector: PENCIL } : { kind: "actor" },
      };
    default:
      return { title: "", body: "", target: null };
  }
}

/**
 * Where the card goes so it never covers what it points at: at the top when the target is in the
 * lower half of the screen (or there is none), else at the bottom.
 * @param {{top:number, height:number}|null} rect  @param {number} viewportHeight
 * @returns {'top'|'bottom'}
 */
export function cardPlacement(rect, viewportHeight) {
  if (!rect) return "top";
  return rect.top + rect.height / 2 > viewportHeight / 2 ? "top" : "bottom";
}
