import { test } from "node:test";
import assert from "node:assert/strict";
import { pressGuard, RELEASE_MS } from "./press-guard.js";

/** A host that delivers pointer events with a chosen target, and timers we run by hand. */
function setup() {
  const el = new EventTarget();
  let renders = 0;
  const timers = { fns: [], setTimeout(fn, ms) { this.fns.push({ fn, ms }); return this.fns.length; }, clearTimeout(id) { if (this.fns[id - 1]) this.fns[id - 1].fn = null; } };
  const g = pressGuard(el, () => renders++, timers);
  const fire = (type, target = { isConnected: true }) => {
    const e = new Event(type);
    Object.defineProperty(e, "target", { value: target });
    el.dispatchEvent(e);
  };
  return { g, fire, timers, renders: () => renders };
}
const tick = () => new Promise((r) => queueMicrotask(r));

test("no press: a request renders at once", () => {
  const { g, renders } = setup();
  g.request();
  assert.equal(renders(), 1);
});

test("mid-tap: the render waits for the click, then happens once", async () => {
  const { g, fire, renders } = setup();
  fire("pointerdown");
  g.request();
  g.request();
  assert.equal(renders(), 0, "the button under the finger is not replaced");
  fire("pointerup");
  fire("click");
  await tick();
  assert.equal(renders(), 1);
});

test("a press with no click (a drag away) renders RELEASE_MS after the lift; cancel renders at once", () => {
  const { g, fire, timers, renders } = setup();
  fire("pointerdown");
  g.request();
  fire("pointerup");
  assert.equal(timers.fns.at(-1).ms, RELEASE_MS);
  timers.fns.at(-1).fn();
  assert.equal(renders(), 1);
  fire("pointerdown");
  g.request();
  fire("pointercancel");
  assert.equal(renders(), 2);
});

test("a press whose target left the DOM holds nothing", () => {
  const { g, fire, renders } = setup();
  const target = { isConnected: true };
  fire("pointerdown", target);
  target.isConnected = false; // a hold closed the overlay its button was in
  g.request();
  assert.equal(renders(), 1);
});
