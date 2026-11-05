// Resizing an animal in edit mode with the selection ring's handle (QA round 3: "resize the animals
// the same way we can resize the objects in the scene"), in the real app at iPad size and pixel
// ratio (1180 × 820, dpr 2, touch). A tap selects (ring and handle); dragging the handle scales the
// thing live about its feet with cheap frames and no store writes, the handle riding the scaled
// corner; the release writes once (outline, eyes and legs), within the size limits, and the badges
// come back around the new size. A thing grown over its neighbour spreads them apart again.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];

async function ipadPage() {
  const context = await h.browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(h.server.url + "/");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 });
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
  await page.evaluate(() => {
    const r = window.__kf.board.renderer;
    const draw = r._draw.bind(r);
    window.__frameMs = [];
    r._draw = (dt) => {
      const t0 = performance.now();
      draw(dt);
      window.__frameMs.push(performance.now() - t0);
    };
  });
  await page.evaluate(() => { window.__kf.session.holdArmed(); window.__kf.session.gatePassed(); });
  await page.locator("kf-edit-layer").waitFor();
  await page.waitForTimeout(800); // the wiggle and any spread settle, the badges are placed
  return { page, context };
}

/** The drawn rect of a thing, its stored size (geometry/transform.js thingSize) and its eyes and legs. */
function thingState(page, id) {
  return page.evaluate(async (id) => {
    const { thingSize } = await import(new URL("js/geometry/transform.js", document.baseURI).href);
    const { store, board, engine } = window.__kf;
    const t = store.snapshot.things.find((x) => x.id === id);
    const r = board.actorRect(id);
    return {
      rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
      size: thingSize(t.outline), outline: t.outline, eyes: t.eyes, legs: t.legs ?? [],
      scale: engine.actorFor(id).scale,
    };
  }, id);
}

/** Taps a thing to select it; returns the handle's centre. */
async function select(page, id) {
  const s = await thingState(page, id);
  await page.mouse.click((s.rect.l + s.rect.r) / 2, (s.rect.t + s.rect.b) / 2 + 4);
  const handle = page.locator(`kf-edit-layer .kf-resize-handle[data-thing-id="${id}"]`);
  await handle.waitFor();
  assert.equal(await page.locator("kf-thing-card").count(), 0, "the first tap selects, it opens no card");
  assert.equal(await page.locator(`.kf-edit-ring[data-thing-id="${id}"]`).count(), 1);
  return centre(await handle.boundingBox());
}

/** Drags from `from` in `n` steps of (sx, sy), one per animation frame, like a finger at 60 Hz. */
async function stepDrag(page, from, n, sx, sy) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(from[0] + i * sx, from[1] + i * sy);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
}

