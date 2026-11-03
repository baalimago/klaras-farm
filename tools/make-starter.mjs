#!/usr/bin/env node
// Generates web/data/starter.json: the Farm, Sea and Kitchen a fresh install opens with (US-1.1).
// Things are drawn in the same format parents create: one closed outline polygon in board coordinates,
// one felt colour, 0–2 eyes, a motion preset. Each outline is the union of a few ellipses, rectangles
// and thick lines, rasterised and traced into a single polygon, then simplified and smoothed.
//   node tools/make-starter.mjs           writes the file
//   node tools/make-starter.mjs --check   exits 1 if the file is out of date
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { simplify, smooth, snapInside, pointInPolygon, signedArea } from "../web/js/geometry/stroke.js";
import { roundPoints, FORMAT_VERSION, MIN_READER_FORMAT } from "../web/js/farm/snapshot.js";

// Shapes are designed on a virtual 1200 × 900 board (4:3, square pixels), then normalised to 0..1.
const VW = 1200, VH = 900;
const T0 = "2026-01-01T00:00:00.000Z";
export const STARTER_PATH = resolve(fileURLToPath(import.meta.url), "../../web/data/starter.json");

// ---------- deterministic randomness for the hand-made wobble ----------
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- primitives (local units; scaled by S and placed later) ----------
const E = (cx, cy, rx, ry) => ({ t: "e", cx, cy, rx, ry });
const P = (...pts) => ({ t: "p", pts });
const R = (x0, y0, x1, y1) => P([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const C = (w, ...pts) => ({ t: "c", w, pts }); // thick polyline (capsules)

function insideShape(s, x, y) {
  if (s.t === "e") return ((x - s.cx) / s.rx) ** 2 + ((y - s.cy) / s.ry) ** 2 <= 1;
  if (s.t === "p") return pointInPolygon([x, y], s.pts);
  for (let i = 0; i < s.pts.length - 1; i++) {
    const [ax, ay] = s.pts[i], [bx, by] = s.pts[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (l2 || 1)));
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) <= s.w) return true;
  }
  return false;
}

/** Moore-neighbour trace of the outer boundary of a union of shapes. Returns virtual px points. */
function traceUnion(shapes, scale, ox, oy, rng) {
  const wob = shapes.map(() => [rng() * 6.28, rng() * 6.28]);
  const inside = (x, y) => shapes.some((s, i) => {
    // gentle felt wobble: ellipses get a slightly irregular radius
    if (s.t === "e") {
      const a = Math.atan2((y - s.cy) / s.ry, (x - s.cx) / s.rx);
      const k = 1 + 0.035 * (Math.sin(a * 2 + wob[i][0]) + 0.6 * Math.sin(a * 3 + wob[i][1]));
      return ((x - s.cx) / (s.rx * k)) ** 2 + ((y - s.cy) / (s.ry * k)) ** 2 <= 1;
    }
    return insideShape(s, x, y);
  });
  // bounds in local units
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    const pts = s.t === "e" ? [[s.cx - s.rx * 1.1, s.cy - s.ry * 1.1], [s.cx + s.rx * 1.1, s.cy + s.ry * 1.1]]
      : s.t === "p" ? s.pts : s.pts.flatMap(([x, y]) => [[x - s.w, y - s.w], [x + s.w, y + s.w]]);
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const step = 1 / scale; // one virtual pixel
  const gx0 = x0 - 2 * step, gy0 = y0 - 2 * step;
  const W = Math.ceil((x1 - x0) / step) + 4, H = Math.ceil((y1 - y0) / step) + 4;
  const grid = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) grid[j * W + i] = inside(gx0 + i * step, gy0 + j * step) ? 1 : 0;
  const at = (i, j) => i >= 0 && j >= 0 && i < W && j < H && grid[j * W + i] === 1;
  let si = -1, sj = -1;
  outer: for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (at(i, j)) { si = i; sj = j; break outer; }
  const D = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const dirOf = (dx, dy) => D.findIndex(([a, b]) => a === dx && b === dy);
  const out = [[si, sj]];
  let pi = si, pj = sj, back = 0; // came from the west
  for (let guard = 0; guard < W * H * 4; guard++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const ci = pi + D[d][0], cj = pj + D[d][1];
      if (at(ci, cj)) {
        const prev = (d + 7) % 8;
        const bi = pi + D[prev][0], bj = pj + D[prev][1];
        back = dirOf(bi - ci, bj - cj);
        pi = ci; pj = cj; moved = true;
        break;
      }
    }
    if (!moved || (pi === si && pj === sj)) break;
    out.push([pi, pj]);
  }
  return out.map(([i, j]) => [ox + (gx0 + i * step) * scale, oy + (gy0 + j * step) * scale]);
}

