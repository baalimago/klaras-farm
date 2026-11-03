// Find it (US-6.2, 6.3): now and then the farm asks for one thing in a parent's voice; the child
// taps it and gets a celebration. Pure state machine; the engine plays the audio.
//
//   idle ──(timer)──▶ asking ──(right tap)──▶ celebrate ──(timer)──▶ idle
//                       │  ▲ wrong tap: thing says its own name, the question repeats;
//                       │  │ after 2 misses the right thing glows (hint)
//                       └──┴─(no answer: ask once more, then give up quietly)
// Time only advances while play is calm (no finger down, nothing asleep, not in edit mode).

export const FIND = Object.freeze({
  firstAskS: 6,      // after Find it turns on or the place opens
  gapMinS: 18,       // between questions
  gapMaxS: 35,
  repeatAfterS: 10,  // no answer: ask again once…
  maxRepeats: 1,     // …then give up without fuss
  celebrateS: 2.5,
  hintAfterMisses: 2,
});

/** @typedef {{phase:'idle'|'asking'|'celebrate', timer:number, target:string|null, last:string|null, misses:number, repeats:number}} FindState */

/** @returns {FindState} */
export function createFind() {
  return { phase: "idle", timer: FIND.firstAskS, target: null, last: null, misses: 0, repeats: 0 };
}

const gap = (rng) => FIND.gapMinS + rng() * (FIND.gapMaxS - FIND.gapMinS);

/**
 * Advances the timers. Mutates and returns `f` plus at most one event.
 * @param {FindState} f
 * @param {number} dt seconds
 * @param {{enabled:boolean, candidates:string[], calm:boolean}} ctx
 * @param {() => number} rng
 * @returns {{type:'ask', thingId:string, repeat:boolean} | {type:'give-up', thingId:string} | null}
 */
export function stepFind(f, dt, { enabled, candidates, calm }, rng) {
  if (!enabled || candidates.length === 0) {
    if (f.phase !== "idle" || f.target) Object.assign(f, { phase: "idle", target: null, misses: 0, repeats: 0 });
    f.timer = FIND.firstAskS;
    return null;
  }
  if (f.target && !candidates.includes(f.target)) {
    Object.assign(f, { phase: "idle", target: null, misses: 0, repeats: 0, timer: FIND.firstAskS });
    return null;
  }
  if (!calm || dt <= 0) return null;
  f.timer -= dt;
  if (f.timer > 0) return null;
  switch (f.phase) {
    case "idle": {
      const pool = candidates.length > 1 ? candidates.filter((id) => id !== f.last) : candidates;
      const thingId = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
      Object.assign(f, { phase: "asking", target: thingId, last: thingId, misses: 0, repeats: 0, timer: FIND.repeatAfterS });
      return { type: "ask", thingId, repeat: false };
    }
    case "asking": {
      if (f.repeats < FIND.maxRepeats) {
        f.repeats += 1;
        f.timer = FIND.repeatAfterS;
        return { type: "ask", thingId: f.target, repeat: true };
      }
      const thingId = f.target;
      Object.assign(f, { phase: "idle", target: null, misses: 0, repeats: 0, timer: gap(rng) });
      return { type: "give-up", thingId };
    }
    case "celebrate":
    default:
      Object.assign(f, { phase: "idle", target: null, misses: 0, repeats: 0, timer: gap(rng) });
      return null;
  }
}

/**
 * A tap while Find it may be asking.
 * @returns {'none'|'correct'|'wrong'}  'none' when nothing is being asked (a normal tap)
 */
export function answerFind(f, thingId) {
  if (f.phase !== "asking") return "none";
  if (thingId === f.target) {
    Object.assign(f, { phase: "celebrate", timer: FIND.celebrateS });
    return "correct";
  }
  f.misses += 1;
  f.timer = FIND.repeatAfterS; // the repeat after the wrong thing's name restarts the wait
  f.repeats = 0;
  return "wrong";
}

/** The thing to glow as a hint, or null (US-6.2: after 2 misses the right thing glows). */
export function hintFor(f) {
  return f.phase === "asking" && f.misses >= FIND.hintAfterMisses ? f.target : null;
}

/** Seconds until the next event, Infinity when off. */
export function findRemainingS(f, enabled) {
  return enabled ? Math.max(0, f.timer) : Infinity;
}
