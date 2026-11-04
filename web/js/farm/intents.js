// Pure intents: (snapshot, args, env) → { snapshot, writes, change }.
// They never mutate their input. FarmStore applies `writes` in one transaction,
// then swaps in `snapshot` and emits `change`.
import { BACKDROPS, DEFAULT_MAX_THINGS, MAX_THINGS_LIMIT, MAX_QUESTIONS, THING_CLIP_KINDS, GAME_CLIP_KINDS, clipKey, roundPoints } from "./snapshot.js";
import { isColorKey, SIMPLE_COLORS } from "./palette.js";
import { cleanLegs, isLeg, MAX_LEGS } from "./legs.js";
import { questionCount } from "./scripts.js";

export class FarmError extends Error {
  /** @param {string} code  e.g. 'place-full', 'not-found', 'invalid', 'storage' */
  constructor(code, message = code) {
    super(message);
    this.name = "FarmError";
    this.code = code;
  }
}

const put = (store, value) => ({ store, op: "put", value });
const del = (store, key) => ({ store, op: "delete", key });
const change = (kind, ids) => ({ kind, ids });

function findPlace(s, placeId) {
  const p = s.places.find((x) => x.id === placeId);
  if (!p) throw new FarmError("not-found", `place ${placeId}`);
  return p;
}
function findThing(s, thingId) {
  const t = s.things.find((x) => x.id === thingId);
  if (!t) throw new FarmError("not-found", `thing ${thingId}`);
  return t;
}
const replace = (list, item) => list.map((x) => (x.id === item.id ? item : x));
function checkColor(key) {
  if (!isColorKey(key)) throw new FarmError("invalid", `colour ${key}`);
}
function checkStroke(points, min) {
  if (!Array.isArray(points) || points.length < min) throw new FarmError("invalid", "stroke too short");
}

// ---------- places ----------

export function createPlace(s, { name, backdrop = "meadow", skyColor = "sky", groundColor = "grass", pieces = [] }, env) {
  if (!BACKDROPS.includes(backdrop)) throw new FarmError("invalid", `backdrop ${backdrop}`);
  checkColor(skyColor);
  checkColor(groundColor);
  const now = env.now();
  const place = {
    id: env.newId(),
    name: String(name ?? "").trim() || "New scene",
    backdrop,
    skyColor,
    groundColor,
    pieces: pieces.map((p) => ({ ...p, id: p.id ?? env.newId(), stroke: roundPoints(p.stroke) })),
    thingOrder: [],
    createdAt: now,
    updatedAt: now,
  };
  const settings = { ...s.settings, currentPlaceId: place.id, updatedAt: now };
  return {
    snapshot: { ...s, places: [...s.places, place], settings },
    writes: [put("places", place), put("settings", settings)],
    change: change("place-created", [place.id]),
  };
}

export function renamePlace(s, { placeId, name }, env) {
  const place = { ...findPlace(s, placeId), name: String(name).trim() || "Scene", updatedAt: env.now() };
  return { snapshot: { ...s, places: replace(s.places, place) }, writes: [put("places", place)], change: change("place-renamed", [placeId]) };
}

export function updatePlace(s, { placeId, patch }, env) {
  const old = findPlace(s, placeId);
  const allowed = {};
  if ("skyColor" in patch) (checkColor(patch.skyColor), (allowed.skyColor = patch.skyColor));
  if ("groundColor" in patch) (checkColor(patch.groundColor), (allowed.groundColor = patch.groundColor));
  if ("backdrop" in patch) {
    if (!BACKDROPS.includes(patch.backdrop)) throw new FarmError("invalid", "backdrop");
    allowed.backdrop = patch.backdrop;
  }
  if ("findIt" in patch) allowed.findIt = !!patch.findIt;
  if ("pieces" in patch) allowed.pieces = patch.pieces.map((p) => ({ ...p, stroke: roundPoints(p.stroke) }));
  const place = { ...old, ...allowed, updatedAt: env.now() };
  return { snapshot: { ...s, places: replace(s.places, place) }, writes: [put("places", place)], change: change("place-updated", [placeId]) };
}

