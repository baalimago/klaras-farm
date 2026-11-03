import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTap, idleMash, startPlaying, stopPlaying, RESTART_MS } from "./mash.js";

test("nothing playing: play, nothing to stop", () => {
  assert.deepEqual(decideTap(idleMash(), "pig", 1000), { action: "play", stopCurrent: false });
});

test("the playing thing restarts only after 300 ms", () => {
  assert.equal(RESTART_MS, 300);
  const s = startPlaying(idleMash(), "pig", 1000);
  assert.deepEqual(decideTap(s, "pig", 1000), { action: "ignore", stopCurrent: false });
  assert.deepEqual(decideTap(s, "pig", 1299), { action: "ignore", stopCurrent: false });
  assert.deepEqual(decideTap(s, "pig", 1300), { action: "restart", stopCurrent: true });
});

test("a different thing stops the current clip and plays at once; nothing queues", () => {
  const s = startPlaying(idleMash(), "pig", 1000);
  assert.deepEqual(decideTap(s, "cow", 1001), { action: "play", stopCurrent: true });
  const s2 = startPlaying(s, "cow", 1001);
  assert.equal(s2.playingId, "cow");
  assert.equal(s2.startedAt, 1001);
});

test("stopPlaying clears only the matching play", () => {
  const s = startPlaying(idleMash(), "pig", 1000);
  assert.equal(stopPlaying(s, s.token + 1), s, "a stale end leaves the newer play alone");
  assert.deepEqual(decideTap(stopPlaying(s, s.token), "pig", 1001), { action: "play", stopCurrent: false });
});

test("the state is never mutated", () => {
  const s = Object.freeze(idleMash());
  const s2 = Object.freeze(startPlaying(s, "pig", 5));
  stopPlaying(s2, s2.token);
  decideTap(s2, "pig", 9999);
});
