// The animal library (pure). QA round 3: "a library showing all animal creations with images, from
// which an animal can be added to any scene", plus pre-made examples, and new scenes seeded with
// "random animals that we have in the repertoire".
//
// Owns:
//   - what the library lists: the family's own things across every scene (one per distinct look,
//     the one with most recordings first), then the pre-made examples (web/data/library.json);
//   - `thingKey`, the translation-free identity of a thing's look and words, used to fold copies;
//   - copying a thing with its recordings (`copyOf`) and picking a new scene's seeds (`pickSeeds`).
// Promises: data in, data out; deterministic for a given env (ids, now) and rng; inputs are never
// mutated. Recordings are content addressed (Clip.blobSha256), so a copy's clips point at the same
// blobs and the orphan sweep keeps them while any clip uses them: deleting the original never
// breaks the copy, and no blob is copied.
import { bbox } from "../geometry/stroke.js";

/** A new scene gets this many random things, at most (and always leaves room for one more). */
export const SEED_MIN = 3;
export const SEED_MAX = 4;

const round3 = (v) => Math.round(v * 1000) / 1000;

/** Sorted [key, value] pairs, so equal objects give equal strings whatever their key order. */
function sorted(obj) {
  return Object.entries(obj ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The look and words of a thing, independent of where it stands: names, colour, motion, cues, and
 * the outline, eyes and legs relative to the outline's top-left corner. A copy has the same key as
 * its original until one of them is changed.
 * @param {import('../types.js').Thing} thing
 */
export function thingKey(thing) {
  return JSON.stringify([sorted(thing.names), ...lookParts(thing)]);
}

/** thingKey without the names: what an example and a starter thing from an older build share. */
function lookKey(thing) {
  return JSON.stringify(lookParts(thing));
}

function lookParts(thing) {
  const b = bbox(thing.outline);
  const rx = (x) => round3(x - b.x);
  const ry = (y) => round3(y - b.y);
  return [
    thing.color,
    thing.motion?.preset ?? null,
    sorted(thing.cues).map(([lang, cue]) => [lang, sorted(cue)]),
    thing.outline.map(([x, y]) => [rx(x), ry(y)]),
    (thing.eyes ?? []).map((e) => [rx(e.x), ry(e.y)]),
    (thing.legs ?? []).map((l) => [rx(l.x), ry(l.y)]),
  ];
}

/**
 * True when `thing` is an untouched copy of `example`: the same look, and every name it has is the
 * example's name in that language. The example may have names the thing lacks: a starter thing
 * from an older build misses the languages added since (QA round 3 added Finnish), and must still
 * be listed (and seeded) once, as its example. A renamed thing, or one given a name in a language
 * the example lacks, is the family's own.
 */
function untouchedCopy(thing, example) {
  const names = Object.entries(thing.names ?? {});
  return names.length > 0 && names.every(([lang, name]) => example.names?.[lang] === name);
}

/**
 * @typedef {{key: string, thing: import('../types.js').Thing, clips: import('../types.js').Clip[], example: boolean}} LibraryEntry
 * What the library shows. `own`: the family's things in scene order, one per key (the one with the
 * most recordings). A thing that is an untouched copy of an example (no recordings, the same look,
 * and names the example has: `untouchedCopy`) is listed only as that example. `examples`: the pre-made things, one per key.
 * @param {import('../types.js').Snapshot} s
 * @param {import('../types.js').Thing[]} [examples]
 * @returns {{own: LibraryEntry[], examples: LibraryEntry[]}}
 */
export function libraryEntries(s, examples = []) {
  const exampleList = [];
  const exampleKeys = new Set();
  const byLook = new Map(); // lookKey -> examples with that look
  for (const thing of examples) {
    const key = thingKey(thing);
    if (exampleKeys.has(key)) continue;
    exampleKeys.add(key);
    exampleList.push({ key, thing, clips: [], example: true });
    const look = lookKey(thing);
    byLook.set(look, [...(byLook.get(look) ?? []), thing]);
  }
  const isExample = (thing) => (byLook.get(lookKey(thing)) ?? []).some((e) => untouchedCopy(thing, e));
  const byId = new Map(s.things.map((t) => [t.id, t]));
  const ordered = [];
  for (const place of s.places) for (const id of place.thingOrder) if (byId.has(id)) ordered.push(byId.get(id));
  const own = new Map();
  for (const thing of ordered) {
    const clips = s.clips.filter((c) => c.thingId === thing.id);
    const key = thingKey(thing);
    if (!clips.length && isExample(thing)) continue;
    const seen = own.get(key);
    if (!seen || clips.length > seen.clips.length) own.set(key, { key, thing, clips, example: false });
  }
  // A Map keeps first-insertion order, so a better duplicate takes its original's place.
  return { own: [...own.values()], examples: exampleList };
}

/**
 * A new, independent copy of `thing` (and its thing clips) in `placeId`, moved by (dx, dy) (where
 * play/placement.js placeThing puts it). Fresh ids, and the thing's dates; everything else is kept:
 * names, questions, colour, eyes, legs, motion, and every recording (same blobs and createdAt, new
 * clip records).
 * @returns {{thing: import('../types.js').Thing, clips: import('../types.js').Clip[]}}
 */
export function copyOf(thing, clips, { placeId, dx = 0, dy = 0 }, env) {
  const now = env.now();
  const id = env.newId();
  const copy = {
    ...JSON.parse(JSON.stringify(thing)),
    id,
    placeId,
    outline: thing.outline.map(([x, y]) => [round3(x + dx), round3(y + dy)]),
    eyes: (thing.eyes ?? []).map((e) => ({ x: round3(e.x + dx), y: round3(e.y + dy) })),
    legs: (thing.legs ?? []).map((l) => ({ x: round3(l.x + dx), y: round3(l.y + dy) })),
    createdAt: now,
    updatedAt: now,
  };
  const copied = clips
    .filter((c) => c.thingId === thing.id)
    // A clip keeps its createdAt: it is the same recording, and soundClip plays the newest one.
    .map((c) => ({ ...c, id: env.newId(), thingId: id }));
  return { thing: copy, clips: copied };
}

/**
 * `n` distinct entries of `pool`, picked at random with `rng` (a partial Fisher-Yates shuffle).
 * @template T
 * @param {T[]} pool
 * @param {number} n
 * @param {() => number} rng  0 <= rng() < 1
 * @returns {T[]}
 */
export function pickSeeds(pool, n, rng) {
  const list = [...pool];
  const count = Math.max(0, Math.min(n, list.length));
  for (let i = 0; i < count; i++) {
    const j = i + Math.min(list.length - i - 1, Math.floor(rng() * (list.length - i)));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, count);
}

/** How many things seed a new scene: SEED_MIN to SEED_MAX at random, leaving room for one more. */
export function seedCount(cap, poolSize, rng) {
  const n = SEED_MIN + Math.min(SEED_MAX - SEED_MIN, Math.floor(rng() * (SEED_MAX - SEED_MIN + 1)));
  return Math.max(0, Math.min(n, cap - 1, poolSize));
}
