// Tiny DOM helpers shared by the parent panels of package F2 (scenes, scene tools, settings,
// welcome, dialog). User text only ever goes in through `text`/children (text nodes).
import { hex } from "../../farm/palette.js";

/**
 * h('button', {class: 'kf-btn', text: 'Save', onclick: fn, 'aria-label': 'Save'}, [children])
 * Keys: class, text, on<event>, DOM properties (value, disabled, hidden, type, htmlFor…),
 * anything else becomes an attribute. null/undefined/false values are skipped.
 */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else if (k in el && !k.includes("-")) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) if (c != null && c !== false) el.append(c);
  return el;
}

let uid = 0;
/** A document-unique id for label/aria wiring. */
export const newId = (prefix = "kf") => `${prefix}-${++uid}`;

/** "1 thing", "3 things". */
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "a, b and c". */
export function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Human name for a palette key ("leaf" → "Leaf green"). */
const COLOR_NAMES = {
  sky: "Sky blue", grass: "Grass green", leaf: "Leaf green", water: "Water blue", deep: "Deep blue",
  wall: "Wall cream", floor: "Floor wood", wood: "Wood", window: "Window blue", rock: "Rock grey",
  sand: "Sand", cream: "Cream", lilac: "Lilac", pink: "Pink", red: "Red", orange: "Orange",
  yellow: "Yellow", blue: "Blue", brown: "Brown", tan: "Tan", white: "White", grey: "Grey", dark: "Dark brown",
  sun: "Sun yellow", cloud: "Cloud white", silver: "Silver",
};
export const colorName = (key) => COLOR_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

/** A labelled group of colour swatch buttons (aria-pressed marks the selected one). */
export function swatches(label, keys, selected, onPick) {
  const group = h("div", { class: "kf-swatches", role: "group", "aria-label": label });
  for (const key of keys) {
    const name = colorName(key);
    group.append(
      h("button", {
        type: "button",
        class: "kf-swatch",
        "aria-label": name,
        "aria-pressed": String(key === selected),
        "data-color": key,
        style: `background:${hex(key)}`,
        onclick: () => onPick(key),
      }),
    );
  }
  return group;
}

/** Parent-facing message for a failed store intent (FarmError codes from farm/intents.js). */
export function failMessage(e) {
  if (e?.code === "quota") return "The iPad is out of space. Nothing was changed.";
  if (e?.code === "place-full") return "This scene is full. Delete a thing, or allow more in Settings.";
  return "That didn't save. Nothing was changed.";
}

/** Shows a failure toast through the shell (console only when there is no shell). */
export function reportFailure(services, e) {
  console.warn(e);
  services?.shell?.toast?.(failMessage(e));
}

/** Language display name in English ("sv" → "Swedish"). */
export function languageName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
