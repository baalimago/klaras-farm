// Tiny DOM helpers shared by the parent panels of package F2 (scenes, scene tools, settings,
// welcome, dialog). User text only ever goes in through `text`/children (text nodes).
import { hex, isCustomColor, sceneColor, sceneHex } from "../../farm/palette.js";
import { device } from "../../io/device.js";

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
  mint: "Mint green", peach: "Peach", dusk: "Sunset orange", storm: "Storm grey", night: "Night blue",
  moss: "Moss green", clay: "Clay red", mud: "Mud brown", snow: "Snow white",
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

/**
 * A sky or ground colour chooser: the preset swatches, then a native colour picker for any colour.
 * Build it once and call `.update(selected)` after every change: it updates in place, because
 * rebuilding would tear an open picker out of the page under the parent's finger.
 * onPick(value, {live}) gets a palette key or "#rrggbb" (a picked colour equal to a preset becomes
 * that key). The picker reports while it moves (live: true, at most every LIVE_PICK_MS, the latest
 * value) and when it commits its value (live: false); a swatch tap is live: false. Live picks are
 * spaced because each one repaints the whole felt board and writes the place: a few a second keep
 * the preview following the finger without a repaint or a write every frame. Nothing is delivered
 * once the chooser has left the page (its sheet closed or changed).
 * @param {string} label @param {readonly string[]} keys @param {string} selected
 * @param {(value: string, opts: {live: boolean}) => void} onPick
 */
export const LIVE_PICK_MS = 150;

export function sceneColors(label, keys, selected, onPick) {
  const group = swatches(label, keys, selected, (key) => onPick(key, { live: false }));
  group.classList.add("kf-scene-colors");
  const input = h("input", { type: "color", class: "kf-swatch-input" });
  const any = h("label", { class: "kf-swatch kf-swatch-any" }, [input]);
  group.append(any);
  let timer = 0;
  let lastLive = -Infinity;
  const deliver = (live) => {
    if (!group.isConnected) return;
    const value = sceneColor(input.value, keys);
    if (value) onPick(value, { live });
  };
  const deliverLive = () => {
    timer = 0;
    lastLive = performance.now();
    deliver(true);
  };
  input.addEventListener("input", () => {
    if (timer) return; // the pending delivery reads the latest value
    const wait = Math.max(0, lastLive + LIVE_PICK_MS - performance.now());
    timer = setTimeout(deliverLive, wait);
  });
  input.addEventListener("change", () => {
    clearTimeout(timer);
    timer = 0;
    deliver(false);
  });
  group.update = (value) => {
    for (const b of group.querySelectorAll("button.kf-swatch")) b.setAttribute("aria-pressed", String(b.dataset.color === value));
    const picked = isCustomColor(value);
    any.dataset.picked = String(picked);
    if (picked) any.style.setProperty("--picked", value);
    else any.style.removeProperty("--picked");
    input.setAttribute("aria-label", picked ? "Your own colour" : "Any colour");
    const shown = sceneHex(value);
    if (input.value !== shown) input.value = shown; // never reset a picker that already shows it
  };
  group.update(selected);
  return group;
}

/** Parent-facing message for a failed store intent (FarmError codes from farm/intents.js). */
export function failMessage(e) {
  if (e?.code === "quota") return `This ${device().name} is out of space. Nothing was changed.`;
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
