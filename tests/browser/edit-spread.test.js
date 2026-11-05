// Edit mode spreads things apart (owner request: "avoid collisions of the animals by moving each
// outside their bounding boxes so that they're easy to edit"), in the real app at iPad size
// (1180 × 820, touch). After edit mode settles, no two things overlap, no two pencils or crosses
// overlap and nothing sits under the edit bar, even when every thing was piled on one spot. The
// spread is saved, so it survives a scene switch and a reload.
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
    const bar = document.querySelector("kf-edit-layer .kf-edit-bar")?.getBoundingClientRect();
    return {
      bar: bar ? { id: "bar", ...r(bar) } : null,
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
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/edit-spread.png` });
  // A tap on a spread thing selects it, a second tap opens its own card: the hit test follows the spread.
  const first = after.things[after.things.length - 1];
  await page.mouse.click((first.l + first.r) / 2, (first.t + first.b) / 2 + 4);
  await page.locator(`.kf-edit-ring[data-thing-id="${first.id}"]`).waitFor();
  await page.waitForTimeout(600); // not a double tap
  await page.mouse.click((first.l + first.r) / 2, (first.t + first.b) / 2 + 4);
  await page.locator("kf-thing-card").waitFor();
  assert.equal(await page.evaluate(() => window.__kf.session.state.panel?.params?.thingId), first.id);
  assert.ok(after.bar, "the edit bar is there");
  assert.deepEqual(overlapping([after.bar, ...after.badges]).filter((x) => x.startsWith("bar")), [], "no badge under the edit bar");
  assert.notDeepEqual(after.outlines, before.outlines, "the spread is saved to the farm");
  // Saved means it sticks: reload, edit again, and nothing has to move.
  await page.waitForTimeout(300); // IndexedDB writes
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 });
  const reloaded = await layout(page);
  assert.deepEqual(reloaded.outlines, after.outlines, "the saved layout survives a reload");
  assert.deepEqual(overlapping(reloaded.things), [], "still apart after a reload");
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
    const t0 = performance.now();
    session.holdArmed();
    session.gatePassed();
    // right after the mode change, before any frame: the glide has started
    out.push({ t: 0, spreading: engine.settling, badges: document.querySelectorAll("kf-edit-layer .kf-edit-badges button").length });
    while (performance.now() - t0 < 1200) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      out.push({ t: Math.round(performance.now() - t0), spreading: engine.settling, badges: document.querySelectorAll("kf-edit-layer .kf-edit-badges button").length });
    }
    return out;
  });
  assert.ok(samples.some((s) => s.spreading), "the things glided");
  assert.deepEqual(samples.filter((s) => s.spreading && s.badges > 0), [], "no badges while gliding");
  assert.ok(samples.at(-1).badges > 0, "badges once settled");
  assert.deepEqual(page.errors, []);
  await context.close();
});

test("edit mode: after switching scenes and back, each pencil and cross sits over its own thing", async () => {
  const { page, context } = await ipadPage();
  await pileUp(page);
  await enterEdit(page);
  const ids = await page.evaluate(() => window.__kf.store.snapshot.places.map((p) => p.id));
  assert.ok(ids.length >= 2, "the starter has two scenes");
  for (const id of [ids[1], ids[0]]) {
    await page.evaluate((placeId) => window.__kf.store.setCurrentPlace({ placeId }), id);
    await page.waitForFunction(() => !window.__kf.engine.settling, null, { timeout: 5000 });
    await page.waitForTimeout(500); // the badges' next placement
    const { things, badges } = await layout(page);
    assert.deepEqual(overlapping(things), [], `no overlaps in ${id}`);
    for (const t of things) {
      const mine = badges.filter((b) => b.id.startsWith(`${t.id}:`));
      assert.equal(mine.length, 2, `${t.id} has its pencil and cross`);
      for (const b of mine) {
        const cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2;
        assert.ok(Math.abs(cy - Math.max(30, t.t)) < 2, `${b.id} sits on ${t.id}'s top edge`);
        assert.ok(Math.abs(cx - (t.l + t.r) / 2) <= 71, `${b.id} sits near ${t.id}'s top centre`);
      }
    }
  }
  assert.deepEqual(page.errors, []);
  await context.close();
});