const norm = (pts) => pts.map(([x, y]) => [x / VW, y / VH]);

/** A thing's outline in board coords: traced, simplified, smoothed, rounded. */
function outlineOf(shapes, { x, y, s, seed }) {
  let pts = traceUnion(shapes, s, x, y, mulberry(seed));
  pts = simplify(pts, 1.2);
  pts = smooth(pts, 2, true);
  pts = simplify(pts, 0.7);
  pts = roundPoints(norm(pts));
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}

// ---------- the starter things (local units ≈ the approved felt sketch's species, x right, y down) ----------
const SPECIES = {
  pig: {
    names: { en: "Pig", sv: "Gris", de: "Schwein", fr: "Cochon", es: "Cerdo" }, color: "pink", motion: "walk",
    shapes: [E(0, 0, 34, 21), E(33, -8, 17, 16), P([24, -18], [30, -36], [40, -20]), E(50, -4, 8, 7), C(2.5, [-33, -2], [-40, -8], [-38, -14])],
    eyes: [[29, -12], [40, -13]],
  },
  cow: {
    names: { en: "Cow", sv: "Ko", de: "Kuh", fr: "Vache", es: "Vaca" }, color: "white", motion: "walk",
    shapes: [E(0, 0, 44, 24), E(48, -8, 15, 14), E(58, -2, 9, 7), P([38, -16], [30, -26], [42, -20]), P([56, -18], [66, -26], [60, -14]),
      C(2.5, [42, -18], [40, -30]), C(2.5, [52, -19], [55, -31]), C(2.5, [-43, -4], [-50, 10], [-50, 20])],
    eyes: [[45, -12], [55, -11]],
  },
  chicken: {
    names: { en: "Chicken", sv: "Höna", de: "Huhn", fr: "Poule", es: "Gallina" }, color: "yellow", motion: "walk",
    shapes: [E(0, 0, 21, 17), E(16, -19, 10, 10), P([24, -22], [36, -18], [24, -14]), P([10, -26], [13, -35], [16, -28], [19, -35], [22, -27]),
      P([-16, -6], [-30, -22], [-26, -2])],
    eyes: [[19, -21]],
  },
  fish: {
    names: { en: "Fish", sv: "Fisk", de: "Fisch", fr: "Poisson", es: "Pez" }, color: "orange", motion: "float",
    shapes: [E(0, 0, 30, 18), P([-24, 0], [-46, -16], [-40, 0], [-46, 16]), P([-10, -14], [2, -27], [14, -14]), P([-2, 14], [6, 22], [12, 14])],
    eyes: [[15, -5]],
  },
  octopus: {
    names: { en: "Octopus", sv: "Bläckfisk", de: "Krake", fr: "Pieuvre", es: "Pulpo" }, color: "pink", motion: "float",
    shapes: [E(0, -12, 23, 24), ...[-16, -8, 0, 8, 16].map((x, i) => C(3.6, [x * 0.8, 4], [x * 1.1 + (i % 2 ? 3 : -3), 18], [x * 1.3, 32]))],
    eyes: [[-8, -14], [8, -14]],
  },
  crab: {
    names: { en: "Crab", sv: "Krabba", de: "Krabbe", fr: "Crabe", es: "Cangrejo" }, color: "red", motion: "walk",
    shapes: [E(0, -22, 27, 15), C(2.5, [-18, -28], [-30, -34]), C(2.5, [18, -28], [30, -34]), E(-35, -39, 10, 8), E(35, -39, 10, 8),
      C(2.4, [-7, -34], [-9, -45]), C(2.4, [7, -34], [9, -45]), E(-9, -47, 5, 5), E(9, -47, 5, 5)],
    eyes: [[-9, -47], [9, -47]],
  },
  spoon: {
    names: { en: "Spoon", sv: "Sked", de: "Löffel", fr: "Cuillère", es: "Cuchara" }, color: "silver", motion: "float",
    shapes: [P([-4.5, -40], [4.5, -40], [3.5, 2], [-3.5, 2]), E(0, 3, 6, 4), E(0, -58, 20, 23)],
    eyes: [[-6, -62], [6, -62]],
  },
  teapot: {
    names: { en: "Teapot", sv: "Tekanna", de: "Teekanne", fr: "Théière", es: "Tetera" }, color: "blue", motion: "float",
    shapes: [E(0, -24, 27, 21), P([16, -24], [38, -44], [45, -40], [26, -10]), E(0, -46, 14, 6), E(0, -53, 5, 5), C(4, [-24, -36], [-36, -30], [-36, -18], [-24, -12])],
    eyes: [[-8, -28], [8, -28]],
  },
  cat: {
    names: { en: "Cat", sv: "Katt", de: "Katze", fr: "Chat", es: "Gato" }, color: "grey", motion: "walk",
    shapes: [E(0, 0, 32, 14), E(33, -14, 13, 12), P([23, -20], [25, -36], [33, -24]), P([33, -24], [42, -36], [43, -20]),
      C(3, [-31, -2], [-43, -10], [-45, -26], [-38, -32])],
    eyes: [[30, -17], [39, -17]],
  },
  chair: {
    names: { en: "Chair", sv: "Stol", de: "Stuhl", fr: "Chaise", es: "Silla" }, color: "wood", motion: "walk",
    shapes: [R(-18, -80, 18, -36), R(-24, -40, 24, -28)],
    eyes: [[-6, -64], [6, -64]],
  },
};

