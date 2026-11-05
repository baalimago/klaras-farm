// Where a new thing lands in a scene (pure). One rule for every way a thing arrives: a copy from
// the animal library, the animals that seed a new scene, and an animal just drawn in guided add
// (QA round 3 review: new animals landed in the sky or on the top edge, because each placed itself
// against the farm's saved positions while the animals had wandered, and the edit-mode spread then
// pushed the newcomer away).
//
// Contract: placeThing(thing, occupied, place) returns the move {dx, dy} (rounded to the stored 3
// decimals) that puts the thing on a spot the edit-mode spread (play/spread.js EDIT_SPREAD) leaves
// alone: clear of every box in `occupied` (with the gap, the badge room and the edit bar) and on
// the board. A walker (walk, hop, scuttle, or a motion it does not know) stands in the ground band
// of the backdrop, or when that is full higher up the walking ground (feet at or below GROUND_TOP, as
// play/world.js keeps them); a floater (float, swim) may then also go above it.
// Among the free spots the one farthest from the others wins; ties go to the middle, then the
// lowest. When no spot is free, it lands on the ground where it overlaps least (the spread then
// moves it, and keeps a walker on the ground: SpreadBox.floor).
// `occupied` should be where things stand now (PlayEngine.occupied: the live actors, legs
// included); thingBoxes() gives the saved positions when nothing is live (a new scene, tests).
// Deterministic; 13 x 15 candidates at most per pass, each checked against at most 12 boxes.
import { centroid, extents } from "./hit.js";
import { crowding, EDIT_SPREAD } from "./spread.js";
import { GROUND_TOP } from "./world.js";
import { LEG_MAX } from "../farm/legs.js";

/** Where the ground starts (fraction of board height) per backdrop, as the backdrops paint it. */
export const GROUND_AT = Object.freeze({ meadow: 0.6, sea: 0.55, room: 0.68, blank: 0.82 });
/** Motions that leave the ground (play/world.js travel mode "water"); every other one walks. */
const FLOATERS = Object.freeze(["float", "swim"]);
const ROWS = 15;
const COLUMNS = 13;
const ASPECT = 0.75; // board height over width: distances in board widths
const SLACK = 0.002; // absorbs rounding to 3 decimals, so the spread finds the spot exactly free
const ROOM = Object.freeze({ ...EDIT_SPREAD, gap: EDIT_SPREAD.gap + SLACK });

const round3 = (v) => Math.round(v * 1000) / 1000;

/** True when the thing walks (its feet stay in the ground band). */
export function isWalker(thing) {
  return !FLOATERS.includes(thing.motion?.preset);
}

/**
 * The room a thing takes where it is saved, as a spread box: anchor at its outline's centroid,
 * extents, legs below, and for a walker the floor of the ground band (as play/world.js boxes actors).
 * @param {import('../types.js').Thing} thing
 * @returns {import('./spread.js').SpreadBox}
 */
export function thingBox(thing) {
  const [x, y] = centroid(thing.outline);
  const e = extents(thing.outline, x, y);
  const legs = Array.isArray(thing.legs) && thing.legs.length > 0 ? LEG_MAX : 0;
  const box = { x, y, left: e.left, right: e.right, top: e.top, bottom: e.bottom + legs };
  return isWalker(thing) ? { ...box, floor: GROUND_TOP - e.bottom } : box;
}

/** The saved boxes of a place's things. */
export function thingBoxes(s, placeId) {
  return s.things.filter((t) => t.placeId === placeId).map(thingBox);
}

/** Gap between two boxes in board widths (negative when they overlap). */
function gapBetween(a, b) {
  const gx = Math.max(a.x - a.left - (b.x + b.right), b.x - b.left - (a.x + a.right));
  const gy = Math.max(a.y - a.top - (b.y + b.bottom), b.y - b.top - (a.y + a.bottom)) * ASPECT;
  return gx > 0 && gy > 0 ? Math.hypot(gx, gy) : Math.max(gx, gy);
}

/** n evenly spaced values from a to b (both included); just `a` when they meet. */
function steps(a, b, n) {
  if (b - a < 1e-9) return [a];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/**
 * @param {import('../types.js').Thing} thing  its outline, legs and motion
 * @param {import('./spread.js').SpreadBox[]} occupied  where the scene's things stand
 * @param {{backdrop?: string}} [place]
 * @returns {{dx: number, dy: number}}
 */
export function placeThing(thing, occupied, place = {}) {
  const box = thingBox(thing);
  const feet = extents(thing.outline, box.x, box.y).bottom; // centroid to the outline's bottom edge
  const { margin, minHalfWidth } = ROOM;
  const half = Math.max(box.left, box.right, minHalfWidth);
  const ground = Math.max(GROUND_AT[place.backdrop] ?? GROUND_AT.meadow, GROUND_TOP);
  // Centroid heights: lowest with the legs' tips at the board's margin, highest with the outline's
  // bottom a little below where the ground starts; never with the top off the board.
  const top = box.top + margin;
  const lowest = Math.max(1 - margin - box.bottom, top);
  const onGround = Math.min(lowest, Math.max(ground + 0.05 - feet, top));
  const groundRows = steps(onGround, lowest, ROWS).reverse();
  // Still walking ground, between the line walkers keep their feet below (GROUND_TOP) and the band.
  const highest = Math.max(GROUND_TOP - feet, top);
  const highRows = onGround - highest < 0.01 ? [] : steps(highest, onGround - 0.01, ROWS).reverse();
  const skyRows = isWalker(thing) || highest - top < 0.02 ? [] : steps(top, highest - 0.02, ROWS).reverse();
  const xs = 2 * (half + margin) >= 1 ? [0.5] : steps(half + margin, 1 - half - margin, COLUMNS).sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
  const at = pick(box, xs, groundRows, occupied) ?? pick(box, xs, highRows, occupied) ?? pick(box, xs, skyRows, occupied)
    ?? leastCrowded(box, xs, [...groundRows, ...highRows], occupied);
  return { dx: round3(at.x - box.x), dy: round3(at.y - box.y) };
}

/** The free spot farthest from the others (ties: nearest the middle, then the lowest), or null. */
function pick(box, xs, rows, occupied) {
  let best = null;
  for (const x of xs) {
    for (const y of rows) {
      const b = { ...box, x, y };
      if (crowding(b, occupied, ROOM) > 0) continue;
      const score = occupied.length ? Math.min(...occupied.map((o) => gapBetween(b, o))) : 1;
      if (!best || score > best.score + 1e-9) best = { score, x, y };
    }
  }
  return best;
}

/** Nothing is free: the ground spot that overlaps least. */
function leastCrowded(box, xs, rows, occupied) {
  let best = null;
  for (const x of xs) {
    for (const y of rows) {
      const hit = crowding({ ...box, x, y }, occupied, ROOM);
      if (!best || hit < best.hit - 1e-12) best = { hit, x, y };
    }
  }
  return best;
}
