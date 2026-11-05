// The animal library (pure). QA round 3: "a library showing all animal creations with images, from
// which an animal can be added to any scene", plus pre-made examples, and new scenes seeded with
// "random animals that we have in the repertoire".
//
// Owns:
//   - what the library lists: the family's own things across every scene (one per distinct look,
//     the one with most recordings first), then the pre-made examples (web/data/library.json);
//   - `thingKey`, the translation-free identity of a thing's look and words, used to fold copies;
//   - where a copy lands in a scene (`placeCopy`: the free spot on the ground farthest from
//     the things already there);
//   - copying a thing with its recordings (`copyOf`) and picking a new scene's seeds (`pickSeeds`).
// Promises: data in, data out; deterministic for a given env (ids, now) and rng; inputs are never
// mutated. Recordings are content addressed (Clip.blobSha256), so a copy's clips point at the same
// blobs and the orphan sweep keeps them while any clip uses them: deleting the original never
// breaks the copy, and no blob is copied.
import { bbox } from "../geometry/stroke.js";

/** A new scene gets this many random things, at most (and always leaves room for one more). */
export const SEED_MIN = 3;
export const SEED_MAX = 4;

/** Where the ground starts (fraction of board height) per backdrop; copies stand below it. */
export const GROUND_AT = Object.freeze({ meadow: 0.6, sea: 0.55, room: 0.68, blank: 0.82 });
/** Where a copy's body may end (its bottom edge), lowest first; 0.92 keeps its legs on the board. */
const ROWS = Object.freeze([0.92, 0.85, 0.78, 0.71]);
const EDGE = 0.04; // board widths kept clear at the sides
const ASPECT = 0.75; // board height over width: distances in board widths
const COLUMNS = 9;

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
  const b = bbox(thing.outline);
  const rx = (x) => round3(x - b.x);
  const ry = (y) => round3(y - b.y);
  return JSON.stringify([
    sorted(thing.names),
    thing.color,
    thing.motion?.preset ?? null,
    sorted(thing.cues).map(([lang, cue]) => [lang, sorted(cue)]),
    thing.outline.map(([x, y]) => [rx(x), ry(y)]),
    (thing.eyes ?? []).map((e) => [rx(e.x), ry(e.y)]),
    (thing.legs ?? []).map((l) => [rx(l.x), ry(l.y)]),
  ]);
}

/**
 * @typedef {{key: string, thing: import('../types.js').Thing, clips: import('../types.js').Clip[], example: boolean}} LibraryEntry
 * What the library shows. `own`: the family's things in scene order, one per key (the one with the
 * most recordings). A thing that is an untouched copy of an example (same key, no recordings) is
 * listed only as that example. `examples`: the pre-made things, one per key.
 * @param {import('../types.js').Snapshot} s
 * @param {import('../types.js').Thing[]} [examples]
 * @returns {{own: LibraryEntry[], examples: LibraryEntry[]}}
 */
export function libraryEntries(s, examples = []) {
  const exampleList = [];
  const exampleKeys = new Set();
  for (const thing of examples) {
    const key = thingKey(thing);
    if (exampleKeys.has(key)) continue;
    exampleKeys.add(key);
    exampleList.push({ key, thing, clips: [], example: true });
  }
  const byId = new Map(s.things.map((t) => [t.id, t]));
  const ordered = [];
  for (const place of s.places) for (const id of place.thingOrder) if (byId.has(id)) ordered.push(byId.get(id));
  const own = new Map();
  for (const thing of ordered) {
    const clips = s.clips.filter((c) => c.thingId === thing.id);
    const key = thingKey(thing);
    if (!clips.length && exampleKeys.has(key)) continue;
    const seen = own.get(key);
    if (!seen || clips.length > seen.clips.length) own.set(key, { key, thing, clips, example: false });
  }
  // A Map keeps first-insertion order, so a better duplicate takes its original's place.
  return { own: [...own.values()], examples: exampleList };
}

/** A thing's box in board units, padded nowhere. */
function boxOf(outline) {
  const b = bbox(outline);
  return { left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h };
}

/** Gap between two boxes in board widths (negative when they overlap). */
function gapBetween(a, b) {
  const gx = Math.max(a.left - b.right, b.left - a.right);
  const gy = Math.max(a.top - b.bottom, b.top - a.bottom) * ASPECT;
  return gx > 0 && gy > 0 ? Math.hypot(gx, gy) : Math.max(gx, gy);
}

/**
 * The move (dx, dy), rounded to the stored 3 decimals, that puts `outline` on a free spot of the
 * ground of `place`: candidates in rows across the ground band, the one farthest from every
 * box in `others` wins, and ties go to the one nearest the middle. Deterministic.
 * @param {[number, number][]} outline
 * @param {{left:number,right:number,top:number,bottom:number}[]} others  boxes already in the scene
 * @param {{backdrop?: string}} [place]
 * @returns {{dx: number, dy: number}}
 */
export function placeCopy(outline, others, place = {}) {
  const b = boxOf(outline);
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const ground = GROUND_AT[place.backdrop] ?? GROUND_AT.meadow;
  // Bottom rows from low on the ground up to just below where the ground starts.
  const rows = ROWS.filter((r) => r >= ground + 0.05);
  if (!rows.length) rows.push(ROWS[0]);
  const lo = EDGE + w / 2;
  const hi = 1 - EDGE - w / 2;
  const xs = [];
  if (hi <= lo) xs.push(0.5);
  else for (let i = 0; i < COLUMNS; i++) xs.push(lo + ((hi - lo) * i) / (COLUMNS - 1));
  xs.sort((a, c) => Math.abs(a - 0.5) - Math.abs(c - 0.5));
  let best = null;
  for (const bottom of rows) {
    for (const cx of xs) {
      const box = { left: cx - w / 2, right: cx + w / 2, top: bottom - h, bottom };
      const score = others.length ? Math.min(...others.map((o) => gapBetween(box, o))) : 1;
      if (!best || score > best.score + 1e-9) best = { score, cx, bottom };
    }
  }
  return { dx: round3(best.cx - (b.left + w / 2)), dy: round3(best.bottom - b.bottom) };
}

/** The boxes of the things in a place, for placeCopy. */
export function boxesIn(s, placeId) {
  return s.things.filter((t) => t.placeId === placeId).map((t) => boxOf(t.outline));
}

/**
 * A new, independent copy of `thing` (and its thing clips) in `placeId`, moved by (dx, dy). Fresh
 * ids and dates; everything else is kept: names, questions, colour, eyes, legs, motion, and every
 * recording (same blobs, new clip records).
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
    .map((c) => ({ ...c, id: env.newId(), thingId: id, createdAt: now }));
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
