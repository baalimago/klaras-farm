// Multi-shape drawing: several shapes drawn with the real <kf-draw-pad> glue into one outline, in the
// guided add Draw step and in the thing card's Redraw. Real FarmStore over MemoryRepo; recorder stubbed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

async function farmPage({ things = 0 } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.evaluate(async (things) => {
    // A stub recorder (this test is about drawing); the draw pad is the real one.
    class StubRecorder extends HTMLElement {}
    customElements.define("kf-recorder", StubRecorder);
    const { FarmStore } = await import("./js/farm-store.js");
    const { MemoryRepo } = await import("./js/io/memory-repo.js");
    let n = 0;
    let t = Date.UTC(2026, 10, 3, 12);
    const env = { now: () => new Date((t += 1000)).toISOString(), rng: () => 0.5, newId: () => `id-${String(++n).padStart(4, "0")}`, deviceId: "test" };
    const repo = new MemoryRepo();
    const store = new FarmStore(repo, env, "test");
    await store.hydrate();
    await store.createPlace({ name: "Farm" });
    const placeId = store.currentPlace.id;
    for (let i = 0; i < things; i++) {
      await store.addThing({ placeId, names: { en: "Box" }, outline: [[0.4, 0.5], [0.56, 0.5], [0.56, 0.7], [0.4, 0.7]], color: "red", eyes: [{ x: 0.48, y: 0.6 }], clips: [] });
    }
    const audio = new EventTarget();
    audio.chime = () => {};
    const session = new EventTarget();
    session.state = { mode: "edit", panel: null };
    session.activity = () => {};
    const services = {
      store, audio, session, scripts: {}, recorder: {}, flags: {},
      engine: { dropIn: () => {} },
      shell: { confirm: () => Promise.resolve(true), toast: () => Promise.resolve() },
    };
    window.__t = { store, repo, env, placeId, services };
  }, things);
  return page;
}

