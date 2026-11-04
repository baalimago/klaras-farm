// The snapshot as a whole: creation, validation, canonical form and migration.
import { isColorKey, SIMPLE_COLORS } from "./palette.js";
import { MAX_LEGS, isLeg, legacyLegCount, spreadLegs } from "./legs.js";

// Format history (additive only, ARCHITECTURE §9.5):
//   1: first release
//   2: optional Place.findIt (Find it on for this place; absent = on (find buttons shown))
//   3: Thing.legs (hips placed by the parent, 0–8); before, the motion preset implied the legs.
//      minReaderFormat stays 1: an older app still validates and plays a format 3 file (it ignores
//      legs and draws its preset legs, and keeps the field when it saves the thing), which is
//      better than refusing the import on a device that has not updated yet.
//   4: Settings.maxThings (1–12, default 8; it was a fixed 4 per place). Question prompts take 1–6
//      and Cue.lines holds 1–6 free-text questions (its length is the number of questions).
//      Family colour game clips: kind 'color-word' (with `color`, a simple colour) and
//      'color-question', both with thingId null. minReaderFormat is 4: a format 3 app would call
//      such a file damaged (thingId null, takes over 3, more than 4 things), so it says
//      "made by a newer version" instead.
export const FORMAT_VERSION = 4;
export const MIN_READER_FORMAT = 4;
/** Things per place: the family's cap is `settings.maxThings`, from 1 to MAX_THINGS_LIMIT. */
export const MAX_THINGS_LIMIT = 12;
export const DEFAULT_MAX_THINGS = 8;
/** The hard ceiling validation allows in one place (the family's cap is settings.maxThings). */
export const MAX_THINGS_PER_PLACE = MAX_THINGS_LIMIT;
/** Questions per thing and language (Cue.lines, prompt takes), and colour question takes. */
export const MAX_QUESTIONS = 6;
export const THING_CLIP_KINDS = Object.freeze(["name", "prompt", "sound"]);
/** Family-level clips for the colour game: their thingId is null. */
export const GAME_CLIP_KINDS = Object.freeze(["color-word", "color-question"]);
export const CLIP_KINDS = Object.freeze([...THING_CLIP_KINDS, ...GAME_CLIP_KINDS]);
export const BACKDROPS = Object.freeze(["meadow", "sea", "room", "blank"]);
/** The shipped motion presets (web/data/motions/, motion/pose.js PRESET_IDS). `motion.preset` is validated only as a string. */
export const MOTION_PRESETS = Object.freeze(["walk", "hop", "scuttle", "float", "swim"]);

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
    playLanguage: "alternate", // "Mix languages" is the default: random recorded language per tap
    sleepMinutes: 8,
    gateKind: "keypad",
    reduceMotion: false,
    maxThings: DEFAULT_MAX_THINGS,
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
  if (!isMaxThings(st.maxThings)) return fail("settings.maxThings invalid");

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
    if ("findIt" in p && typeof p.findIt !== "boolean") return fail(`place ${p.id}: findIt`);
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
    if (!Array.isArray(t.legs) || t.legs.length > MAX_LEGS || !t.legs.every(isLeg)) return fail(`thing ${t.id}: legs`);
    if (t.motion?.kind !== "preset" || !isStr(t.motion.preset) || typeof t.motion.params !== "object")
      return fail(`thing ${t.id}: motion`);
    if (!t.cues || typeof t.cues !== "object" || !Object.values(t.cues).every(isCue)) return fail(`thing ${t.id}: cues`);
    if (!isIso(t.createdAt) || !isIso(t.updatedAt)) return fail(`thing ${t.id}: dates`);
  }
  // Lowering settings.maxThings never removes things, so only the hard ceiling is checked here.
  for (const [placeId, n] of perPlace) if (n > MAX_THINGS_LIMIT) return fail(`place ${placeId}: more than ${MAX_THINGS_LIMIT} things`);
  for (const p of s.places) for (const id of p.thingOrder) if (!thingIds.has(id)) return fail(`place ${p.id}: thingOrder`);

  const clipIds = new Set();
  const clipKeys = new Set();
  for (const c of s.clips) {
    if (!isStr(c?.id) || clipIds.has(c.id)) return fail("clip id missing or duplicated");
    clipIds.add(c.id);
    const owner = clipOwnerError(c, thingIds);
    if (owner) return fail(`clip ${c.id}: ${owner}`);
    if (!isLang(c.language) || !isTake(c.take)) return fail(`clip ${c.id}: key`);
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

const isTake = (v) => Number.isInteger(v) && v >= 1 && v <= MAX_QUESTIONS;
const isMaxThings = (v) => Number.isInteger(v) && v >= 1 && v <= MAX_THINGS_LIMIT;

/** A Cue: optional `lines` (up to MAX_QUESTIONS strings) and an optional `article`. */
function isCue(c) {
  if (!c || typeof c !== "object") return false;
  if (c.lines !== undefined && !(Array.isArray(c.lines) && c.lines.length <= MAX_QUESTIONS && c.lines.every((l) => l === null || isStr(l)))) return false;
  return c.article === undefined || isStr(c.article);
}

/** A colour game clip: family-level, so its thingId is null. */
export function isGameClip(c) {
  return c?.thingId === null && GAME_CLIP_KINDS.includes(c.kind);
}

function clipOwnerError(c, thingIds) {
  if (c.thingId === null) {
    if (!GAME_CLIP_KINDS.includes(c.kind)) return "kind";
    if (c.kind === "color-word" && !SIMPLE_COLORS.includes(c.color)) return "colour";
    return null;
  }
  if (!thingIds.has(c.thingId)) return "unknown thing";
  return THING_CLIP_KINDS.includes(c.kind) ? null : "kind";
}

/**
 * Uniqueness key of a clip. Thing clips: (thingId, language, kind, take), a one-way door.
 * Game clips (thingId null): (language, kind, colour, take).
 */
export function clipKey(c) {
  if (c.thingId == null) return `game|${c.language}|${c.kind}|${c.color ?? ""}|${c.take}`;
  return `${c.thingId}|${c.language}|${c.kind}|${c.take}`;
}

/** Steps a snapshot up to FORMAT_VERSION, one version at a time. Pure. */
const STEPS = {
  // 1 → 2: Place.findIt is optional, so only the version moves.
  1: (s) => ({ ...s, formatVersion: 2 }),
  // 2 → 3: legs become data. Each thing gets the legs its preset used to draw, where it drew them.
  // Things that already carry legs keep them (the step is safe to run on mixed data).
  2: (s) => ({ ...s, formatVersion: 3, things: (s.things ?? []).map(withLegacyLegs) }),
  // 3 → 4: the per-place cap becomes a setting (default 8). Cue lines and clips keep their meaning:
  // an empty line still means "the example question", and takes 1–3 stay where they were.
  3: (s) => ({ ...s, formatVersion: 4, settings: withMaxThings(s.settings) }),
};

/** Settings as format 4 has them: `maxThings` set (default 8) when it is missing or out of range. */
export function withMaxThings(settings) {
  if (!settings || typeof settings !== "object" || isMaxThings(settings.maxThings)) return settings;
  return { ...settings, maxThings: DEFAULT_MAX_THINGS };
}

/** A thing as it looked before format 3: legs from its motion preset, spread along the bottom. */
export function withLegacyLegs(t) {
  if (!t || Array.isArray(t.legs)) return t;
  const n = Array.isArray(t.outline) && t.outline.length >= 3 ? legacyLegCount(t.motion) : 0;
  return { ...t, legs: n ? spreadLegs(t.outline, n) : [] };
}

/**
 * The format of records read back from storage, which carry no version. Things without legs are
 * format 2; stored settings without `maxThings` are format 3. No settings (a fresh install) tells nothing.
 */
export function storedFormat(things, settings = null) {
  if ((things ?? []).some((t) => !Array.isArray(t?.legs))) return 2;
  if (settings && typeof settings === "object" && !isMaxThings(settings.maxThings)) return 3;
  return FORMAT_VERSION;
}

export function migrate(s) {
  let out = s;
  while (out.formatVersion < FORMAT_VERSION) out = STEPS[out.formatVersion](out);
  // A newer file that is still readable (minReaderFormat ≤ ours) is kept as is: unknown additive
  // fields are preserved.
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
