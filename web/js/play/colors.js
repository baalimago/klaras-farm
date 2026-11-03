// Colour finding: felt palette keys folded into the simple colour words a toddler knows.
// "sky", "water" and "blue" are all just blue, so a colour round accepts any of them.
import { SUNNY } from "../farm/palette.js";

/** Simple colour → the felt key whose hex stands for it (the colour button shows it). */
export const COLOR_GROUPS = Object.freeze({
  red: "red", orange: "orange", yellow: "yellow", green: "leaf", blue: "blue", purple: "lilac",
  pink: "pink", brown: "brown", white: "white", grey: "grey", black: "dark",
});

const GROUP_OF = Object.freeze({
  sky: "blue", grass: "green", sun: "yellow", cloud: "white", red: "red", white: "white", wood: "brown",
  leaf: "green", water: "blue", deep: "blue", sand: "yellow", rock: "grey", orange: "orange", wall: "white",
  floor: "brown", window: "blue", pink: "pink", blue: "blue", yellow: "yellow", tan: "brown", brown: "brown",
  cream: "white", lilac: "purple", silver: "grey", grey: "grey", dark: "black",
});

/** The simple colour of a felt key, or null for an unknown key. */
export function colorGroup(key) {
  return (typeof key === "string" && Object.hasOwn(GROUP_OF, key) && GROUP_OF[key]) || null;
}

/** Hex for a simple colour (for the button's felt dot). */
export function groupHex(group) {
  return SUNNY[COLOR_GROUPS[group]] ?? SUNNY.grey;
}
