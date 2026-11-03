// Find games (US-6.2, 6.3, playtest round 2): started on purpose by the child pressing a button on
// the play screen, never by themselves. Pure state machine; the engine plays the audio and hops.
//
//   Game 1, 'animal': "Where is the cow?" (then the cow's own sound as a clue); the cow is right.
//   Game 2, 'color':  "Find something yellow!"; any thing whose felt is yellow is right.
//
//   idle ──startRound──▶ asking ──right tap──▶ idle (celebration)
//                          │ wrong tap: the tapped thing says its name, the question repeats;
//                          │   after 2 misses the right thing(s) glow and hop
//                          │ ~6 s quiet without the right tap: the right thing(s) hop, the question repeats once
//                          └─ ~30 s without the right tap: the round ends quietly (no failure sound)
import { colorGroup } from "./colors.js";

export const FIND = Object.freeze({
  nudgeAfterS: 6,    // quiet seconds (no voice playing) before the hop + repeat
  timeoutS: 30,      // a round ends gently after this long
  hintAfterMisses: 2,
});

/**
 * @typedef {{phase:'idle'|'asking', kind:'animal'|'color'|null, target:string|null, color:string|null,
 *   last:string|null, lastColor:string|null, misses:number, quietS:number, roundS:number, nudged:boolean}} FindState
 * @typedef {{id:string, color:string, askable?:boolean}} FindThing  askable: has a recorded or speakable name
 */

/** @returns {FindState} */
export function createFind() {
  return { phase: "idle", kind: null, target: null, color: null, last: null, lastColor: null, misses: 0, quietS: 0, roundS: 0, nudged: false };
}

const pick = (pool, rng) => pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
const notLast = (pool, last) => (pool.length > 1 ? pool.filter((x) => x !== last) : pool);

/**
 * Starts a round (replacing any round in progress).
 * Animal: prefers things that can be asked for by name, never the last target when there are two or more.
 * Colour: a simple colour present among the things, never the last one when there are two or more.
 * @param {FindState} f
 * @param {'animal'|'color'} kind
 * @param {FindThing[]} things
 * @param {() => number} rng
 * @returns {{type:'ask', kind:'animal'|'color', thingId:string|null, color:string|null} | null}  null: nothing to find
 */
export function startRound(f, kind, things, rng) {
  endRound(f);
  if (!things.length) return null;
  if (kind === "color") {
    const groups = [...new Set(things.map((t) => colorGroup(t.color)).filter(Boolean))];
    if (!groups.length) return null;
    const color = pick(notLast(groups, f.lastColor), rng);
    Object.assign(f, { phase: "asking", kind, target: null, color, lastColor: color });
    return { type: "ask", kind, thingId: null, color };
  }
  const askable = things.filter((t) => t.askable).map((t) => t.id);
  const pool = askable.length ? askable : things.map((t) => t.id);
  const target = pick(notLast(pool, f.last), rng);
  Object.assign(f, { phase: "asking", kind: "animal", target, color: null, last: target });
  return { type: "ask", kind: "animal", thingId: target, color: null };
}

/** Ends the round without fuss (edit mode, sleep, place change). Remembers the last target. */
export function endRound(f) {
  Object.assign(f, { phase: "idle", kind: null, target: null, color: null, misses: 0, quietS: 0, roundS: 0, nudged: false });
  return f;
}

/**
 * Advances the round timers. `calm` is false while a voice plays (the nudge waits for quiet).
 * @param {FindState} f
 * @param {number} dt seconds
 * @param {{calm:boolean}} ctx
 * @returns {{type:'nudge'} | {type:'timeout'} | null}
 */
export function stepFind(f, dt, { calm }) {
  if (f.phase !== "asking" || !(dt > 0)) return null;
  f.roundS += dt;
  if (f.roundS >= FIND.timeoutS) {
    endRound(f);
    return { type: "timeout" };
  }
  if (!calm) return null;
  f.quietS += dt;
  if (!f.nudged && f.quietS >= FIND.nudgeAfterS) {
    f.nudged = true;
    f.quietS = 0;
    return { type: "nudge" };
  }
  return null;
}

/** True when this thing answers the current round. */
export function isAnswer(f, thingId, color) {
  if (f.phase !== "asking") return false;
  return f.kind === "color" ? colorGroup(color) === f.color : thingId === f.target;
}

/**
 * A tap during a round.
 * @returns {'none'|'correct'|'wrong'}  'none' when no round is on (a normal tap)
 */
export function answerFind(f, thingId, color) {
  if (f.phase !== "asking") return "none";
  if (isAnswer(f, thingId, color)) {
    endRound(f);
    return "correct";
  }
  f.misses += 1;
  f.quietS = 0; // the question repeats after the tapped thing's name: the wait starts again
  return "wrong";
}

/** True when the right thing(s) should glow (after 2 misses). */
export function hinting(f) {
  return f.phase === "asking" && f.misses >= FIND.hintAfterMisses;
}

/** Ends the round if its target (or every thing of its colour) is gone. Returns true if it ended. */
export function reconcileFind(f, things) {
  if (f.phase !== "asking") return false;
  const alive = things.some((t) => isAnswer(f, t.id, t.color));
  if (!alive) endRound(f);
  return !alive;
}

/** Seconds until the next timer event (nudge or timeout), Infinity when no round is on. */
export function findRemainingS(f) {
  if (f.phase !== "asking") return Infinity;
  const timeout = FIND.timeoutS - f.roundS;
  const nudge = f.nudged ? Infinity : FIND.nudgeAfterS - f.quietS;
  return Math.max(0, Math.min(timeout, nudge));
}
