// Tiny DOM builder shared by F1's elements. User text only ever goes in via `text` (textContent).
const PROPS = new Set(["value", "disabled", "checked", "selected", "hidden"]);

/**
 * h('button', {class:'kf-btn', text:'Next', onclick: fn, 'aria-label': 'Next'}, ...children)
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Loads an element module unless the tag is already defined (tests register stubs first). */
export async function ensureElement(tag, load) {
  if (customElements.get(tag)) return true;
  try {
    await load();
  } catch {
    // The package that provides it is missing; the slot stays an unknown element.
  }
  return !!customElements.get(tag);
}

/** Language name for a tag, in English (parent UI). */
export function languageName(lang) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}
