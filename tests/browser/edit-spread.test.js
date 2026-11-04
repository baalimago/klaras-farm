// Edit mode spreads things apart (owner request: "avoid collisions of the animals by moving each
// outside their bounding boxes so that they're easy to edit"), in the real app at iPad size
// (1180 × 820, touch). After edit mode settles, no two things overlap and no two pencils or crosses
// overlap, even when every thing was piled on one spot; the farm itself is unchanged until a drag.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

async function ipadPage() {
  const context = await h.browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(h.server.url + "/");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 });
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
  return { page, context };
}

/** Piles every thing of the current place onto one spot, through the store like a drag would. */
async function pileUp(page) {
  await page.evaluate(async () => {
    const { movedThingPatch } = await import(new URL("js/geometry/transform.js", document.baseURI).href);
    const { store } = window.__kf;
    for (const t of store.thingsIn(store.currentPlace.id)) {
      let cx = 0, cy = 0;
      for (const [x, y] of t.outline) { cx += x; cy += y; }
      cx /= t.outline.length; cy /= t.outline.length;
      store.updateThing({ thingId: t.id, patch: movedThingPatch(t, 0.5 - cx, 0.65 - cy) });
    }
  });
}

async function enterEdit(page) {
  await page.evaluate(() => { window.__kf.session.holdArmed(); window.__kf.session.gatePassed(); });
  await page.locator("kf-edit-layer").waitFor();
  await page.waitForTimeout(700); // the glide (0.3 s) and the badges' second placement (0.4 s)
}

/** Things' rectangles and the badge buttons' rectangles, in CSS px. */
function layout(page) {
  return page.evaluate(() => {
    const { store, board } = window.__kf;
    const r = (d) => ({ l: d.left, t: d.top, r: d.right, b: d.bottom });
    return {
      things: store.thingsIn(store.currentPlace.id).map((t) => ({ id: t.id, ...r(board.actorRect(t.id)) })),
      badges: [...document.querySelectorAll("kf-edit-layer .kf-edit-badges button")].map((b) => ({ id: `${b.dataset.thingId}:${b.className}`, ...r(b.getBoundingClientRect()) })),
      outlines: store.thingsIn(store.currentPlace.id).map((t) => JSON.stringify(t.outline)),
    };
  });
}

const hits = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
function overlapping(rects) {
  const out = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (hits(rects[i], rects[j])) out.push(`${rects[i].id} × ${rects[j].id}`);
  return out;
}

test("edit mode: piled-up things glide apart, with every pencil and cross clear of the others", async () => {
  const { page, context } = await ipadPage();
  await pileUp(page);
  const before = await layout(page);
  assert.ok(before.things.length >= 2);
  assert.ok(overlapping(before.things).length > 0, "the things start piled up");
  await enterEdit(page);
  const after = await layout(page);
  assert.deepEqual(overlapping(after.things), [], "no two things overlap");
  assert.deepEqual(overlapping(after.badges), [], "no two badges overlap");
  assert.equal(after.badges.length, 2 * after.things.length);
  for (const t of after.things) assert.ok(t.l >= -0.5 && t.r <= 1180.5 && t.t >= -0.5 && t.b <= 820.5, `${t.id} is on screen`);
  assert.deepEqual(after.outlines, before.outlines, "only the view moved: the farm is unchanged");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/edit-spread.png` });
  // A tap on each spread thing opens its own card: the hit test follows the spread.
  const first = after.things[after.things.length - 1];
  await page.mouse.click((first.l + first.r) / 2, (first.t + first.b) / 2 + 4);
  await page.locator("kf-thing-card").waitFor();
  assert.equal(await page.evaluate(() => window.__kf.session.state.panel?.params?.thingId), first.id);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test("edit mode: a spread thing dragged a little is saved where it is shown", async () => {
  const { page, context } = await ipadPage();
  await pileUp(page);
  await enterEdit(page);
  const { things } = await layout(page);
  const moved = things[things.length - 1];
  const cx = (moved.l + moved.r) / 2, cy = (moved.t + moved.b) / 2 + 4;
  const shown = await page.evaluate((id) => { const a = window.__kf.engine.actorFor(id); return [a.x, a.y]; }, moved.id);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx + 2 * i, cy);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  await page.mouse.up();
  await page.waitForTimeout(100);
  const saved = await page.evaluate((id) => {
    const t = window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).find((x) => x.id === id);
    let a = 0, cx = 0, cy = 0; // area centroid, like play/hit.js
    for (let i = 0, j = t.outline.length - 1; i < t.outline.length; j = i++) {
      const [x0, y0] = t.outline[j], [x1, y1] = t.outline[i], f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    return [cx / (3 * a), cy / (3 * a)];
  }, moved.id);
  const w = await page.evaluate(() => window.__kf.board.boardRect().width);
  assert.ok(Math.abs(saved[0] - (shown[0] + 40 / w)) < 0.002, `saved x ${saved[0]} vs shown ${shown[0]} + drag`);
  assert.ok(Math.abs(saved[1] - shown[1]) < 0.002, `saved y ${saved[1]} vs shown ${shown[1]}`);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test("edit mode: the pencils and crosses wait for the glide, so they never pile up where the things were", async () => {
  const { page, context } = await ipadPage();
  await pileUp(page);
  // Sample every frame from the moment edit mode starts: badges only once nothing is gliding.
  const samples = await page.evaluate(async () => {
    const { session, engine } = window.__kf;
    const out = [];
    session.holdArmed();
    session.gatePassed();
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      out.push({ spreading: engine.spreading, badges: document.querySelectorAll("kf-edit-layer .kf-edit-badges button").length });
    }
    return out;
  });
  assert.ok(samples.some((s) => s.spreading), "the things glided");
  assert.deepEqual(samples.filter((s) => s.spreading && s.badges > 0), [], "no badges while gliding");
  assert.ok(samples.at(-1).badges > 0, "badges once settled");
  assert.deepEqual(page.errors, []);
  await context.close();
});
