import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STEPS, stampEye, upsertClip, stripClip, latestDraft, canAdvance, freeSpot, cleanNames, newDraft, refitEyes,
  MOTIONS, THING_SIZE, THING_SIZES, sizeScale, nearestSize, sizeBox, resizeThing, sizedFill,
} from "./steps.js";
import { readdirSync } from "node:fs";

test("eight steps in the approved order: Legs right after Eyes", () => {
  assert.deepEqual(STEPS, ["draw", "felt", "eyes", "legs", "moves", "name", "ask", "sound"]);
});

test("the Legs step: Next waits until every chosen leg is placed", () => {
  assert.equal(canAdvance("legs", { legs: [], legTarget: null }), true, "no count picked: no legs");
  assert.equal(canAdvance("legs", { legs: [], legTarget: 0 }), true);
  assert.equal(canAdvance("legs", { legs: [{ x: 0, y: 0 }], legTarget: 2 }), false);
  assert.equal(canAdvance("legs", { legs: [{ x: 0, y: 0 }, { x: 1, y: 0 }], legTarget: 2 }), true);
  assert.equal(canAdvance("legs", {}), true, "a draft from an older build");
  assert.deepEqual(newDraft("p", [0.5, 0.6]).thing.legs, []);
  assert.equal(newDraft("p", [0.5, 0.6]).thing.legTarget, null);
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

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

test("MOTIONS: Walks, Hops, Scuttles and Floats, each a shipped preset with an icon", () => {
  assert.deepEqual(MOTIONS.map((m) => m.label), ["Walks", "Hops", "Scuttles", "Floats"]);
  const shipped = readdirSync(new URL("../../../data/motions/", import.meta.url)).map((f) => f.replace(/\.json$/, ""));
  for (const m of MOTIONS) {
    assert.ok(shipped.includes(m.preset), m.preset);
    assert.ok(m.icon);
  }
});

test("sizes: Small, Medium, Big; sizeScale and nearestSize read the size back from the outline", () => {
  assert.deepEqual(THING_SIZES.map((s) => s.label), ["Small", "Medium", "Big"]);
  const medium = rect(0.4, 0.4, THING_SIZE.w, THING_SIZE.h / 2); // fills the box one way
  near(sizeScale(medium), 1);
  assert.equal(nearestSize(medium), "medium");
  assert.equal(nearestSize(rect(0.4, 0.4, THING_SIZE.w * 0.72, 0.01)), "small");
  assert.equal(nearestSize(rect(0.1, 0.1, 0.01, THING_SIZE.h * 1.25)), "big");
  assert.equal(sizeScale(null), 1);
  assert.equal(sizeScale([[0, 0], [0, 0], [0, 0]]), 1, "a degenerate outline counts as medium");
  assert.deepEqual(sizeBox(), { w: THING_SIZE.w, h: THING_SIZE.h });
  near(sizeBox(1.3).h, THING_SIZE.h * 1.3);
});

test("resizeThing scales outline, eyes and legs about the feet and keeps the thing on the board", () => {
  const outline = rect(0.4, 0.5, THING_SIZE.w, THING_SIZE.h / 2);
  const thing = { outline, eyes: [{ x: 0.5, y: 0.55 }], legs: [{ x: 0.45, y: 0.65 }, { x: 0.6, y: 0.65 }] };
  const big = resizeThing(thing, 1.3);
  near(sizeScale(big.outline), 1.3);
  assert.equal(nearestSize(big.outline), "big");
  // the bottom centre stays put
  const bottom = (o) => Math.max(...o.map((p) => p[1]));
  const midX = (o) => (Math.min(...o.map((p) => p[0])) + Math.max(...o.map((p) => p[0]))) / 2;
  near(bottom(big.outline), bottom(outline));
  near(midX(big.outline), midX(outline));
  // eyes and legs keep their place relative to the outline
  const rel = (o, p) => [(p.x - o[0][0]) / (o[1][0] - o[0][0]), (p.y - o[0][1]) / (o[2][1] - o[0][1])];
  assert.deepEqual(rel(big.outline, big.eyes[0]).map((v) => +v.toFixed(9)), rel(outline, thing.eyes[0]).map((v) => +v.toFixed(9)));
  assert.equal(big.legs.length, 2);
  near(big.legs[1].x - big.legs[0].x, (0.6 - 0.45) * 1.3);
  const small = resizeThing(big, 0.7);
  near(sizeScale(small.outline), 0.7);
  assert.equal(thing.outline, outline, "pure: the input is not changed");
  // at an edge: grows back onto the board
  const corner = resizeThing({ outline: rect(0.85, 0.02, THING_SIZE.w, THING_SIZE.h / 2) }, 1.3);
  for (const [x, y] of corner.outline) assert.ok(x >= 0 && x <= 1 + 1e-9 && y >= 0 && y <= 1 + 1e-9, `${x},${y}`);
  assert.deepEqual(corner.eyes, []);
  assert.deepEqual(corner.legs, []);
});

test("sizedFill: Big fills the preview, smaller sizes show smaller", () => {
  near(sizedFill(rect(0, 0, THING_SIZE.w * 1.3, 0.01), 0.6), 0.6);
  near(sizedFill(rect(0, 0, THING_SIZE.w, 0.01), 0.6), 0.6 / 1.3);
  near(sizedFill(rect(0, 0, THING_SIZE.w * 3, 0.01), 0.6), 0.6, 1e-9);
  near(sizedFill(rect(0, 0, 0.001, 0.001), 0.6), 0.18);
});
