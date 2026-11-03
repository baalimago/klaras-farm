import { test } from "node:test";
import assert from "node:assert/strict";
import { newChallenge, press, tick, promptText, IDLE_MS } from "./adult-check.js";

function seeded(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test("keypad: shuffled 1–9 and a 3-digit code of digits 1–9", () => {
  for (let seed = 1; seed < 200; seed++) {
    const c = newChallenge(seeded(seed), "keypad", 0);
    assert.deepEqual([...c.keys].sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(c.code.length, 3);
    for (const d of c.code) assert.ok(Number.isInteger(d) && d >= 1 && d <= 9);
  }
});

test("the same seed gives the same challenge; different seeds differ", () => {
  assert.deepEqual(newChallenge(seeded(7)), newChallenge(seeded(7)));
  const codes = new Set(Array.from({ length: 50 }, (_, i) => newChallenge(seeded(i + 1)).code.join("")));
  assert.ok(codes.size > 40);
  const orders = new Set(Array.from({ length: 50 }, (_, i) => newChallenge(seeded(i + 1)).keys.join("")));
  assert.ok(orders.size > 40);
});

test("survives an rng that returns values at the edges", () => {
  const c = newChallenge(() => 0.9999999999, "keypad");
  assert.deepEqual([...c.keys].sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const z = newChallenge(() => 0, "sum");
  assert.ok(z.a + z.b >= 11);
});

test("the right code passes, one key at a time", () => {
  let s = newChallenge(seeded(3), "keypad", 1000);
  let r;
  for (const [i, d] of s.code.entries()) {
    ({ state: s, result: r } = press(s, d, 2000 + i * 500));
    assert.equal(r, i < 2 ? "continue" : "pass");
  }
  assert.equal(s.done, "pass");
});

test("a wrong key or a tap between keys fails at once", () => {
  const c = newChallenge(seeded(3), "keypad", 0);
  const wrong = c.keys.find((k) => k !== c.code[0]);
  assert.equal(press(c, wrong, 100).result, "fail");
  assert.equal(press(c, null, 100).result, "fail");
  const { state } = press(c, c.code[0], 100);
  assert.equal(press(state, null, 200).result, "fail");
});

test("10 s without a key fails, measured from the last key", () => {
  let s = newChallenge(seeded(3), "keypad", 0);
  assert.equal(tick(s, IDLE_MS - 1).result, "continue");
  assert.equal(tick(s, IDLE_MS).result, "fail");
  s = press(s, s.code[0], 8000).state;
  assert.equal(tick(s, 17999).result, "continue");
  assert.equal(tick(s, 18000).result, "fail");
  // a late key counts as idle too
  assert.equal(press(s, s.code[1], 18500).result, "fail");
  assert.equal(IDLE_MS, 10000);
});

test("a finished challenge stays finished", () => {
  const c = newChallenge(seeded(3), "keypad", 0);
  const failed = press(c, null, 10).state;
  assert.equal(press(failed, c.code[0], 20).result, "fail");
  assert.equal(tick(failed, 30).result, "fail");
});

test("sum: a + b with a two-digit answer typed on a shuffled 0–9 pad", () => {
  for (let seed = 1; seed < 100; seed++) {
    const c = newChallenge(seeded(seed), "sum", 0);
    assert.equal(c.kind, "sum");
    assert.deepEqual([...c.keys].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const answer = c.a + c.b;
    assert.ok(answer >= 11 && answer <= 18, String(answer));
    assert.deepEqual(c.code, String(answer).split("").map(Number));
  }
  let s = newChallenge(seeded(5), "sum", 0);
  let r;
  for (const d of s.code) ({ state: s, result: r } = press(s, d, 10));
  assert.equal(r, "pass");
});

test("prompt text for each kind", () => {
  const k = newChallenge(seeded(2), "keypad");
  assert.equal(promptText(k), `Tap ${k.code.join(" ")}`);
  const s = newChallenge(seeded(2), "sum");
  assert.equal(promptText(s), `What is ${s.a} + ${s.b}?`);
});
