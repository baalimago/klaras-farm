// Auto-stop for recordings (US-4.1), as a pure reducer fed with (time since start, level).
// Calibrate the room's noise floor in the first 300 ms; once speech has been heard
// (level above floor + margin), stop after ~800 ms below it; always stop at the 5 s cap.
import { noiseFloor } from "./level.js";

export const AUTO_STOP = Object.freeze({
  calibrateMs: 300,
  silenceMs: 800,
  marginDb: 10,
  capMs: 5000,
  minFloorDb: -70, // a muted or digitally silent input still gets a meaningful threshold
  maxFloorDb: -35, // talking straight away must not become "the noise floor"
});

/**
 * @typedef {Object} AutoStopState
 * @property {typeof AUTO_STOP} opts
 * @property {{t:number, db:number}[]} calibration
 * @property {number|null} floorDb
 * @property {number|null} heardAt       ms of the first loud frame
 * @property {number|null} lastLoudAt    ms of the latest loud frame
 * @property {null|'silence'|'cap'} stop
 * @property {number|null} stopAtMs
 */

/** @returns {AutoStopState} */
export function autoStopInit(opts = {}) {
  return { opts: { ...AUTO_STOP, ...opts }, calibration: [], floorDb: null, heardAt: null, lastLoudAt: null, stop: null, stopAtMs: null };
}

/** One level reading at `tMs` after the recording started. Returns a new state. */
export function autoStopStep(state, tMs, levelDb) {
  if (state.stop) return state;
  const o = state.opts;
  if (tMs >= o.capMs) return { ...state, stop: "cap", stopAtMs: tMs };
  if (state.floorDb === null && tMs <= o.calibrateMs) {
    return { ...state, calibration: [...state.calibration, { t: tMs, db: levelDb }] };
  }

  let s = state;
  if (s.floorDb === null) {
    const raw = noiseFloor(s.calibration.map((c) => c.db));
    const floorDb = Math.min(o.maxFloorDb, Math.max(o.minFloorDb, raw));
    const loud = s.calibration.filter((c) => c.db > floorDb + o.marginDb);
    s = { ...s, floorDb, heardAt: loud[0]?.t ?? null, lastLoudAt: loud.at(-1)?.t ?? null };
  }

  if (levelDb > s.floorDb + o.marginDb) {
    return { ...s, heardAt: s.heardAt ?? tMs, lastLoudAt: tMs };
  }
  if (s.heardAt !== null && tMs - s.lastLoudAt >= o.silenceMs) {
    return { ...s, stop: "silence", stopAtMs: tMs };
  }
  return s;
}