/** One starter thing at virtual position (x, y), scale s (virtual px per local unit). */
function makeThing(id, placeId, kind, x, y, s, seed) {
  const sp = SPECIES[kind];
  const outline = outlineOf(sp.shapes, { x, y, s, seed });
  const eyes = sp.eyes.map(([ex, ey]) => {
    const p = [(x + ex * s) / VW, (y + ey * s) / VH];
    const [sx, sy] = roundPoints([snapInside(p, outline, { margin: 0.012 })])[0];
    return { x: sx, y: sy };
  });
  return {
    id, placeId, names: sp.names, outline, color: sp.color, eyes,
    motion: { kind: "preset", preset: sp.motion, params: {} }, cues: {}, createdAt: T0, updatedAt: T0,
  };
}

// ---------- scene pieces ----------
function rough(pts, rng, j = 1.5, step = 14, closed = true) {
  const out = [];
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n + (rng() - 0.5) * j, a[1] + ((b[1] - a[1]) * k) / n + (rng() - 0.5) * j]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}
function blob(cx, cy, rx, ry, rng, n = 26, wob = 0.07) {
  const p1 = rng() * 6.28, p2 = rng() * 6.28;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob * (Math.sin(a * 2 + p1) * 0.5 + Math.sin(a * 3 + p2) * 0.3);
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  });
}
const piece = (id, kind, color, pts) => ({ id, kind, stroke: roundPoints(norm(pts)), color });

function farmPieces(r) {
  const fence = [];
  for (let x = 380, k = 0; x < 700; x += 52, k++) fence.push(piece(`piece-fence-${k}`, "yarn", "wood", rough([[x, 470], [x, 395]], r, 3, 20, false)));
  return [
    piece("piece-sun", "shape", "sun", blob(1040, 120, 58, 58, r)),
    piece("piece-barn", "shape", "red", rough([[70, 445], [250, 445], [250, 320], [160, 235], [70, 320]], r, 3, 18)),
    piece("piece-barn-door", "shape", "white", rough([[132, 445], [190, 445], [190, 365], [132, 365]], r, 2, 14)),
    piece("piece-tree", "shape", "leaf", blob(900, 300, 62, 70, r, 28, 0.12)),
    piece("piece-trunk", "yarn", "wood", rough([[900, 455], [902, 360]], r, 2, 20, false)),
    ...fence,
    piece("piece-fence-rail", "yarn", "wood", rough([[368, 420], [700, 426]], r, 3, 24, false)),
  ];
}

function seaPieces(r) {
  const weeds = [[96, 790], [168, 806], [1080, 800], [500, 780]].map(([x, y], i) => {
    const pts = [];
    for (let k = 0; k <= 8; k++) pts.push([x + Math.sin(k * 0.9 + i) * 14, y - k * 38]);
    return piece(`piece-seaweed-${i}`, "yarn", "leaf", pts);
  });
  const star = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? 14 : 34;
    star.push([720 + Math.cos(a) * rr, 822 + Math.sin(a) * rr]);
  }
  return [
    ...weeds,
    piece("piece-rock-1", "shape", "rock", blob(270, 790, 78, 40, r, 26, 0.15)),
    piece("piece-rock-2", "shape", "rock", blob(940, 806, 64, 32, r, 26, 0.15)),
    piece("piece-starfish", "shape", "orange", star),
  ];
}

