// Mash policy (US-5.1): tapping the playing thing restarts it only after 300 ms; tapping a
// different thing stops the current clip and plays the new one; nothing queues.

export const RESTART_MS = 300;

/** @typedef {{playingId: string|null, startedAt: number, token: number}} MashState */

/** @returns {MashState} */
export const idleMash = () => ({ playingId: null, startedAt: 0, token: 0 });

/**
 * @param {MashState} state
 * @param {string} thingId
 * @param {number} nowMs
 * @returns {{action: 'play'|'restart'|'ignore', stopCurrent: boolean}}
 */
export function decideTap(state, thingId, nowMs) {
  if (state.playingId === null) return { action: "play", stopCurrent: false };
  if (state.playingId !== thingId) return { action: "play", stopCurrent: true };
  if (nowMs - state.startedAt < RESTART_MS) return { action: "ignore", stopCurrent: false };
  return { action: "restart", stopCurrent: true };
}

/** A new play started; its token identifies it when it ends. */
export function startPlaying(state, thingId, nowMs) {
  return { playingId: thingId, startedAt: nowMs, token: state.token + 1 };
}

/** The play with this token ended. A stale token (an older play) changes nothing. */
export function stopPlaying(state, token) {
  if (token !== state.token || state.playingId === null) return state;
  return { playingId: null, startedAt: 0, token: state.token };
}
