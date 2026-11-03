// Sleep timer (US-5.4): after `sleepMinutes` of play the things yawn and fall asleep. 0 = off.
// The state is a small mutable record so the play loop allocates nothing; time is passed in.

/** @typedef {{limitS: number, elapsedS: number, asleep: boolean, paused: boolean}} SleepState */

/** @returns {SleepState} */
export function createSleep(minutes) {
  const m = typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  return { limitS: m * 60, elapsedS: 0, asleep: false, paused: false };
}

/** Advances the timer by dt seconds. Returns true on the step it falls asleep. */
export function tickSleep(state, dt) {
  if (state.limitS <= 0 || state.asleep || state.paused || !(dt > 0)) return false;
  state.elapsedS += dt;
  if (state.elapsedS < state.limitS) return false;
  state.asleep = true;
  return true;
}

/** Seconds until it falls asleep; Infinity when off, paused or already asleep. */
export function sleepRemainingS(state) {
  if (state.limitS <= 0 || state.asleep || state.paused) return Infinity;
  return Math.max(0, state.limitS - state.elapsedS);
}
