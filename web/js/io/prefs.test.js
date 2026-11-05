import { test } from "node:test";
import assert from "node:assert/strict";
import { Prefs } from "./prefs.js";

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

test("recording tips are on by default and remember being switched off", () => {
  const storage = memory();
  const prefs = new Prefs({ storage });
  assert.equal(prefs.recordingTips, true);
  let changes = 0;
  prefs.addEventListener("change", () => changes++);
  prefs.recordingTips = false;
  assert.equal(prefs.recordingTips, false);
  assert.equal(changes, 1);
  assert.equal(new Prefs({ storage }).recordingTips, false, "kept for the next launch");
  prefs.recordingTips = true;
  assert.equal(new Prefs({ storage }).recordingTips, true);
});

test("blocked or missing storage: on by default, and a change still holds for this page", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const prefs = new Prefs({ storage: throwing });
  assert.equal(prefs.recordingTips, true);
  prefs.recordingTips = false;
  assert.equal(prefs.recordingTips, false);
  assert.equal(new Prefs({ storage: null }).recordingTips, true);
  assert.equal(new Prefs().recordingTips, true, "node has no localStorage: falls back quietly");
});
