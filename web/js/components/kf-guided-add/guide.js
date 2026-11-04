// "Draw the body only" guidance for the Draw step and the thing card's Redraw (playtest 2: parents drew
// legs with the body; legs and eyes come later). A small inline SVG of a body without legs, the legs
// shown as faint dotted ghosts, and one plain sentence. Built with createElementNS (no innerHTML).
import { h } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";

function svg(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The illustration: a felt body and head, stitched, with ghost legs that come later. */
export function bodyPicture() {
  const pic = svg("svg", { viewBox: "0 0 120 76", width: 96, height: 61, class: "kf-body-guide-pic", "aria-hidden": "true", focusable: "false" });
  const ghost = svg("g", { class: "ghost" });
  for (const x of [34, 48, 70, 84]) ghost.append(svg("path", { d: `M${x} 52 V70 h5` }));
  pic.append(
    ghost,
    svg("path", { class: "felt", d: "M18 34 C18 18 38 12 58 14 C78 12 92 20 92 34 C92 48 76 56 56 55 C36 56 18 50 18 34 Z" }),
    svg("circle", { class: "felt", cx: 96, cy: 22, r: 13 }),
  );
  return pic;
}

/** The guidance block. @param {string} text */
export function bodyGuide(text = "Draw the body only. Eyes and legs come next.") {
  return h("figure", { class: "kf-body-guide", "data-testid": "body-guide" }, bodyPicture(), h("figcaption", { text }));
}