/** Deletes a place with its things and clips. Blobs are left for the orphan sweep. */
export function deletePlace(s, { placeId }, env) {
  findPlace(s, placeId);
  const things = s.things.filter((t) => t.placeId === placeId);
  const thingIds = new Set(things.map((t) => t.id));
  const clips = s.clips.filter((c) => thingIds.has(c.thingId));
  const places = s.places.filter((p) => p.id !== placeId);
  let settings = s.settings;
  const writes = [del("places", placeId), ...things.map((t) => del("things", t.id)), ...clips.map((c) => del("clips", c.id))];
  if (settings.currentPlaceId === placeId) {
    settings = { ...settings, currentPlaceId: places[0]?.id ?? null, updatedAt: env.now() };
    writes.push(put("settings", settings));
  }
  return {
    snapshot: { ...s, places, things: s.things.filter((t) => !thingIds.has(t.id)), clips: s.clips.filter((c) => !thingIds.has(c.thingId)), settings },
    writes,
    change: change("place-deleted", [placeId]),
  };
}

export function setCurrentPlace(s, { placeId }, env) {
  findPlace(s, placeId);
  const settings = { ...s.settings, currentPlaceId: placeId, updatedAt: env.now() };
  return { snapshot: { ...s, settings }, writes: [put("settings", settings)], change: change("place-switched", [placeId]) };
}

export function addPiece(s, { placeId, piece }, env) {
  const old = findPlace(s, placeId);
  if (!["shape", "yarn"].includes(piece.kind)) throw new FarmError("invalid", "piece kind");
  checkColor(piece.color);
  checkStroke(piece.stroke, piece.kind === "shape" ? 3 : 2);
  const p = { id: env.newId(), kind: piece.kind, stroke: roundPoints(piece.stroke), color: piece.color };
  const place = { ...old, pieces: [...old.pieces, p], updatedAt: env.now() };
  return { snapshot: { ...s, places: replace(s.places, place) }, writes: [put("places", place)], change: change("piece-added", [placeId, p.id]) };
}

export function updatePiece(s, { placeId, pieceId, patch }, env) {
  const old = findPlace(s, placeId);
  if (!old.pieces.some((p) => p.id === pieceId)) throw new FarmError("not-found", `piece ${pieceId}`);
  if (patch.color) checkColor(patch.color);
  const pieces = old.pieces.map((p) =>
    p.id === pieceId ? { ...p, ...(patch.color ? { color: patch.color } : {}), ...(patch.stroke ? { stroke: roundPoints(patch.stroke) } : {}) } : p,
  );
  const place = { ...old, pieces, updatedAt: env.now() };
  return { snapshot: { ...s, places: replace(s.places, place) }, writes: [put("places", place)], change: change("piece-updated", [placeId, pieceId]) };
}

export function removePiece(s, { placeId, pieceId }, env) {
  const old = findPlace(s, placeId);
  const place = { ...old, pieces: old.pieces.filter((p) => p.id !== pieceId), updatedAt: env.now() };
  return { snapshot: { ...s, places: replace(s.places, place) }, writes: [put("places", place)], change: change("piece-removed", [placeId, pieceId]) };
}

// ---------- things ----------

/** The family's things-per-place cap (Settings → Things per scene), 1 to 12, default 8. */
export function maxThings(s) {
  const n = s.settings?.maxThings;
  return Number.isInteger(n) && n >= 1 && n <= MAX_THINGS_LIMIT ? n : DEFAULT_MAX_THINGS;
}

export function canAddThing(s, placeId) {
  return s.things.filter((t) => t.placeId === placeId).length < maxThings(s);
}

/**
 * @param {{placeId:string, names?:Object, outline:[number,number][], color:string, eyes?:any[], legs?:any[], motion?:any, cues?:Object, clips?:any[]}} args
 *   clips: clip records without id/thingId (blobs already stored); they are attached to the new thing.
 */
