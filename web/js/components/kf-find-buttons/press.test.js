import { test } from "node:test";
import assert from "node:assert/strict";
import { initialPress, nextPress } from "./press.js";

const run = (events) => {
  let s = initialPress();
  const starts = [];
  for (const e of events) {
    const r = nextPress(s, e);
    s = r.state;
    if (r.start) starts.push(r.start);
  }
  return { s, starts };
};

test("a short tap starts its game when the finger lifts, not before", () => {
  const down = nextPress(initialPress(), { type: "down", kind: "animal", pointerId: 1 });
  assert.equal(down.start, null);
  assert.equal(down.state.phase, "down");
  const { s, starts } = run([{ type: "down", kind: "animal", pointerId: 1 }, { type: "up", pointerId: 1 }]);
  assert.deepEqual(starts, ["animal"]);
  assert.equal(s.phase, "idle");
});

test("a completed hold opens the setup instead: the lift starts nothing", () => {
  const { s, starts } = run([{ type: "down", kind: "color", pointerId: 1 }, { type: "armed" }, { type: "up", pointerId: 1 }]);
  assert.deepEqual(starts, []);
  assert.equal(s.phase, "idle");
});

test("cancel, another pointer, stray events and a second press while down change nothing", () => {
  assert.deepEqual(run([{ type: "down", kind: "animal", pointerId: 1 }, { type: "cancel" }, { type: "up", pointerId: 1 }]).starts, []);
  assert.deepEqual(run([{ type: "down", kind: "animal", pointerId: 1 }, { type: "up", pointerId: 2 }]).s.phase, "down");
  assert.deepEqual(run([{ type: "up", pointerId: 1 }, { type: "armed" }]).s, initialPress());
  const twice = run([{ type: "down", kind: "animal", pointerId: 1 }, { type: "down", kind: "color", pointerId: 2 }, { type: "up", pointerId: 1 }]);
  assert.deepEqual(twice.starts, ["animal"]);
  assert.equal(nextPress(initialPress(), { type: "other" }).state.phase, "idle");
});
