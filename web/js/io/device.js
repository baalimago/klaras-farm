// io/device.js: which kind of device the app runs on, and the words the parent UI uses for it.
// The iPad is the main target, but the copy must not claim "iPad" on a phone or a laptop:
// every parent-facing sentence that names the device takes its words from here.
// Promise: `deviceFor(nav)` is pure over the navigator fields it reads; `device()` reads the
// real navigator once and caches the answer for the session (a device does not change kind).

/** @typedef {"ipad" | "iphone" | "other"} DeviceKind */
/** @typedef {{ kind: DeviceKind, name: string, voice: string, ios: boolean, safari: boolean }} Device */

const WORDS = {
  ipad: { name: "iPad", voice: "iPad voice" },
  iphone: { name: "iPhone", voice: "iPhone voice" },
  other: { name: "device", voice: "built-in voice" },
};

/** iPadOS 13+ reports itself as a Mac; only the touch points give it away. */
export function detectKind(nav) {
  const ua = String(nav?.userAgent ?? "");
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) return "ipad";
  if (/iPhone|iPod/.test(ua)) return "iphone";
  return "other";
}

/** Safari, or any browser on iOS/iPadOS (they all run WebKit and share its Home Screen rules). */
export function isSafari(nav) {
  const ua = String(nav?.userAgent ?? "");
  if (detectKind(nav) !== "other") return true;
  return /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\/|Android/.test(ua);
}

/** @returns {Device} */
export function deviceFor(nav) {
  const kind = detectKind(nav);
  return { kind, ...WORDS[kind], ios: kind !== "other", safari: isSafari(nav) };
}

/** @type {Device | null} */
let current = null;

/** The device this page runs on. */
export function device() {
  if (!current) current = deviceFor(globalThis.navigator);
  return current;
}

/** "built-in voice" → "Built-in voice", for words that start a sentence. */
export const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
