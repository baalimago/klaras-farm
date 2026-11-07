// The wrapping's life, as a pure state machine. One finger tears at a time (the primary pointer;
// palms and second fingers are ignored), and the paper comes off once enough of it is gone.
//
//   wrapped ──down (primary pointer)──▶ tearing        the finger pokes in and starts a tear
//   tearing ──cleared──▶ tearing                       the share of paper torn away grows
//   tearing ──up / cancel (that pointer)──▶ wrapped    the strip falls off; more paper is left
//   tearing ──up / cancel, enough torn──▶ opening      the rest of the paper falls away
//   wrapped | tearing ──open──▶ opening                a key press, or the host opens it
//   opening ──opened──▶ open                           the paper is gone; the page is free
//   any ──destroy──▶ open
//
// "Enough torn" is either share: `openAt` of the paper torn away, or `openAfterTears` tears,
// so a child who only pokes still gets the present open.

/** @typedef {'wrapped'|'tearing'|'opening'|'open'} WrapPhase */
/** @typedef {{phase: WrapPhase, pointerId: number|null, cleared: number, tears: number}} WrapState */
/** @typedef {{openAt: number, openAfterTears: number}} WrapRules */

/** @type {WrapRules} */
export const DEFAULT_RULES = Object.freeze({ openAt: 0.25, openAfterTears: 8 });

/** @returns {WrapState} */
export function initialWrap() {
  return { phase: "wrapped", pointerId: null, cleared: 0, tears: 0 };
}

/** Does this pointer's move belong to the tear in progress? */
export function accepts(s, pointerId) {
  return s.phase === "tearing" && s.pointerId === pointerId;
}

/**
 * @param {WrapState} s
 * @param {{type:'down', pointerId:number, primary:boolean} | {type:'up'|'cancel', pointerId:number}
 *   | {type:'cleared', fraction:number} | {type:'open'|'opened'|'destroy'}} e
 * @param {WrapRules} [rules]
 * @returns {WrapState}  the same object when the event changes nothing
 */
export function nextWrap(s, e, rules = DEFAULT_RULES) {
  switch (e.type) {
    case "down":
      if (s.phase !== "wrapped" || !e.primary) return s;
      return { ...s, phase: "tearing", pointerId: e.pointerId, tears: s.tears + 1 };
    case "cleared":
      if (s.phase === "open" || e.fraction <= s.cleared) return s;
      return { ...s, cleared: Math.min(1, e.fraction) };
    case "up":
    case "cancel":
      if (!accepts(s, e.pointerId)) return s;
      return { ...s, phase: enough(s, rules) ? "opening" : "wrapped", pointerId: null };
    case "open":
      if (s.phase !== "wrapped" && s.phase !== "tearing") return s;
      return { ...s, phase: "opening", pointerId: null };
    case "opened":
      return s.phase === "opening" ? { ...s, phase: "open" } : s;
    case "destroy":
      return s.phase === "open" ? s : { ...s, phase: "open", pointerId: null };
    default:
      return s;
  }
}

function enough(s, rules) {
  return s.cleared >= rules.openAt || s.tears >= rules.openAfterTears;
}
