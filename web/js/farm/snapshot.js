// The snapshot as a whole: creation, validation, canonical form and migration.
import { isColorKey } from "./palette.js";

export const FORMAT_VERSION = 1;
export const MIN_READER_FORMAT = 1;
export const MAX_THINGS_PER_PLACE = 4;
export const CLIP_KINDS = Object.freeze(["name", "prompt", "sound"]);
export const BACKDROPS = Object.freeze(["meadow", "sea", "room", "blank"]);
export const MOTION_PRESETS = Object.freeze(["walk", "float"]);

/** @param {import('../types.js').Env} env @param {string} appVersion */
export function emptySnapshot(env, appVersion = "dev") {
  return {
    formatVersion: FORMAT_VERSION,
    minReaderFormat: MIN_READER_FORMAT,
    appVersion,
    exportedAt: env.now(),
    deviceId: env.deviceId,
    settings: defaultSettings(env),
    places: [],
    things: [],
    clips: [],
  };
}

/** @param {import('../types.js').Env} env @returns {import('../types.js').Settings} */
export function defaultSettings(env, lang = "en") {
  return {
    languages: [lang],
    playLanguage: lang,
    sleepMinutes: 8,
    gateKind: "keypad",
    reduceMotion: false,
    currentPlaceId: null,
    welcomed: false,
    updatedAt: env.now(),
  };
}

const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
const isIso = (v) => isStr(v) && !Number.isNaN(Date.parse(v));
const isLang = (v) => isStr(v) && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v);

