// Legs (pure). A thing's legs are hips {x, y} in board coordinates inside its outline, placed by
// the parent like eyes. Every leg hangs straight down from its hip; its foot sits a fixed felt-leg
// length below the outline edge under the hip, so a hip placed high in the body still shows a
// full leg. Shared by the snapshot migration, the renderer and the parent previews.

export const MAX_LEGS = 8;
/** The counts the parent can pick from. */
export const LEG_COUNTS = Object.freeze([0, 1, 2, 3, 4, 6, 8]);
/** Hips of spread legs sit this far above the outline's bottom edge (3 px of a 600 px board). */
export const HIP_INSET = 3 / 600;
const LEG_MIN = 8 / 600;
export const LEG_MAX = 34 / 600;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round3 = (v) => Math.round(v * 1000) / 1000;

/** A valid stored leg: {x, y} with finite numbers. */
export const isLeg = (l) => !!l && isNum(l.x) && isNum(l.y);

function box(outline) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of outline) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The y where each outline edge crosses the vertical line at x, calling fn(y) for each. */
function crossings(outline, x, fn) {
  for (let i = 0, m = outline.length; i < m; i++) {
    const p = outline[i], q = outline[(i + 1) % m];
    if ((p[0] <= x && q[0] >= x) || (q[0] <= x && p[0] >= x)) {
      const t = q[0] === p[0] ? 0 : (x - p[0]) / (q[0] - p[0]);
      fn(p[1] + (q[1] - p[1]) * t);
    }
  }
}

/** Lowest point of the outline at x (board y), or the bbox bottom when x is outside it. */
export function bottomAt(outline, x) {
  let lowest = -Infinity;
  crossings(outline, x, (y) => { if (y > lowest) lowest = y; });
  return Number.isFinite(lowest) ? lowest : box(outline).y + box(outline).h;
}

/** The first outline edge straight below (x, y): where the leg leaves the body. */
export function edgeBelow(outline, x, y) {
  let best = Infinity, lowest = -Infinity;
  crossings(outline, x, (yy) => {
    if (yy > lowest) lowest = yy;
    if (yy >= y - 1e-9 && yy < best) best = yy;
  });
  if (Number.isFinite(best)) return best;
  return Number.isFinite(lowest) ? Math.max(lowest, y) : y;
}

/** Visible felt-leg length below the body in board-y units, scaled to the thing's height. */
export function legLength(outline) {
  const h = box(outline).h;
  return Math.max(LEG_MIN, Math.min(LEG_MAX, 0.35 * h));
}

/** Foot y of a leg (board units): the edge under the hip plus the leg length. */
export function footY(outline, leg, len = legLength(outline)) {
  return edgeBelow(outline, leg.x, leg.y) + len - HIP_INSET;
}

/**
 * n hips spread across the middle of the outline's bottom, just above the edge. This is where the
 * renderer drew a walker's implicit legs before format 3, so migrated things look the same.
 */
export function spreadLegs(outline, n) {
  const b = box(outline);
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = b.x + b.w * (n === 1 ? 0.5 : 0.22 + (0.56 * k) / (n - 1));
    out.push({ x: round3(x), y: round3(bottomAt(outline, x) - HIP_INSET) });
  }
  return out;
}

/** How many legs a thing's motion drew before format 3 (walk 2, scuttle 6, others none). */
export function legacyLegCount(motion) {
  const override = motion?.params?.["legs.count"];
  const n = isNum(override) ? override : motion?.preset === "walk" ? 2 : motion?.preset === "scuttle" ? 6 : 0;
  return Math.max(0, Math.min(MAX_LEGS, Math.round(n)));
}

/** Stored form of a list of legs: at most MAX_LEGS, 3 decimals. */
export function cleanLegs(legs) {
  return (Array.isArray(legs) ? legs : []).filter(isLeg).slice(0, MAX_LEGS).map((l) => ({ x: round3(l.x), y: round3(l.y) }));
}
