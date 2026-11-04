// Presets → poses (ARCHITECTURE §6). A preset is data (web/data/motions/<id>.json); a thing's
// motion.params are dotted overrides ("travel.speed": 0.8). pose() writes into a reusable Pose
// so the play loop allocates nothing. How many legs a thing has is the thing's (Thing.legs): the
// caller sizes pose.legs; the preset's legs block only says how they swing.
import { travel, bob, squash, tilt, legs, blink } from "./blocks.js";

/** Every preset shipped in web/data/motions/ (main.js loads them all at boot). */
export const PRESET_IDS = Object.freeze(["walk", "hop", "scuttle", "float", "swim"]);

/** The preset used when a thing names one that is not loaded: stands still, blinks. */
export const STILL = Object.freeze({ id: "still", version: 1, blink: { duration: 0.18, intervalMin: 2.5, intervalMax: 6 } });

/**
 * Does a preset keep its feet on the ground (walkers: walk, hop, scuttle)? Data-driven: the preset's
 * `ground` flag; a preset without one counts as grounded when it travels on the ground or hops.
 * The renderer draws a contact shadow for grounded things.
 * @param {Object=} preset
 */
export function isGrounded(preset) {
  if (typeof preset?.ground === "boolean") return preset.ground;
  const mode = preset?.travel?.mode;
  return mode === "ground" || mode === "hop";
}

/**
 * Applies dotted overrides to a preset. Never mutates the preset. Only finite numbers override.
 * @param {Object} preset
 * @param {Object<string, number>=} params
 */
export function resolveMotion(preset, params) {
  const out = JSON.parse(JSON.stringify(preset ?? STILL));
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const [block, field, ...rest] = key.split(".");
    if (!block || !field || rest.length || block === "__proto__" || field === "__proto__") continue;
    if (typeof out[block] !== "object" || out[block] === null) out[block] = {};
    out[block][field] = value;
  }
  return out;
}

/** @returns {import('../types.js').Pose} */
export function newPose(nLegs = 0) {
  return { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, legs: new Array(nLegs).fill(0), eyeOpen: 1 };
}

/** Puts a pose at rest (no offset, no squash, legs straight, eyes open). Keeps the legs array. */
export function restPose(out, nLegs) {
  out.dx = 0; out.dy = 0; out.rot = 0; out.sx = 1; out.sy = 1; out.eyeOpen = 1;
  if (out.legs.length !== nLegs) out.legs.length = nLegs;
  for (let i = 0; i < nLegs; i++) out.legs[i] = 0;
  return out;
}

/**
 * The pose of a resolved motion at motion time t. Writes one swing angle per entry of out.legs.
 * @param {Object} resolved   from resolveMotion
 * @param {number} t          seconds of motion time
 * @param {{move?: number, blinkT?: number}} state  move: 0 still … 1 full motion (ramps in and out); blinkT: s since blink start, < 0 none
 * @param {import('../types.js').Pose} out
 */
export function pose(resolved, t, state, out) {
  const m = state.move ?? 1;
  const n = out.legs.length;
  restPose(out, n);
  if (m > 0) {
    out.dy = (travel(t, resolved.travel) + bob(t, resolved.bob)) * m;
    const s = squash(t, resolved.squash) * m;
    out.sx = 1 + s;
    out.sy = 1 - s;
    out.rot = tilt(t, resolved.tilt) * m;
    for (let i = 0; i < n; i++) out.legs[i] = legs(t, resolved.legs, i) * m;
  }
  out.eyeOpen = blink(state.blinkT ?? -1, resolved.blink);
  return out;
}