/**
 * Structural validation. Never throws.
 * @param {any} s
 * @param {{blobShas?: Set<string>}} [opts]  when given, every clip must reference a known blob
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateSnapshot(s, opts = {}) {
  const fail = (error) => ({ ok: false, error });
  if (!s || typeof s !== "object") return fail("not an object");
  if (!Number.isInteger(s.formatVersion) || s.formatVersion < 1) return fail("formatVersion missing");
  if (!Number.isInteger(s.minReaderFormat)) return fail("minReaderFormat missing");
  if (s.minReaderFormat > FORMAT_VERSION) return fail("made by a newer app");
  for (const key of ["places", "things", "clips"]) if (!Array.isArray(s[key])) return fail(`${key} missing`);
  const st = s.settings;
  if (!st || !Array.isArray(st.languages) || !st.languages.every(isLang)) return fail("settings.languages invalid");
  if (!(st.playLanguage === "alternate" || isLang(st.playLanguage))) return fail("settings.playLanguage invalid");
  if (!isNum(st.sleepMinutes) || st.sleepMinutes < 0) return fail("settings.sleepMinutes invalid");

  const placeIds = new Set();
  for (const p of s.places) {
    if (!isStr(p?.id) || placeIds.has(p.id)) return fail("place id missing or duplicated");
    placeIds.add(p.id);
    if (!isStr(p.name)) return fail(`place ${p.id}: name`);
    if (!BACKDROPS.includes(p.backdrop)) return fail(`place ${p.id}: backdrop`);
    if (!isColorKey(p.skyColor) || !isColorKey(p.groundColor)) return fail(`place ${p.id}: colours`);
    if (!Array.isArray(p.pieces) || !Array.isArray(p.thingOrder)) return fail(`place ${p.id}: pieces`);
    for (const piece of p.pieces) {
      if (!isStr(piece?.id) || !["shape", "yarn"].includes(piece.kind)) return fail(`place ${p.id}: piece kind`);
      if (!Array.isArray(piece.stroke) || piece.stroke.length < 2 || !piece.stroke.every(isPoint))
        return fail(`place ${p.id}: piece stroke`);
      if (!isColorKey(piece.color)) return fail(`place ${p.id}: piece colour`);
    }
    if (!isIso(p.createdAt) || !isIso(p.updatedAt)) return fail(`place ${p.id}: dates`);
  }
  if (st.currentPlaceId !== null && !placeIds.has(st.currentPlaceId)) return fail("settings.currentPlaceId unknown");

  const thingIds = new Set();
  const perPlace = new Map();
  for (const t of s.things) {
    if (!isStr(t?.id) || thingIds.has(t.id)) return fail("thing id missing or duplicated");
    thingIds.add(t.id);
    if (!placeIds.has(t.placeId)) return fail(`thing ${t.id}: unknown place`);
    perPlace.set(t.placeId, (perPlace.get(t.placeId) ?? 0) + 1);
    if (!t.names || typeof t.names !== "object") return fail(`thing ${t.id}: names`);
    if (!Array.isArray(t.outline) || t.outline.length < 3 || !t.outline.every(isPoint)) return fail(`thing ${t.id}: outline`);
    if (!isColorKey(t.color)) return fail(`thing ${t.id}: colour`);
    if (!Array.isArray(t.eyes) || t.eyes.length > 2 || !t.eyes.every((e) => isNum(e?.x) && isNum(e?.y)))
      return fail(`thing ${t.id}: eyes`);
    if (t.motion?.kind !== "preset" || !isStr(t.motion.preset) || typeof t.motion.params !== "object")
      return fail(`thing ${t.id}: motion`);
    if (!t.cues || typeof t.cues !== "object") return fail(`thing ${t.id}: cues`);
    if (!isIso(t.createdAt) || !isIso(t.updatedAt)) return fail(`thing ${t.id}: dates`);
  }
  for (const [placeId, n] of perPlace) if (n > MAX_THINGS_PER_PLACE) return fail(`place ${placeId}: more than ${MAX_THINGS_PER_PLACE} things`);
  for (const p of s.places) for (const id of p.thingOrder) if (!thingIds.has(id)) return fail(`place ${p.id}: thingOrder`);

  const clipIds = new Set();
  const clipKeys = new Set();
  for (const c of s.clips) {
    if (!isStr(c?.id) || clipIds.has(c.id)) return fail("clip id missing or duplicated");
    clipIds.add(c.id);
    if (!thingIds.has(c.thingId)) return fail(`clip ${c.id}: unknown thing`);
    if (!isLang(c.language) || !CLIP_KINDS.includes(c.kind) || !Number.isInteger(c.take) || c.take < 1 || c.take > 3)
      return fail(`clip ${c.id}: key`);
    const key = clipKey(c);
    if (clipKeys.has(key)) return fail(`clip ${c.id}: duplicate key ${key}`);
    clipKeys.add(key);
    if (!isStr(c.blobSha256) || !/^[0-9a-f]{64}$/.test(c.blobSha256)) return fail(`clip ${c.id}: blob`);
    if (opts.blobShas && !opts.blobShas.has(c.blobSha256)) return fail(`clip ${c.id}: blob missing`);
    if (!isStr(c.mime)) return fail(`clip ${c.id}: mime`);
    for (const k of ["durationMs", "trimStartMs", "trimEndMs", "gainDb"]) if (!isNum(c[k])) return fail(`clip ${c.id}: ${k}`);
  }
  return { ok: true };
}

/** Uniqueness key of a clip: (thingId, language, kind, take). One-way door. */
export function clipKey(c) {
  return `${c.thingId}|${c.language}|${c.kind}|${c.take}`;
}

/** Steps a snapshot up to FORMAT_VERSION, one version at a time. Pure. */
export function migrate(s) {
  let out = s;
  // Future: while (out.formatVersion < FORMAT_VERSION) out = STEPS[out.formatVersion](out);
  if (out.formatVersion > FORMAT_VERSION && out.minReaderFormat <= FORMAT_VERSION) {
    // A newer, still-readable file: keep known fields; unknown additive fields are preserved as-is.
    return out;
  }
  return out;
}

/** JSON with sorted keys and entity arrays sorted by id: equal data ⇒ equal string. */
export function canonicalJson(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object" && !(v instanceof ArrayBuffer)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

/** Snapshot with entity arrays in id order, for comparison and export. */
export function canonicalSnapshot(s) {
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { ...s, places: [...s.places].sort(byId), things: [...s.things].sort(byId), clips: [...s.clips].sort(byId) };
}

/** Rounds a point list to 3 decimals (stored precision). */
export function roundPoints(points) {
  return points.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}