export function addThing(s, args, env) {
  const place = findPlace(s, args.placeId);
  if (!canAddThing(s, place.id)) throw new FarmError("place-full", `a place holds at most ${maxThings(s)} things`);
  checkColor(args.color);
  checkStroke(args.outline, 3);
  checkLegs(args.legs);
  const now = env.now();
  const thing = {
    id: env.newId(),
    placeId: place.id,
    names: { ...(args.names ?? {}) },
    outline: roundPoints(args.outline),
    color: args.color,
    eyes: (args.eyes ?? []).slice(0, 2).map((e) => ({ x: round3(e.x), y: round3(e.y) })),
    legs: cleanLegs(args.legs),
    motion: args.motion ?? { kind: "preset", preset: "walk", params: {} },
    cues: { ...(args.cues ?? {}) },
    createdAt: now,
    updatedAt: now,
  };
  const clips = (args.clips ?? []).map((c) => ({ ...c, id: c.id ?? env.newId(), thingId: thing.id, createdAt: c.createdAt ?? now }));
  const newPlace = { ...place, thingOrder: [...place.thingOrder, thing.id], updatedAt: now };
  return {
    snapshot: { ...s, things: [...s.things, thing], clips: [...s.clips, ...clips], places: replace(s.places, newPlace) },
    writes: [put("things", thing), put("places", newPlace), ...clips.map((c) => put("clips", c))],
    change: change("thing-added", [thing.id]),
  };
}

const THING_PATCHABLE = ["names", "outline", "color", "eyes", "legs", "motion", "cues"];

/** Legs are optional (none), else up to MAX_LEGS hips {x, y}. */
function checkLegs(legs) {
  if (legs === undefined) return;
  if (!Array.isArray(legs) || legs.length > MAX_LEGS || !legs.every(isLeg))
    throw new FarmError("invalid", `legs: up to ${MAX_LEGS} points {x, y}`);
}

/** Rename, recolour, redraw, re-eye, change motion or cues. Recordings are kept. */
export function updateThing(s, { thingId, patch }, env) {
  const old = findThing(s, thingId);
  const next = { ...old };
  for (const key of THING_PATCHABLE) {
    if (!(key in patch)) continue;
    if (key === "color") checkColor(patch.color);
    if (key === "outline") checkStroke(patch.outline, 3);
    if (key === "legs") checkLegs(patch.legs);
    next[key] = key === "outline" ? roundPoints(patch.outline) : key === "legs" ? cleanLegs(patch.legs) : patch[key];
  }
  next.updatedAt = env.now();
  return { snapshot: { ...s, things: replace(s.things, next) }, writes: [put("things", next)], change: change("thing-updated", [thingId]) };
}

/** Deletes a thing and its clips. `change.removed` carries what Undo needs. */
export function deleteThing(s, { thingId }, env) {
  const thing = findThing(s, thingId);
  const clips = s.clips.filter((c) => c.thingId === thingId);
  const old = findPlace(s, thing.placeId);
  const place = { ...old, thingOrder: old.thingOrder.filter((id) => id !== thingId), updatedAt: env.now() };
  return {
    snapshot: { ...s, things: s.things.filter((t) => t.id !== thingId), clips: s.clips.filter((c) => c.thingId !== thingId), places: replace(s.places, place) },
    writes: [del("things", thingId), ...clips.map((c) => del("clips", c.id)), put("places", place)],
    change: { ...change("thing-deleted", [thingId]), removed: { thing, clips, index: old.thingOrder.indexOf(thingId) } },
  };
}

/** Undo of deleteThing. Blobs survive because the orphan sweep only removes blobs older than 24 h. */
export function restoreThing(s, { thing, clips, index = -1 }, env) {
  const old = findPlace(s, thing.placeId);
  if (!canAddThing(s, old.id)) throw new FarmError("place-full");
  const order = [...old.thingOrder];
  order.splice(index < 0 ? order.length : index, 0, thing.id);
  const place = { ...old, thingOrder: order, updatedAt: env.now() };
  return {
    snapshot: { ...s, things: [...s.things, thing], clips: [...s.clips, ...clips], places: replace(s.places, place) },
    writes: [put("things", thing), ...clips.map((c) => put("clips", c)), put("places", place)],
    change: change("thing-restored", [thing.id]),
  };
}

// ---------- clips ----------

/** A clip's owner and kind: a thing's own clip, or a colour game clip (thingId null). */
function checkClipOwner(s, clip) {
  if (clip.thingId === null || clip.thingId === undefined) {
    if (!GAME_CLIP_KINDS.includes(clip.kind)) throw new FarmError("invalid", "clip kind");
    if (clip.kind === "color-word" && !SIMPLE_COLORS.includes(clip.color)) throw new FarmError("invalid", "colour word without a colour");
    return;
  }
  findThing(s, clip.thingId);
  if (!THING_CLIP_KINDS.includes(clip.kind)) throw new FarmError("invalid", "clip kind");
}

