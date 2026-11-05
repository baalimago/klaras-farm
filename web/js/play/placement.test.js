import { test } from "node:test";
import assert from "node:assert/strict";
import { placeThing, thingBox, thingBoxes, isWalker, GROUND_AT } from "./placement.js";
import { spreadBoxes, crowding, EDIT_SPREAD } from "./spread.js";
import { GROUND_TOP } from "./world.js";
import { LEG_MAX } from "../farm/legs.js";
import { aSnapshot, aPlace, aThing, square } from "../../../tests/builders.js";

const walker = (outline, legs = []) => ({ outline, legs, motion: { kind: "preset", preset: "walk", params: {} } });
const floater = (outline) => ({ outline, legs: [], motion: { kind: "preset", preset: "float", params: {} } });
const moved = (thing, { dx, dy }) => ({ ...thing, outline: thing.outline.map(([x, y]) => [x + dx, y + dy]), legs: thing.legs.map((l) => ({ x: l.x + dx, y: l.y + dy })) });
const bottomOf = (thing) => Math.max(...thing.outline.map((p) => p[1]));
const topOf = (thing) => Math.min(...thing.outline.map((p) => p[1]));
/** The spread leaves the newcomer exactly where it was put. */
function spreadKeeps(occupied, box) {
  const out = spreadBoxes([...occupied, box], EDIT_SPREAD).at(-1);
  return out.x === box.x && out.y === box.y;
}

test("an empty scene: a walker stands in the middle, low on the ground, legs on the board, clear of the edit bar", () => {
  const cow = walker(square(0.2, 0.2, 0.08), [{ x: 0.17, y: 0.27 }]);
  const at = placeThing(cow, [], { backdrop: "meadow" });
  assert.equal(at.dx, Math.round(at.dx * 1000) / 1000, "3 decimals");
  assert.equal(at.dy, Math.round(at.dy * 1000) / 1000);
  const placed = moved(cow, at);
  const b = thingBox(placed);
  assert.ok(Math.abs(b.x - 0.5) < 0.002, `centred: ${b.x}`);
  assert.ok(bottomOf(placed) >= GROUND_AT.meadow + 0.05 - 1e-9, "on the ground");
  assert.ok(bottomOf(placed) + LEG_MAX <= 1 - EDIT_SPREAD.margin + 1e-9, "legs on the board");
  assert.equal(crowding(b, [], EDIT_SPREAD), 0, "clear of the edit bar");
  assert.ok(spreadKeeps([], b));
});

test("beside the things where they stand: the spread never moves the newcomer, and walkers stay on the ground", () => {
  const occupied = [];
  for (let i = 0; i < 7; i++) {
    const t = walker(square(0.5, 0.2, 0.06), [{ x: 0.48, y: 0.25 }]);
    const placed = moved(t, placeThing(t, occupied, { backdrop: "meadow" }));
    const b = thingBox(placed);
    assert.ok(spreadKeeps(occupied, b), `copy ${i} would be moved by the spread`);
    assert.ok(bottomOf(placed) >= GROUND_AT.meadow + 0.05 - 1e-9, `copy ${i} on the ground: ${bottomOf(placed)}`);
    assert.ok(b.x - b.left >= 0 && b.x + b.right <= 1, `copy ${i} on the board`);
    occupied.push(b);
  }
});

test("uses the live boxes it is given, not where the things are saved", () => {
  const t = walker(square(0.5, 0.2, 0.06));
  const empty = moved(t, placeThing(t, [], {}));
  // a thing has wandered onto the spot an empty scene would use
  const wandered = { ...thingBox(empty) };
  const placed = moved(t, placeThing(t, [wandered], {}));
  assert.ok(spreadKeeps([wandered], thingBox(placed)));
  assert.ok(Math.abs(thingBox(placed).x - wandered.x) > 0.1, "elsewhere");
});

test("each backdrop's ground band, and a floater goes up only when the ground is full", () => {
  const t = walker(square(0.5, 0.2, 0.04));
  for (const [backdrop, ground] of Object.entries(GROUND_AT)) {
    const placed = moved(t, placeThing(t, [], { backdrop }));
    assert.ok(bottomOf(placed) >= Math.max(ground, GROUND_TOP) + 0.05 - 1e-9, `${backdrop}: ${bottomOf(placed)}`);
  }
  // a ground band filled edge to edge
  const full = [];
  for (let x = 0.06; x < 1; x += 0.08) for (const y of [0.7, 0.8, 0.9]) full.push({ x, y, left: 0.04, right: 0.04, top: 0.05, bottom: 0.05 });
  const bird = floater(square(0.5, 0.2, 0.04));
  const up = moved(bird, placeThing(bird, full, {}));
  assert.ok(bottomOf(up) < 0.65, `the floater goes up: ${bottomOf(up)}`);
  assert.ok(spreadKeeps(full, thingBox(up)));
  const fox = walker(square(0.5, 0.2, 0.04));
  const down = moved(fox, placeThing(fox, full, {}));
  assert.ok(bottomOf(down) >= GROUND_TOP - 1e-9 && bottomOf(down) < 0.65, `the walker goes to the top of the walking ground: ${bottomOf(down)}`);
  assert.ok(spreadKeeps(full, thingBox(down)));
  // no room anywhere on the walking ground: it lands there anyway, where it overlaps least
  const packed = [...full];
  for (let x = 0.06; x < 1; x += 0.08) packed.push({ x, y: 0.6, left: 0.04, right: 0.04, top: 0.05, bottom: 0.05 });
  const squeezed = moved(fox, placeThing(fox, packed, {}));
  assert.ok(bottomOf(squeezed) >= GROUND_TOP - 1e-9, `still on the ground: ${bottomOf(squeezed)}`);
  assert.ok(topOf(squeezed) >= 0, "on the board");
});

test("a very wide thing goes in the middle; a very tall one keeps its top on the board", () => {
  const wide = walker([[0, 0.4], [0.98, 0.4], [0.98, 0.5], [0, 0.5]]);
  assert.ok(Math.abs(thingBox(moved(wide, placeThing(wide, [], {}))).x - 0.5) < 0.002);
  const tall = walker([[0.4, 0], [0.5, 0], [0.5, 0.9], [0.4, 0.9]]);
  assert.ok(topOf(moved(tall, placeThing(tall, [], {}))) >= 0);
});

test("thingBox: centroid, extents, legs below, a floor for walkers only", () => {
  const b = thingBox(walker(square(0.5, 0.5, 0.1), [{ x: 0.5, y: 0.55 }]));
  assert.ok(Math.abs(b.x - 0.5) < 1e-9 && Math.abs(b.y - 0.5) < 1e-9);
  assert.ok(Math.abs(b.bottom - (0.1 + LEG_MAX)) < 1e-9 && Math.abs(b.top - 0.1) < 1e-9);
  assert.ok(Math.abs(b.floor - (GROUND_TOP - 0.1)) < 1e-9);
  assert.equal(thingBox(floater(square())).floor, undefined);
  assert.equal(isWalker({ motion: { preset: "swim" } }), false);
  assert.equal(isWalker({ motion: { preset: "hop" } }), true);
  assert.equal(isWalker({}), true, "an unknown motion walks");
  const s = aSnapshot().withPlace(aPlace().withThing(aThing({ outline: square(0.3, 0.6, 0.1) }))).withPlace(aPlace().withThing(aThing())).build();
  const boxes = thingBoxes(s, s.places[0].id);
  assert.equal(boxes.length, 1);
  assert.ok(Math.abs(boxes[0].x - 0.3) < 1e-9 && Math.abs(boxes[0].y - 0.6) < 1e-9);
});
