import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, stampEye, upsertClip, stripClip, latestDraft, canAdvance, freeSpot, cleanNames, newDraft, refitEyes } from "./steps.js";

test("seven steps in the approved order", () => {
  assert.deepEqual(STEPS, ["draw", "felt", "eyes", "moves", "name", "ask", "sound"]);
});

test("stampEye: up to two eyes, a third tap moves the oldest", () => {
  let eyes = [];
  eyes = stampEye(eyes, { x: 1, y: 1 });
  eyes = stampEye(eyes, { x: 2, y: 2 });
  assert.deepEqual(eyes, [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  eyes = stampEye(eyes, { x: 3, y: 3 });
  assert.deepEqual(eyes, [{ x: 2, y: 2 }, { x: 3, y: 3 }]);
});

test("upsertClip replaces the clip with the same language, kind and take", () => {
  const a = { language: "en", kind: "name", take: 1, blobSha256: "a" };
  const b = { language: "en", kind: "prompt", take: 1, blobSha256: "b" };
  const out = upsertClip([a, b], { ...a, blobSha256: "a2" });
  assert.equal(out.length, 2);
  assert.equal(out.find((c) => c.kind === "name").blobSha256, "a2");
  assert.equal(upsertClip(out, { ...b, take: 2 }).length, 3);
});

test("stripClip drops identity fields", () => {
  assert.deepEqual(stripClip({ id: "x", thingId: null, createdAt: "t", language: "en", kind: "name", take: 1 }), { language: "en", kind: "name", take: 1 });
});

test("latestDraft picks the newest draft for the place", () => {
  const ds = [
    { id: "1", placeId: "p", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "2", placeId: "p", updatedAt: "2026-01-02T00:00:00Z" },
    { id: "3", placeId: "q", updatedAt: "2026-01-03T00:00:00Z" },
  ];
  assert.equal(latestDraft(ds, "p").id, "2");
  assert.equal(latestDraft(ds, "z"), null);
});

test("canAdvance needs an outline, a colour and a motion", () => {
  assert.equal(canAdvance("draw", {}), false);
  assert.equal(canAdvance("draw", { outline: [[0, 0], [1, 0], [1, 1]] }), true);
  assert.equal(canAdvance("felt", {}), false);
  assert.equal(canAdvance("felt", { color: "red" }), true);
  assert.equal(canAdvance("eyes", {}), true);
  assert.equal(canAdvance("moves", {}), false);
  assert.equal(canAdvance("moves", { motion: { kind: "preset", preset: "float", params: {} } }), true);
  assert.equal(canAdvance("name", {}), true);
});

test("freeSpot avoids existing things", () => {
  const a = freeSpot([]);
  assert.ok(a[0] > 0 && a[0] < 1 && a[1] > 0.4 && a[1] < 0.9);
  const b = freeSpot([[0.5, 0.62], [0.35, 0.62], [0.65, 0.62]]);
  assert.ok(b[0] < 0.3 || b[0] > 0.7);
});

test("cleanNames trims and drops empty names", () => {
  assert.deepEqual(cleanNames({ en: " Pig ", sv: "  " }), { en: "Pig" });
});

test("newDraft starts at the first step with empty fields", () => {
  const d = newDraft("p", [0.5, 0.6]);
  assert.equal(d.step, 0);
  assert.equal(d.placeId, "p");
  assert.deepEqual(d.thing.eyes, []);
  assert.deepEqual(d.clips, []);
});

test("refitEyes keeps eyes at the same relative spot of a redrawn outline", () => {
  const old = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const next = [[2, 2], [4, 2], [4, 4], [2, 4]];
  const snap = (p) => p;
  assert.deepEqual(refitEyes([{ x: 0.25, y: 0.5 }], old, next, snap), [{ x: 2.5, y: 3 }]);
});
