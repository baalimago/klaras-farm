import { test } from "node:test";
import assert from "node:assert/strict";
import { WakeLock } from "../../web/js/io/wake.js";

function fakeNav({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    wakeLock: {
      async request(type) {
        calls.push(type);
        if (fail) throw new DOMException("no", "NotAllowedError");
        const s = new EventTarget();
        s.released = false;
        s.release = async () => { s.released = true; s.dispatchEvent(new Event("release")); };
        return s;
      },
    },
  };
}

test("requests a screen lock once and re-requests after the system releases it", async () => {
  const nav = fakeNav();
  const doc = { visibilityState: "visible" };
  const w = new WakeLock({ nav, doc });
  const [a, b] = await Promise.all([w.request(), w.request()]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.deepEqual(nav.calls, ["screen"], "concurrent requests share one");
  assert.equal(await w.request(), true);
  assert.equal(nav.calls.length, 1, "already held");
  w._sentinel.release(); // the page was hidden
  assert.equal(w.active, false);
  assert.equal(await w.request(), true);
  assert.equal(nav.calls.length, 2);
  await w.release();
  assert.equal(w.active, false);
});

test("degrades silently: unsupported, refused, or hidden page", async () => {
  assert.equal(await new WakeLock({ nav: {}, doc: { visibilityState: "visible" } }).request(), false);
  assert.equal(await new WakeLock({ nav: undefined, doc: undefined }).request(), false);
  assert.equal(await new WakeLock({ nav: fakeNav({ fail: true }), doc: { visibilityState: "visible" } }).request(), false);
  const nav = fakeNav();
  assert.equal(await new WakeLock({ nav, doc: { visibilityState: "hidden" } }).request(), false);
  assert.equal(nav.calls.length, 0);
  await new WakeLock({ nav: {} }).release();
});
