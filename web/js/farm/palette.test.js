import { test } from "node:test";
import assert from "node:assert/strict";
import { SUNNY, SKY_COLORS, GROUND_COLORS, THING_COLORS, isColorKey, isCustomColor, isSceneColor, sceneColor, sceneHex, hex } from "./palette.js";

test("every preset sky, ground and thing colour is a palette key, listed once", () => {
  for (const list of [SKY_COLORS, GROUND_COLORS, THING_COLORS]) {
    assert.equal(new Set(list).size, list.length);
    for (const key of list) assert.ok(isColorKey(key), key);
  }
  assert.ok(SKY_COLORS.length >= 10 && GROUND_COLORS.length >= 10, "plenty of variety");
});

test("palette hexes are lowercase #rrggbb, so a picked colour can match a preset", () => {
  for (const [key, value] of Object.entries(SUNNY)) assert.ok(isCustomColor(value), key);
});

test("isCustomColor and isSceneColor accept only lowercase #rrggbb or a key", () => {
  assert.equal(isCustomColor("#a1b2c3"), true);
  for (const bad of ["#A1B2C3", "#abc", "a1b2c3", "#a1b2c3ff", "sky", null, 3]) assert.equal(isCustomColor(bad), false, String(bad));
  assert.equal(isSceneColor("night"), true);
  assert.equal(isSceneColor("#000000"), true);
  assert.equal(isSceneColor("nope"), false);
  assert.equal(isSceneColor("toString"), false);
});

test("sceneColor stores a picked colour lowercase, and a preset's own hex as its key", () => {
  assert.equal(sceneColor("#ABCDEF"), "#abcdef");
  assert.equal(sceneColor("sky"), "sky");
  assert.equal(sceneColor(SUNNY.sky.toUpperCase(), SKY_COLORS), "sky");
  assert.equal(sceneColor(SUNNY.red, SKY_COLORS), SUNNY.red, "only the given presets map back to keys");
  for (const bad of ["#abc", "blue-ish", "", undefined, {}]) assert.equal(sceneColor(bad), null);
});

test("sceneHex paints a key with its hex and a picked colour as itself", () => {
  assert.equal(sceneHex("night"), SUNNY.night);
  assert.equal(sceneHex("#123456"), "#123456");
  assert.equal(sceneHex("unknown"), hex("grey"));
});
