import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFields, revertPatch, REVERTIBLE } from "./revert.js";

const PIG = {
  id: "pig", names: { en: "Pig" }, outline: [[0, 0], [1, 0], [1, 1]], color: "pink", eyes: [{ x: 0.5, y: 0.5 }], legs: [],
  motion: { kind: "preset", preset: "walk", params: {} }, cues: {}, updatedAt: "a",
};

test("nothing changed: no fields, no patch (updatedAt alone is not a change)", () => {
  assert.deepEqual(changedFields(PIG, { ...PIG, updatedAt: "b" }), []);
  assert.equal(revertPatch(PIG, { ...PIG }), null);
  assert.deepEqual(changedFields(null, PIG), []);
});

test("the patch puts back exactly the changed fields, as copies", () => {
  const now = { ...PIG, color: "red", names: { en: "Piggy" }, motion: { ...PIG.motion, preset: "hop" } };
  assert.deepEqual(changedFields(PIG, now), ["names", "color", "motion"]);
  const patch = revertPatch(PIG, now);
  assert.deepEqual(patch, { names: { en: "Pig" }, color: "pink", motion: PIG.motion });
  assert.notEqual(patch.names, PIG.names, "a copy, never the snapshot's own object");
});

test("a cleared name, a redraw and removed eyes count; missing and empty cues are the same", () => {
  const now = { ...PIG, names: {}, outline: [[0, 0], [2, 0], [2, 2]], eyes: [] };
  assert.deepEqual(changedFields(PIG, now), ["names", "outline", "eyes"]);
  assert.deepEqual(changedFields({ ...PIG, legs: undefined }, { ...PIG, legs: undefined }), []);
  assert.ok(REVERTIBLE.every((k) => k in PIG));
});