test("edit mode: the ring's handle resizes a thing live about its feet, cheap frames, one write on release", async () => {
  const { page, context } = await ipadPage();
  // A thing with room to grow by a fifth.
  const id = await page.evaluate(async () => {
    const { clampThingScale } = await import(new URL("js/geometry/transform.js", document.baseURI).href);
    const { store } = window.__kf;
    return store.thingsIn(store.currentPlace.id).find((t) => Math.abs(clampThingScale(t, 1.25) - 1.25) < 1e-9)?.id;
  });
  assert.ok(id, "the starter has a thing with room to grow");
  const before = await thingState(page, id);
  const grip = await select(page, id);
  const pivot = [(before.rect.l + before.rect.r) / 2, before.rect.b]; // its feet, on screen
  await page.evaluate((id) => {
    const { store, board, engine } = window.__kf;
    window.__writes = 0;
    window.__changes = [];
    let last = new Map(store.snapshot.things.map((t) => [t.id, t.outline]));
    // Each write: which things, whether each only moved (a spread save), and where the resized
    // thing is drawn the moment the store has it (the engine has already synced: it listens first).
    store.addEventListener("change", (e) => {
      window.__writes++;
      const ids = e.detail?.ids ?? [];
      const moved = ids.map((tid) => {
        const o = store.snapshot.things.find((t) => t.id === tid)?.outline;
        const p = last.get(tid);
        const d = o && p && o.length === p.length ? [o[0][0] - p[0][0], o[0][1] - p[0][1]] : null;
        return !!d && o.every((q, i) => Math.abs(q[0] - p[i][0] - d[0]) < 0.0015 && Math.abs(q[1] - p[i][1] - d[1]) < 0.0015);
      });
      const r = board.actorRect(id);
      window.__changes.push({ ids, moved, rect: { b: r.bottom, w: r.width, cx: r.left + r.width / 2 }, scale: engine.actorFor(id).scale });
      last = new Map(store.snapshot.things.map((t) => [t.id, t.outline]));
    });
    window.__frameMs.length = 0;
  }, id);

  // Away from the feet along the feet → handle line, to 1.2 times the distance.
  const K = 1.2, N = 40;
  const sx = ((grip[0] - pivot[0]) * (K - 1)) / N, sy = ((grip[1] - pivot[1]) * (K - 1)) / N;
  await stepDrag(page, grip, N, sx, sy);
  const live = await thingState(page, id);
  const extra = await page.evaluate(() => ({
    writes: window.__writes, frames: window.__frameMs.slice(),
    resizing: document.querySelector("kf-edit-layer").classList.contains("resizing"),
    ring: getComputedStyle(document.querySelector(".kf-edit-ring")).visibility,
    pencils: [...document.querySelectorAll("kf-edit-layer .kf-badge")].map((b) => getComputedStyle(b).visibility),
  }));
  const handleNow = centre(await page.locator(".kf-resize-handle").boundingBox());
  assert.ok(Math.abs(live.scale - K) < 1e-6, `shown at ${live.scale}`);
  assert.ok(Math.abs(live.rect.b - before.rect.b) < 0.01, `the feet stay put: ${live.rect.b - before.rect.b} px`);
  assert.ok(Math.abs((live.rect.l + live.rect.r) / 2 - pivot[0]) < 0.01, "centred over its feet");
  assert.ok(Math.abs(live.rect.w - before.rect.w * K) < 0.01 && Math.abs(live.rect.h - before.rect.h * K) < 0.01, "scaled under the finger");
  const fingerK = Math.hypot(grip[0] + N * sx - pivot[0], grip[1] + N * sy - pivot[1]) / Math.hypot(grip[0] - pivot[0], grip[1] - pivot[1]);
  assert.ok(Math.abs(fingerK - live.scale) < 1e-6, "the scale is the finger's distance from the feet over the start's");
  assert.ok(Math.hypot(handleNow[0] - (grip[0] + N * sx), handleNow[1] - (grip[1] + N * sy)) < 1.5, "the handle stays under the finger");
  assert.equal(extra.writes, 0, "no store writes while resizing");
  assert.equal(extra.resizing, true);
  assert.equal(extra.ring, "hidden", "the ring at the old size hides");
  assert.ok(extra.pencils.every((v) => v === "hidden"), "so do the pencils and crosses");
  assert.ok(extra.frames.length >= N * 0.8, `a frame per move (${extra.frames.length})`);
  const med = median(extra.frames);
  console.log(`# thing resize: ${extra.frames.length} frames, median ${med.toFixed(3)} ms, max ${Math.max(...extra.frames).toFixed(3)} ms`);
  assert.ok(med < 8, `median frame ${med} ms`);

  await page.mouse.up();
  await page.waitForFunction(() => window.__writes >= 1);
  await page.waitForTimeout(500); // a spread, if any, and the badges' placement
  const after = await thingState(page, id);
  const changes = await page.evaluate(() => window.__changes);
  const [first, ...rest] = changes;
  assert.deepEqual(first.ids, [id], "one write resizes the thing");
  assert.equal(first.moved[0], false, "that write is the resize");
  for (const c of rest) assert.ok(c.moved.every(Boolean), `any later write only moves things (the spread): ${JSON.stringify(c)}`);
  assert.equal(first.scale, 1, "drawn from the new outline as soon as the store has it");
  assert.ok(Math.abs(first.rect.b - before.rect.b) < 1 && Math.abs(first.rect.cx - pivot[0]) < 1, "saved where it was shown: feet put, no jump");
  assert.ok(Math.abs(first.rect.w - before.rect.w * K) < 1.5, "saved at the size shown");
  assert.equal(after.scale, 1);
  assert.ok(Math.abs(after.size / before.size - K) < 0.01, `saved ${after.size / before.size} times as big`);
  // Eyes and legs moved with the body: the same place on it, measured from the feet.
  const foot = (o) => [(Math.min(...o.map((p) => p[0])) + Math.max(...o.map((p) => p[0]))) / 2, Math.max(...o.map((p) => p[1]))];
  const [f0, f1] = [foot(before.outline), foot(after.outline)];
  for (const [list0, list1] of [[before.eyes, after.eyes], [before.legs, after.legs]]) {
    assert.equal(list1.length, list0.length);
    list0.forEach((p, i) => {
      assert.ok(Math.abs(list1[i].x - f1[0] - (p.x - f0[0]) * K) < 0.002 && Math.abs(list1[i].y - f1[1] - (p.y - f0[1]) * K) < 0.002, "eye or leg scaled with the body");
    });
  }
  const ring = await page.locator(`.kf-edit-ring[data-thing-id="${id}"]`).boundingBox();
  assert.ok(Math.abs(ring.width - (after.rect.w + 20)) < 2, "the ring is around the new size");
  assert.equal(await page.evaluate(() => document.querySelector("kf-edit-layer").classList.contains("resizing")), false);
  if (process.env.KF_SHOTS) await page.screenshot({ path: `${process.env.KF_SHOTS}/resize-after.png` });

  // A second tap on the selected thing opens its card.
  await page.waitForTimeout(400);
  await page.mouse.click((after.rect.l + after.rect.r) / 2, (after.rect.t + after.rect.b) / 2 + 4);
  await page.locator("kf-thing-card").waitFor();
  assert.deepEqual(page.errors, []);
  await context.close();
});