/**
 * Saves a clip, replacing any clip with the same key (clipKey: thing, language, kind, take; or for
 * colour game clips language, kind, colour, take). The old clip is replaced only now, when the new
 * one is saved (US-4.7).
 * @param {{clip: Omit<import('../types.js').Clip,'id'|'createdAt'>, blob?: import('../types.js').BlobRecord}} args
 */
export function saveClip(s, { clip: input, blob }, env) {
  const game = input.thingId === null || input.thingId === undefined;
  const clip = game ? { ...input, thingId: null } : input;
  checkClipOwner(s, clip);
  if (!Number.isInteger(clip.take) || clip.take < 1 || clip.take > MAX_QUESTIONS) throw new FarmError("invalid", "clip take");
  if (game && clip.kind === "color-question") delete clip.color;
  const key = clipKey(clip);
  const previous = s.clips.find((c) => clipKey(c) === key);
  const saved = { ...clip, id: env.newId(), createdAt: env.now() };
  const writes = [];
  if (blob) writes.push(put("blobs", blob));
  if (previous) writes.push(del("clips", previous.id));
  writes.push(put("clips", saved));
  return {
    snapshot: { ...s, clips: [...s.clips.filter((c) => c !== previous), saved] },
    writes,
    change: change("clip-saved", game ? [saved.id] : [clip.thingId, saved.id]),
  };
}

export function deleteClip(s, { clipId }) {
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip) throw new FarmError("not-found", `clip ${clipId}`);
  const ids = clip.thingId === null ? [clipId] : [clip.thingId, clipId];
  return { snapshot: { ...s, clips: s.clips.filter((c) => c.id !== clipId) }, writes: [del("clips", clipId)], change: change("clip-deleted", ids) };
}

// ---------- questions ("Where is the…?", US-4.8) ----------
// Cue.lines are free text, 1 to MAX_QUESTIONS per thing and language; an empty line plays the
// script example. Prompt take n is the recording of line n, so removing a line renumbers the
// recordings after it.

/** The parent's lines for a language, at its current length (empty strings stand for examples). */
function linesOf(thing, language) {
  const n = questionCount(thing, language);
  const lines = thing.cues?.[language]?.lines ?? [];
  return Array.from({ length: n }, (_, i) => String(lines[i] ?? "").trim());
}

function withLines(s, thing, language, lines, env) {
  const cues = { ...(thing.cues ?? {}), [language]: { ...(thing.cues?.[language] ?? {}), lines } };
  const next = { ...thing, cues, updatedAt: env.now() };
  return { snapshot: { ...s, things: replace(s.things, next) }, write: put("things", next) };
}

/** Changes the text of question `index` (0-based). Empty text goes back to the example. */
export function setQuestionLine(s, { thingId, language, index, text }, env) {
  const thing = findThing(s, thingId);
  const lines = linesOf(thing, language);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) throw new FarmError("invalid", "question index");
  lines[index] = String(text ?? "").trim();
  const r = withLines(s, thing, language, lines, env);
  return { snapshot: r.snapshot, writes: [r.write], change: change("thing-updated", [thingId]) };
}

/** Adds a question at the end (up to MAX_QUESTIONS). Empty text means "the example". */
export function addQuestion(s, { thingId, language, text = "" }, env) {
  const thing = findThing(s, thingId);
  const lines = linesOf(thing, language);
  if (lines.length >= MAX_QUESTIONS) throw new FarmError("invalid", `at most ${MAX_QUESTIONS} questions`);
  const r = withLines(s, thing, language, [...lines, String(text).trim()], env);
  return { snapshot: r.snapshot, writes: [r.write], change: change("thing-updated", [thingId]) };
}

/**
 * Removes question `index` (at least one stays) with its recording; later recordings move up one
 * take so each stays with its line. Blobs are left for the orphan sweep.
 */