async function mount(page, tag, params = {}) {
  await page.evaluate(async ({ tag, params }) => {
    await import(`./js/components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.services = window.__t.services;
    el.params = params;
    el.addEventListener("kf-close", () => el.remove());
    document.getElementById("parent-layer").append(el);
    await el.ready;
    window.__el = el;
  }, { tag, params });
}

/** Drags a finger along board points through the visible pad's own client coords. */
async function drag(page, points) {
  const client = await page.evaluate((pts) => {
    const pads = [...document.querySelectorAll("kf-draw-pad")];
    const r = pads.at(-1).boardRect();
    return pts.map(([x, y]) => [r.left + x * r.width, r.top + y * r.height]);
  }, points);
  await page.mouse.move(...client[0]);
  await page.mouse.down();
  for (const p of client.slice(1)) await page.mouse.move(p[0], p[1], { steps: 2 });
  await page.mouse.up();
}

// A closed loop in board coords (y squashed by 3/4 so it is round on the 4:3 board), overshooting its start.
const loop = (cx, cy, r, n = 36) => Array.from({ length: n + 3 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * (4 / 3) * Math.sin((i / n) * 2 * Math.PI)]);

const shapesStatus = (page) => page.locator(".kf-ga-shapes").textContent();

test("guided add: two overlapping shapes drawn with the pad become one outline that saves and reloads", async () => {
  const page = await farmPage();
  await mount(page, "kf-guided-add", { holdMs: 150 });
  const next = page.getByRole("button", { name: "Next" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  assert.equal(await next.isDisabled(), true);
  assert.equal(await undo.isDisabled(), true);

  // body, then a head that overlaps it
  const body = { cx: 0.42, cy: 0.55, r: 0.14 };
  const head = { cx: 0.6, cy: 0.36, r: 0.08 };
  await drag(page, loop(body.cx, body.cy, body.r));
  assert.equal(await shapesStatus(page), "1 shape");
  assert.equal(await next.isDisabled(), false);
  const one = await page.evaluate(() => window.__el.thing.outline);

  // a stray third shape, undone
  await drag(page, loop(0.2, 0.25, 0.05));
  assert.equal(await shapesStatus(page), "2 shapes");
  await undo.click();
  assert.equal(await shapesStatus(page), "1 shape");
  assert.deepEqual(await page.evaluate(() => window.__el.thing.outline), one, "undo restores the outline");

  await drag(page, loop(head.cx, head.cy, head.r));
  assert.equal(await shapesStatus(page), "2 shapes");

  // the preview shows the merged drawing in felt: pixels inside the head are painted
  const painted = await page.evaluate(([x, y]) => {
    const c = document.querySelector(".kf-ga-canvas");
    const px = c.getContext("2d").getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data;
    return px[3] > 0;
  }, [head.cx, head.cy]);
  assert.ok(painted, "merged drawing shown in the preview");

  // the drawing as merged, at drawing size, covers both shapes
  const info = await page.evaluate(async ([body, head]) => {
    const g = await import("./js/geometry/stroke.js");
    const merged = window.__el._drawing.merged;
    const outline = window.__el.thing.outline;
    const D = g.bbox(merged), F = g.bbox(outline);
    const map = ([x, y]) => [F.x + ((x - D.x) / D.w) * F.w, F.y + ((y - D.y) / D.h) * F.h];
    return {
      D, F, n: outline.length,
      bodyIn: g.pointInPolygon(map([body.cx, body.cy]), outline),
      headIn: g.pointInPolygon(map([head.cx, head.cy]), outline),
      headTopIn: g.pointInPolygon(map([head.cx, head.cy - head.r * (4 / 3) * 0.8]), outline),
      gapOut: !g.pointInPolygon(map([head.cx + head.r * 0.9, body.cy + body.r]), outline),
    };
  }, [body, head]);
  assert.ok(info.D.x < body.cx - body.r + 0.02 && info.D.x + info.D.w > head.cx + head.r - 0.02, `x covers both: ${JSON.stringify(info.D)}`);
  assert.ok(info.D.y < head.cy - head.r * (4 / 3) + 0.02 && info.D.y + info.D.h > body.cy + body.r * (4 / 3) - 0.02, `y covers both: ${JSON.stringify(info.D)}`);
  assert.ok(info.bodyIn && info.headIn && info.headTopIn, JSON.stringify(info));
  assert.ok(info.gapOut, "a union, not a hull");
  assert.ok(info.F.w <= 0.2401 && info.F.h <= 0.3201, "fitted to thing size");

  // finish the flow
  await next.click();
  await page.locator('.kf-swatch[data-color="blue"]').click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('[data-testid="eye-stamping"]').waitFor();
  const strip = await page.locator('[data-action="eyes-done"]').boundingBox();
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click(); // legs (tests/browser/legs.test.js places them)
  await page.locator('[data-motion="walk"]').click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('input[name="name"]').fill("Duck");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForFunction(() => window.__t.store.snapshot.things.length === 1);

  const saved = await page.evaluate(async () => {
    const { FarmStore } = await import("./js/farm-store.js");
    const { validateSnapshot } = await import("./js/farm/snapshot.js");
    const thing = window.__t.store.snapshot.things[0];
    const again = new FarmStore(window.__t.repo, window.__t.env, "test");
    await again.hydrate();
    return { thing, reloaded: again.snapshot.things[0], valid: validateSnapshot(again.snapshot) };
  });
  assert.ok(Array.isArray(saved.thing.outline) && saved.thing.outline.every((p) => Array.isArray(p) && p.length === 2), "one outline, a list of points");
  const sb = await page.evaluate(async (o) => (await import("./js/geometry/stroke.js")).bbox(o), saved.thing.outline);
  assert.ok(Math.abs(sb.w - info.F.w) < 0.003 && Math.abs(sb.h - info.F.h) < 0.003, `saved outline is the merged one: ${JSON.stringify([sb, info.F])}`);
  assert.deepEqual(saved.reloaded.outline, saved.thing.outline, "reloads as one object");
  assert.deepEqual(saved.valid, { ok: true });
  assert.deepEqual(page.errors, []);
});

test("thing card redraw: starts from the current outline, a shape glues on, Done saves one outline", async () => {
  const page = await farmPage({ things: 1 });
  const id = await page.evaluate(() => window.__t.store.snapshot.things[0].id);
  await mount(page, "kf-thing-card", { thingId: id });
  await page.locator('[data-action="redraw"]').click();
  await page.locator(".kf-tc-overlay kf-draw-pad").waitFor();
  assert.match(await page.locator(".kf-tc-shapes").textContent(), /^1 shape/);
  // shape 1 is the old box scaled to drawing size around (0.5, 0.48): an ear sticking out on its right
  const before = await page.evaluate(() => window.__t.store.snapshot.things[0].outline);
  await drag(page, loop(0.8, 0.3, 0.07));
  assert.match(await page.locator(".kf-tc-shapes").textContent(), /^2 shapes/);
  await page.locator('[data-action="redraw-done"]').click();
  await page.waitForFunction(() => !document.querySelector(".kf-tc-overlay"));
  const after = await page.evaluate(async () => {
    const g = await import("./js/geometry/stroke.js");
    const t = window.__t.store.snapshot.things[0];
    return { outline: t.outline, b: g.bbox(t.outline), eyesIn: t.eyes.map((e) => g.pointInPolygon([e.x, e.y], t.outline)) };
  });
  assert.notDeepEqual(after.outline, before);
  assert.ok(after.b.w > after.b.h * 0.9, `wider than the old upright box: ${JSON.stringify(after.b)}`);
  assert.deepEqual(after.eyesIn, [true]);
  assert.deepEqual(page.errors, []);
});

// ---------- playtest 2: guidance, editing shapes one by one, open strokes that join the body ----------

/** Board point → client point on the visible pad. */
const client = (page, [x, y]) =>
  page.evaluate(([x, y]) => {
    const r = [...document.querySelectorAll("kf-draw-pad")].at(-1).boardRect();
    return [r.left + x * r.width, r.top + y * r.height];
  }, [x, y]);

async function tap(page, pt) {
  const [x, y] = await client(page, pt);
  await page.mouse.click(x, y);
}

/** A straight drag between two client points (a move or a resize, not a drawn stroke). */
async function pull(page, [ax, ay], [bx, by]) {
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 8 });
  await page.mouse.up();
}

const shapeBox = (page, i) =>
  page.evaluate(async (i) => (await import("./js/geometry/stroke.js")).bbox((window.__el._drawing ?? window.__drawing).shapes[i]), i);

test("draw step: the step bar says Body, and the guidance says to draw the body only", async () => {
  const page = await farmPage();
  await mount(page, "kf-guided-add", { holdMs: 150 });
  assert.equal(await page.locator(".kf-ga-steps [aria-current=step]").textContent(), "Body");
  await page.getByRole("heading", { name: "Draw the body" }).waitFor();
  const guide = page.locator('[data-testid="body-guide"]');
  assert.equal(await guide.locator("figcaption").textContent(), "Draw the body only. Eyes and legs come next.");
  assert.equal(await guide.locator("svg").count(), 1, "with a small picture of a body without legs");
  assert.deepEqual(page.errors, []);
});

test("draw step: tap a shape to select it, then move, resize, delete and draw it again; undo takes back any change", async () => {
  const page = await farmPage();
  await mount(page, "kf-guided-add", { holdMs: 150 });
  const status = () => shapesStatus(page);
  const row = page.locator(".kf-se-selection");
  const handle = page.locator('[data-action="resize-shape"]');
  const undo = page.getByRole("button", { name: "Undo", exact: true });

  await drag(page, loop(0.4, 0.55, 0.12));
  assert.equal(await status(), "1 shape");
  assert.equal(await row.isHidden(), true);
  // each shape is shown as its own stitched outline over the felt
  assert.equal(await page.locator("kf-draw-pad .kf-se-outlines").count(), 1);

  // tap inside: selected, with a big handle
  await tap(page, [0.4, 0.55]);
  await row.waitFor();
  assert.equal(await handle.isVisible(), true);
  const hb = await handle.boundingBox();
  assert.ok(hb.width >= 44 && hb.height >= 44, `handle is a parent target: ${JSON.stringify(hb)}`);
  await page.getByText("Drag the shape to move it").waitFor();

  // move it right by 0.15 of the board (towards the panel: the handle moves to a free corner)
  const before = await shapeBox(page, 0);
  const outlineBefore = await page.evaluate(() => window.__el.thing.outline);
  await pull(page, await client(page, [0.4, 0.55]), await client(page, [0.55, 0.55]));
  const moved = await shapeBox(page, 0);
  assert.ok(Math.abs(moved.x - before.x - 0.15) < 0.01, `moved: ${JSON.stringify([before, moved])}`);
  assert.ok(Math.abs(moved.w - before.w) < 1e-6, "same size");
  assert.equal(await row.isVisible(), true, "still selected after the move");

  // resize with the corner handle: pull it outwards
  const h0 = await handle.boundingBox();
  const c0 = [h0.x + h0.width / 2, h0.y + h0.height / 2];
  await pull(page, c0, [c0[0] + 60, c0[1] + 60]);
  const bigger = await shapeBox(page, 0);
  assert.ok(bigger.w > moved.w * 1.1, `bigger: ${JSON.stringify([moved, bigger])}`);

  // undo takes back the resize, then the move
  await undo.click();
  assert.ok(Math.abs((await shapeBox(page, 0)).w - moved.w) < 1e-6);
  await undo.click();
  assert.ok(Math.abs((await shapeBox(page, 0)).x - before.x) < 1e-6);
  assert.deepEqual(await page.evaluate(() => window.__el.thing.outline), outlineBefore, "the outline follows");

  // a second shape (a head), then select it and delete it
  await drag(page, loop(0.6, 0.35, 0.07));
  assert.equal(await status(), "2 shapes");
  await tap(page, [0.6, 0.35]);
  await row.waitFor();
  assert.equal(await page.evaluate(() => window.__el._editor.selected), 1, "the head, not the body");
  await page.locator('[data-action="delete-shape"]').click();
  assert.equal(await status(), "1 shape");
  assert.equal(await row.isHidden(), true);
  await undo.click();
  assert.equal(await status(), "2 shapes", "undo brings a deleted shape back");

  // tap outside every shape: nothing is selected, and drawing works again
  await tap(page, [0.4, 0.55]);
  await row.waitFor();
  await tap(page, [0.9, 0.15]);
  assert.equal(await row.isHidden(), true);

  // draw it again: the next stroke takes the body's place
  await tap(page, [0.38, 0.6]);
  await row.waitFor();
  await page.locator('[data-action="redraw-shape"]').click();
  assert.equal(await page.locator('[data-action="redraw-shape"]').getAttribute("aria-pressed"), "true");
  await page.getByText("It takes the place of the orange one").waitFor();
  await drag(page, loop(0.3, 0.6, 0.08));
  assert.equal(await status(), "2 shapes", "replaced, not added");
  const redrawn = await shapeBox(page, 0);
  assert.ok(Math.abs(redrawn.x + redrawn.w / 2 - 0.3) < 0.02 && redrawn.w < before.w, `redrawn: ${JSON.stringify(redrawn)}`);

  // start over, then undo it
  await page.locator('[data-action="start-over"]').click();
  assert.equal(await page.getByRole("button", { name: "Next" }).isDisabled(), true);
  await undo.click();
  assert.equal(await status(), "2 shapes");
  assert.deepEqual(page.errors, []);
});

test("draw step: an open stroke that starts and ends inside the body joins it; one that ends outside warns", async () => {
  const page = await farmPage();
  await mount(page, "kf-guided-add", { holdMs: 150 });
  await drag(page, loop(0.45, 0.6, 0.15));
  assert.equal(await shapesStatus(page), "1 shape");
  // an ear: from inside the body, up and out, back down inside (the ends are far apart)
  const ear = Array.from({ length: 24 }, (_, i) => {
    const a = Math.PI * (i / 23);
    return [0.45 - 0.07 * Math.cos(a), 0.5 - 0.3 * Math.sin(a)];
  });
  await drag(page, ear);
  assert.equal(await shapesStatus(page), "2 shapes");
  assert.equal(await page.locator(".kf-ga-panel .kf-warning[role=status]").isHidden(), true);
  const inEar = await page.evaluate(async () => {
    const g = await import("./js/geometry/stroke.js");
    return g.pointInPolygon([0.45, 0.25], window.__el._drawing.merged);
  });
  assert.ok(inEar, "the ear is part of the body");
  // the pad's open-stroke highlight was cleared
  const highlighted = await page.evaluate(() => !![...document.querySelectorAll("kf-draw-pad")].at(-1)._gap);
  assert.equal(highlighted, false);

  // a stroke that leaves the body and stops outside: warn, nothing added
  await drag(page, [[0.45, 0.6], [0.6, 0.4], [0.8, 0.2], [0.9, 0.15]]);
  await page.getByText("Close the outline").waitFor();
  assert.equal(await shapesStatus(page), "2 shapes");
  assert.deepEqual(page.errors, []);
});

test("thing card redraw: the body opens as an editable shape, with the guidance; delete it and draw a new one", async () => {
  const page = await farmPage({ things: 1 });
  const id = await page.evaluate(() => window.__t.store.snapshot.things[0].id);
  await mount(page, "kf-thing-card", { thingId: id });
  await page.locator('[data-action="redraw"]').click();
  await page.locator(".kf-tc-overlay kf-draw-pad").waitFor();
  await page.locator('.kf-tc-overlay [data-testid="body-guide"]').getByText("Draw the body only").waitFor();
  await page.evaluate(() => { window.__drawing = window.__el._overlay.editor.drawing; });
  // the old box is shape 1 at drawing size around (0.5, 0.48): tap it, move it
  await tap(page, [0.5, 0.48]);
  await page.locator(".kf-tc-overlay .kf-se-selection").waitFor();
  const b0 = await shapeBox(page, 0);
  await pull(page, await client(page, [0.5, 0.48]), await client(page, [0.4, 0.48]));
  const b1 = await shapeBox(page, 0);
  assert.ok(Math.abs(b0.x - b1.x - 0.1) < 0.01, `moved: ${JSON.stringify([b0, b1])}`);
  // delete it and draw a wide new body instead
  await page.locator('.kf-tc-overlay [data-action="delete-shape"]').click();
  assert.match(await page.locator(".kf-tc-shapes").textContent(), /^Draw a new shape/);
  await drag(page, Array.from({ length: 40 }, (_, i) => [0.5 + 0.3 * Math.cos((i / 36) * 2 * Math.PI), 0.5 + 0.15 * Math.sin((i / 36) * 2 * Math.PI)]));
  assert.match(await page.locator(".kf-tc-shapes").textContent(), /^1 shape/);
  await page.locator('[data-action="redraw-done"]').click();
  await page.waitForFunction(() => !document.querySelector(".kf-tc-overlay"));
  const t = await page.evaluate(async () => {
    const g = await import("./js/geometry/stroke.js");
    const t = window.__t.store.snapshot.things[0];
    return { b: g.bbox(t.outline), eyesIn: t.eyes.map((e) => g.pointInPolygon([e.x, e.y], t.outline)) };
  });
  assert.ok(t.b.w > t.b.h, `the new wide body: ${JSON.stringify(t.b)}`);
  assert.deepEqual(t.eyesIn, [true]);
  assert.deepEqual(page.errors, []);
});
