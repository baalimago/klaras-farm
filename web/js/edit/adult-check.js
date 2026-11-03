// Adult check (US-11.2), pure. A parental gate Klara can't pass by mashing:
//   keypad: a shuffled 1–9 pad and a random 3-digit code (digits 1–9, about 1 in 729 by chance);
//   sum:    "What is a + b?" with a two-digit answer typed on a shuffled 0–9 pad (1 in 100).
// Any wrong key, a tap between keys (key = null) or 10 s without a key fails.

export const IDLE_MS = 10000;

const int = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

function shuffled(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {() => number} rng
 * @param {'keypad'|'sum'} [kind]
 * @param {number} [nowMs]  start of the idle timer
 */
export function newChallenge(rng, kind = "keypad", nowMs = 0) {
  if (kind === "sum") {
    // a + b between 11 and 18, both 2–9.
    const a = 2 + int(rng, 8);
    const minB = Math.max(2, 11 - a);
    const b = minB + int(rng, 9 - minB + 1);
    return { kind: "sum", a, b, keys: shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng), code: String(a + b).split("").map(Number), entered: 0, lastAt: nowMs, done: null };
  }
  const keys = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  const code = [1 + int(rng, 9), 1 + int(rng, 9), 1 + int(rng, 9)];
  return { kind: "keypad", keys, code, entered: 0, lastAt: nowMs, done: null };
}

const finish = (s, result) => ({ state: { ...s, done: result }, result });

/**
 * @param {object} s  challenge state
 * @param {number|null} key  the key pressed, or null for a tap that missed every key
 * @param {number} tMs
 * @returns {{state:object, result:'continue'|'pass'|'fail'}}
 */
export function press(s, key, tMs) {
  if (s.done) return { state: s, result: s.done };
  if (tMs - s.lastAt >= IDLE_MS) return finish(s, "fail");
  if (key == null || key !== s.code[s.entered]) return finish(s, "fail");
  const next = { ...s, entered: s.entered + 1, lastAt: tMs };
  if (next.entered === s.code.length) return finish(next, "pass");
  return { state: next, result: "continue" };
}

/** Time passing without a key. */
export function tick(s, tMs) {
  if (s.done) return { state: s, result: s.done };
  if (tMs - s.lastAt >= IDLE_MS) return finish(s, "fail");
  return { state: s, result: "continue" };
}

export function promptText(s) {
  return s.kind === "sum" ? `What is ${s.a} + ${s.b}?` : `Tap ${s.code.join(" ")}`;
}