function kitchenPieces(r) {
  return [
    piece("piece-window", "shape", "window", rough([[744, 90], [1044, 90], [1044, 342], [744, 342]], r, 2, 18)),
    piece("piece-window-v", "yarn", "white", rough([[894, 92], [894, 340]], r, 1.5, 20, false)),
    piece("piece-window-h", "yarn", "white", rough([[746, 216], [1042, 216]], r, 1.5, 20, false)),
    piece("piece-table", "shape", "wood", rough([[50, 450], [430, 450], [430, 488], [50, 488]], r, 2, 18)),
    piece("piece-table-leg-1", "yarn", "wood", rough([[86, 488], [86, 600]], r, 1.5, 20, false)),
    piece("piece-table-leg-2", "yarn", "wood", rough([[394, 488], [394, 600]], r, 1.5, 20, false)),
    piece("piece-apple", "shape", "red", blob(240, 418, 30, 30, r)),
    piece("piece-cup", "shape", "yellow", rough([[310, 448], [352, 448], [356, 396], [306, 396]], r, 1.5, 12)),
  ];
}

const place = (id, name, backdrop, skyColor, groundColor, pieces, things) => ({
  id, name, backdrop, skyColor, groundColor, pieces, thingOrder: things.map((t) => t.id), createdAt: T0, updatedAt: T0,
});

/** The whole starter snapshot with readable placeholder ids (io/starter.js gives them fresh ids). */
export function buildStarter() {
  const r = mulberry(42);
  const S = 2.5; // virtual px per local unit
  const farmThings = [
    makeThing("thing-pig", "place-farm", "pig", 330, 640, S, 1),
    makeThing("thing-cow", "place-farm", "cow", 760, 600, S, 2),
    makeThing("thing-chicken", "place-farm", "chicken", 560, 780, S, 3),
  ];
  const seaThings = [
    makeThing("thing-fish", "place-sea", "fish", 380, 360, S, 4),
    makeThing("thing-octopus", "place-sea", "octopus", 820, 330, S, 5),
    makeThing("thing-crab", "place-sea", "crab", 600, 840, S, 6),
  ];
  const kitchenThings = [
    makeThing("thing-spoon", "place-kitchen", "spoon", 190, 400, 2.8, 7),
    makeThing("thing-teapot", "place-kitchen", "teapot", 600, 430, S, 8),
    makeThing("thing-cat", "place-kitchen", "cat", 420, 760, S, 9),
    makeThing("thing-chair", "place-kitchen", "chair", 900, 800, S, 10),
  ];
  const places = [
    place("place-farm", "Farm", "meadow", "sky", "grass", farmPieces(r), farmThings),
    place("place-sea", "Sea", "sea", "sky", "water", seaPieces(r), seaThings),
    place("place-kitchen", "Kitchen", "room", "wall", "floor", kitchenPieces(r), kitchenThings),
  ];
  return {
    formatVersion: FORMAT_VERSION, minReaderFormat: MIN_READER_FORMAT, appVersion: "starter", exportedAt: T0, deviceId: "starter",
    settings: { languages: ["en"], playLanguage: "en", sleepMinutes: 8, gateKind: "keypad", reduceMotion: false, currentPlaceId: "place-farm", welcomed: false, updatedAt: T0 },
    places,
    things: [...farmThings, ...seaThings, ...kitchenThings],
    clips: [],
  };
}

export function starterJson() {
  return JSON.stringify(buildStarter(), null, 1) + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = starterJson();
  if (process.argv.includes("--check")) {
    const ok = readFileSync(STARTER_PATH, "utf8") === json;
    console.log(ok ? "starter.json is up to date" : "starter.json is out of date: run node tools/make-starter.mjs");
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(STARTER_PATH, json);
  const s = buildStarter();
  console.log(`wrote ${STARTER_PATH}: ${s.places.length} places, ${s.things.length} things, ${json.length} bytes`);
  for (const t of s.things) console.log(`  ${t.id}: ${t.outline.length} points`);
}