export function removeQuestion(s, { thingId, language, index }, env) {
  const thing = findThing(s, thingId);
  const lines = linesOf(thing, language);
  if (lines.length <= 1) throw new FarmError("invalid", "at least one question");
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) throw new FarmError("invalid", "question index");
  lines.splice(index, 1);
  const r = withLines(s, thing, language, lines, env);
  const take = index + 1;
  const prompts = s.clips.filter((c) => c.thingId === thingId && c.language === language && c.kind === "prompt");
  const gone = prompts.filter((c) => c.take === take);
  // Ascending order: each take moves into the slot just vacated, so no two clips share a key at any step.
  const moved = prompts.filter((c) => c.take > take).sort((a, b) => a.take - b.take).map((c) => ({ ...c, take: c.take - 1 }));
  const movedIds = new Map(moved.map((c) => [c.id, c]));
  const clips = r.snapshot.clips.filter((c) => !gone.includes(c)).map((c) => movedIds.get(c.id) ?? c);
  return {
    snapshot: { ...r.snapshot, clips },
    writes: [r.write, ...gone.map((c) => del("clips", c.id)), ...moved.map((c) => put("clips", c))],
    change: change("thing-updated", [thingId]),
  };
}

// ---------- settings ----------

const SETTINGS_PATCHABLE = ["languages", "playLanguage", "sleepMinutes", "gateKind", "reduceMotion", "welcomed", "maxThings"];

export function updateSettings(s, { patch }, env) {
  const settings = { ...s.settings };
  for (const key of SETTINGS_PATCHABLE) if (key in patch) settings[key] = patch[key];
  if (!Array.isArray(settings.languages) || settings.languages.length === 0) throw new FarmError("invalid", "at least one language");
  // Lowering the cap never removes things; it only stops new ones being added to a full scene.
  if ("maxThings" in patch && !(Number.isInteger(patch.maxThings) && patch.maxThings >= 1 && patch.maxThings <= MAX_THINGS_LIMIT))
    throw new FarmError("invalid", `things per scene: 1 to ${MAX_THINGS_LIMIT}`);
  // Mixing is the default: going from one language to several turns it on, unless the
  // same patch chose a language on purpose.
  if (!("playLanguage" in patch) && s.settings.languages.length === 1 && settings.languages.length > 1) settings.playLanguage = "alternate";
  if (settings.playLanguage !== "alternate" && !settings.languages.includes(settings.playLanguage)) settings.playLanguage = settings.languages[0];
  settings.updatedAt = env.now();
  return { snapshot: { ...s, settings }, writes: [put("settings", settings)], change: change("settings-updated", []) };
}

// ---------- queries ----------

export function thingsIn(s, placeId) {
  const place = s.places.find((p) => p.id === placeId);
  if (!place) return [];
  const byId = new Map(s.things.map((t) => [t.id, t]));
  return place.thingOrder.map((id) => byId.get(id)).filter(Boolean);
}

export function clipsFor(s, thingId, { language, kind } = {}) {
  return s.clips
    .filter((c) => c.thingId === thingId && (!language || c.language === language) && (!kind || c.kind === kind))
    .sort((a, b) => a.take - b.take);
}

/**
 * Colour game clips (thingId null), sorted by take.
 * @param {{kind?:'color-word'|'color-question', language?:string, color?:string}} [filter]
 */
export function gameClips(s, { kind, language, color } = {}) {
  return s.clips
    .filter((c) => c.thingId === null && (!kind || c.kind === kind) && (!language || c.language === language) && (!color || c.color === color))
    .sort((a, b) => a.take - b.take);
}

/**
 * Which language plays now. `alternate` (shown as "Mix languages") picks a random language on
 * each tap, from the ones recorded for this thing (`available`) when there are any, so the
 * mix never lands on a silent language; otherwise from the family's languages.
 */
export function playLanguageFor(settings, { available = [], rng = () => 0 } = {}) {
  if (settings.playLanguage !== "alternate") return settings.playLanguage;
  const recorded = settings.languages.filter((l) => available.includes(l));
  const pool = recorded.length ? recorded : settings.languages;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * Clips to play when a thing is tapped: its name, then its sound. Falls back to any language
 * that has a name clip when the play language has none.
 */
export function tapClips(s, thingId, language) {
  const names = clipsFor(s, thingId, { kind: "name" });
  const name = names.find((c) => c.language === language) ?? names[0] ?? null;
  const sounds = clipsFor(s, thingId, { kind: "sound" });
  const sound = sounds.find((c) => c.language === language) ?? sounds[0] ?? null;
  return [name, sound].filter(Boolean);
}

const round3 = (v) => Math.round(v * 1000) / 1000;
