// Legs placed by the parent (format 3), in the whole app booted from the real Python server:
// guided add with 4 legs survives a reload and is drawn with 4 legs; records stored by a format 2
// build (things without legs) come back with the legs their preset used to draw.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(() => h.teardown());

const kf = (page, fn, arg) => page.evaluate(fn, arg);

async function dismissWelcome(page) {
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
  // The onboarding tour follows the welcome card; these tests are about other things.
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page.locator("kf-tour").waitFor({ state: "detached" });
}

async function boardPoint(page, x, y) {
  return kf(page, ([x, y]) => window.__kf.board.toClient(x, y), [x, y]).then((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
}

async function enterEdit(page) {
  const p = await boardPoint(page, 0.5, 0.2);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(1700);
  await page.mouse.up();
  await page.locator("kf-adult-check").waitFor();
  const text = await page.locator("kf-adult-check").textContent();
  const digits = text.match(/Tap\s+(\d)\s+(\d)\s+(\d)/).slice(1);
  for (const d of digits) await page.locator("kf-adult-check").getByRole("button", { name: d, exact: true }).click();
  await page.locator("kf-edit-layer").waitFor();
}

async function drag(page, points) {
  const first = await boardPoint(page, ...points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const pt of points.slice(1)) {
    const p = await boardPoint(page, ...pt);
    await page.mouse.move(p.x, p.y, { steps: 2 });
  }
  await page.mouse.up();
}

const circle = (cx, cy, r, n = 40) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * 0.75 * Math.sin((i / n) * 2 * Math.PI)]);

/** Taps board point (x, y) on the guided add preview. */
async function tapPreview(page, x, y) {
  const [cx, cy] = await kf(page, ([x, y]) => document.querySelector("kf-guided-add").toClient(x, y), [x, y]);
  await page.mouse.click(cx, cy);
}

test("a parent adds a thing with 4 legs through guided add; the legs survive a reload and are drawn", async () => {
  const page = await h.newPage();
  await dismissWelcome(page);
  await enterEdit(page);
  await page.locator('[data-action="add"]').click();
  await page.locator('kf-library [data-action="draw-new"]').click();
  await page.locator("kf-guided-add").waitFor();
  await page.locator("kf-draw-pad").waitFor();
  await drag(page, circle(0.5, 0.55, 0.15));
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('.kf-swatch[data-color="blue"]').click();
  await page.getByRole("button", { name: "Next" }).click();
  // Eyes: hand straight over to the grown-up.
  const strip = await page.locator('[data-action="eyes-done"]').boundingBox();
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await page.getByRole("button", { name: "Next" }).click();

  // Legs: 4, placed one by one along the bottom of the shape.
  await page.getByRole("heading", { name: "How many legs?" }).waitFor();
  await page.getByRole("button", { name: "4 legs" }).click();
  const b = await kf(page, () => {
    const pts = document.querySelector("kf-guided-add").thing.outline;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
  for (let i = 0; i < 4; i++) {
    await page.getByRole("heading", { name: `Tap where leg ${i + 1} of 4 goes` }).waitFor();
    await tapPreview(page, b.x0 + (b.x1 - b.x0) * (0.25 + i * 0.17), b.y1 - 0.01);
  }
  await page.getByRole("heading", { name: "4 legs" }).waitFor();
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('[data-motion="walk"]').click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('input[name="name"]').fill("Dog");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.locator("kf-guided-add").waitFor({ state: "detached" });

  const added = await kf(page, () => {
    const s = window.__kf.store;
    const t = s.thingsIn(s.currentPlace.id).find((x) => x.names.en === "Dog");
    return { id: t.id, legs: t.legs };
  });
  assert.equal(added.legs.length, 4);

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const after = await kf(page, async (id) => {
    const { store, engine, board } = window.__kf;
    const t = store.snapshot.things.find((x) => x.id === id);
    const actor = engine.actors.find((a) => a.thingId === id);
    const r = board.renderer;
    r.wake();
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const en = r.entries.get(id);
    return { legs: t.legs, poseLegs: actor.pose.legs.length, drawnLegs: en?.hipsN };
  }, added.id);
  assert.deepEqual(after.legs, added.legs, "4 legs persisted in IndexedDB");
  assert.equal(after.poseLegs, 4, "the motion swings 4 legs");
  assert.equal(after.drawnLegs, 4, "the renderer draws 4 legs");
  assert.deepEqual(page.errors, []);
});

test("things stored by a format 2 build (no legs) get the legs their preset drew", async () => {
  const page = await h.newPage();
  await dismissWelcome(page);
  // Rewrite the stored things as a format 2 build left them: no legs field.
  await kf(page, () => new Promise((ok, fail) => {
    const req = indexedDB.open("klaras-farm");
    req.onerror = () => fail(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("things", "readwrite");
      const st = tx.objectStore("things");
      st.getAll().onsuccess = (e) => { for (const t of e.target.result) { delete t.legs; st.put(t); } };
      tx.oncomplete = () => { db.close(); ok(); };
      tx.onerror = () => fail(tx.error);
    };
  }));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const legs = await kf(page, () => Object.fromEntries(window.__kf.store.snapshot.things.map((t) => [t.names.en, t.legs.length])));
  assert.equal(legs.Pig, 2, "walkers: the two legs the walk preset drew");
  assert.equal(legs.Fish, 0, "floaters: none");
  assert.deepEqual(page.errors, []);
});
