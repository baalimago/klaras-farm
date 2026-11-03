// Sunny felt palette. Data stores keys only, so the look can change without migrating data.
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
});

export const INK = "#4a3326";

/** Colours offered for things and pieces, in swatch order. */
export const THING_COLORS = Object.freeze([
  "red", "orange", "yellow", "leaf", "blue", "lilac", "pink", "brown", "tan", "white", "grey", "dark",
]);
export const SKY_COLORS = Object.freeze(["sky", "window", "cream", "wall", "lilac", "pink"]);
export const GROUND_COLORS = Object.freeze(["grass", "leaf", "sand", "water", "deep", "floor", "wood", "rock"]);

export function isColorKey(key) {
  return typeof key === "string" && Object.hasOwn(SUNNY, key);
}

export function hex(key) {
  return SUNNY[key] ?? SUNNY.grey;
}