test("edit mode: resizing stops at the smallest size, and a thing grown over its neighbour spreads them apart", async () => {
  const { page, context } = await ipadPage();
  const ids = await page.evaluate(() => window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).map((t) => t.id));
  assert.ok(ids.length >= 2);
  const [id] = ids;
  const grip = await select(page, id);
  const before = await thingState(page, id);
  const pivot = [(before.rect.l + before.rect.r) / 2, before.rect.b];
  // Shrink: right onto the feet and past them is the smallest size, never a vanished thing.
  await stepDrag(page, grip, 20, (pivot[0] - grip[0]) / 20, (pivot[1] - 4 - grip[1]) / 20);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const small = await thingState(page, id);
  const { min, max } = await page.evaluate(async () => {
    const m = await import(new URL("js/geometry/transform.js", document.baseURI).href);
    return { min: m.THING_SCALE_MIN, max: m.THING_SCALE_MAX };
  });
  assert.ok(Math.abs(small.size - Math.min(min, before.size)) < 0.01, `smallest size ${small.size}`);
  assert.ok(small.rect.w >= 44, "still a thing a finger can find");

  // Grow it as far as it goes, next to its neighbours: they glide apart and stay apart.
  const grip2 = centre(await page.locator(".kf-resize-handle").boundingBox());
  const p2 = [(small.rect.l + small.rect.r) / 2, small.rect.b];
  await stepDrag(page, grip2, 30, ((grip2[0] - p2[0]) * 8) / 30, ((grip2[1] - p2[1]) * 8) / 30);
  await page.mouse.up();
  await page.waitForFunction(() => !window.__kf.engine.settling, null, { timeout: 5000 });
  await page.waitForTimeout(500);
  const big = await thingState(page, id);
  assert.ok(big.size <= max + 0.01, `never past the largest size (${big.size})`);
  assert.ok(big.size > small.size * 2, "it grew");
  const rects = await page.evaluate(() => {
    const { store, board } = window.__kf;
    return store.thingsIn(store.currentPlace.id).map((t) => { const r = board.actorRect(t.id); return { id: t.id, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  });
  for (const r of rects) assert.ok(r.l >= -0.5 && r.r <= 1180.5 && r.t >= -0.5, `${r.id} on screen`);
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5) overlaps.push(`${a.id} × ${b.id}`);
  }
  assert.deepEqual(overlaps, [], "no two things overlap after the grown one spread them");
  if (process.env.KF_SHOTS) await page.screenshot({ path: `${process.env.KF_SHOTS}/resize-big.png` });
  assert.deepEqual(page.errors, []);
  await context.close();
});
