// Sunny felt palette. Data stores keys, so the look can change without migrating data. The one
// exception is a place's sky and ground, which may hold a colour the parent picked freely (format 5).
// Keys are a one-way door: never rename or remove one.

export const SUNNY = Object.freeze({
  sky: "#8fd8f5",
  grass: "#7ccc4f",
  sun: "#ffc93c",
  cloud: "#ffffff",
  red: "#ff5a4e",
  white: "#fffaf0",
  wood: "#c98a4b",
  leaf: "#3fb85f",
  water: "#3fb6e8",
  deep: "#2a9fd6",
  sand: "#ffd98a",
  rock: "#a7b4bf",
  orange: "#ff8c2b",
  wall: "#fff1c9",
  floor: "#f0b77a",
  window: "#a8e4ff",
  pink: "#ff8fb8",
  blue: "#3d8bff",
  yellow: "#ffd23c",
  tan: "#f0a868",
  brown: "#8c5a33",
  cream: "#fff6e0",
  lilac: "#b48cff",
  silver: "#d3dde6",
  grey: "#b0aaa6",
  dark: "#3b2a22",
  // Format 5: more skies and grounds.
  mint: "#bdf0d6",
  peach: "#ffd0b0",
  dusk: "#ffa86b",
  storm: "#94a6b8",
  night: "#2e3a6e",
  moss: "#5e9a3c",
  clay: "#d9784f",
  mud: "#7a5133",
  snow: "#f3f7fa",
});

export const INK = "#4a3326";

/** Colours offered for things and pieces, in swatch order. */
export const THING_COLORS = Object.freeze([
  "red", "orange", "yellow", "leaf", "blue", "lilac", "pink", "brown", "tan", "white", "grey", "dark",
]);
/** Preset sky and ground colours, in swatch order. A free colour can be picked as well (sceneColor). */
export const SKY_COLORS = Object.freeze(["sky", "window", "mint", "cream", "wall", "peach", "dusk", "pink", "lilac", "storm", "night"]);
export const GROUND_COLORS = Object.freeze(["grass", "leaf", "moss", "sand", "clay", "mud", "snow", "water", "deep", "floor", "wood", "rock"]);

/**
 * The simple colour words a toddler knows. The colour game asks for these, and play/colors.js folds
 * felt keys into them. A one-way door: colour game clips store these names.
 */
export const SIMPLE_COLORS = Object.freeze(["red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "white", "grey", "black"]);

export function isColorKey(key) {
  return typeof key === "string" && Object.hasOwn(SUNNY, key);
}

export function hex(key) {
  return SUNNY[key] ?? SUNNY.grey;
}

// A place's sky and ground (format 5) take a palette key or a colour the parent picked freely, stored
// as lowercase "#rrggbb". Things and pieces stay palette keys only.
const CUSTOM = /^#[0-9a-f]{6}$/;

/** True for a freely picked colour as stored: "#rrggbb", lowercase. */
export function isCustomColor(v) {
  return typeof v === "string" && CUSTOM.test(v);
}

/** True for a valid place sky or ground colour: a palette key or a custom colour. */
export function isSceneColor(v) {
  return isColorKey(v) || isCustomColor(v);
}

/**
 * The stored form of a sky or ground colour, or null when it is not one. A colour picker value
 * ("#RRGGBB") is lowercased; one that equals a preset in `presets` becomes that key, so picking the
 * same blue as "Sky blue" selects that swatch.
 * @param {unknown} v @param {readonly string[]} [presets]
 */
export function sceneColor(v, presets = []) {
  if (isColorKey(v)) return v;
  if (typeof v !== "string") return null;
  const low = v.toLowerCase();
  if (!CUSTOM.test(low)) return null;
  return presets.find((k) => SUNNY[k] === low) ?? low;
}

/** Hex for a sky or ground colour (a key's hex, or the custom colour itself). */
export function sceneHex(v) {
  return isCustomColor(v) ? v : hex(v);
}
