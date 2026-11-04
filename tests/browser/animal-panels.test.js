// Size and walking style in the parent UI (meeting 2), each element mounted alone with fake services:
// the thing card's Size and Moves rows, and guided add's Size (Felt step) and Moves step.
// Set KF_SHOTS to a folder to save iPad-sized screenshots for a look.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const STUBS = join(ROOT, "tests/browser/stubs/f1-stubs.js");
const SHOTS = process.env.KF_SHOTS;
let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

/** A modulePage with the F1 stubs, a store with one place and one 0.16 × 0.2 thing, and `tag` mounted. */
async function panelPage(tag, withThing) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.addScriptTag({ path: STUBS, type: "module" });
  await page.waitForFunction(() => window.__f1);
  await page.evaluate(async ({ tag, withThing }) => {
    const { FarmStore } = await import("./js/farm-store.js");
    const { MemoryRepo } = await import("./js/io/memory-repo.js");
    let n = 0;
    const env = { now: () => new Date().toISOString(), rng: () => 0.5, newId: () => `id-${++n}`, deviceId: "test" };
    const store = new FarmStore(new MemoryRepo(), env, "test");
    await store.hydrate();
    await store.createPlace({ name: "Farm" });
    const placeId = store.currentPlace.id;
    await store.addThing({
      placeId, names: { en: "Pig" }, outline: [[0.42, 0.5], [0.58, 0.5], [0.58, 0.7], [0.42, 0.7]], color: "pink",
      eyes: [{ x: 0.52, y: 0.56 }], legs: [{ x: 0.45, y: 0.69 }, { x: 0.55, y: 0.69 }],
    });
    const thingId = store.thingsIn(placeId)[0].id;
    window.__t = { store, placeId, thingId, services: window.__f1.makeServices({ store, scripts: {} }) };
    await import(`./js/components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.services = window.__t.services;
    el.params = withThing ? { thingId } : {};
    document.getElementById("parent-layer").append(el);
    await el.ready;
    window.__el = el;
  }, { tag, withThing });
  return page;
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const box = (o) => {
  const xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), bottom: Math.max(...ys) };
};
const pressed = (page, sel) => page.waitForFunction((s) => window.__el.querySelector(s)?.getAttribute("aria-pressed") === "true", sel);

test("thing card: Size Big and Medium rescale outline, eyes and legs; Hops and Scuttles save", async () => {
  const page = await panelPage("kf-thing-card", true);
  const thing = () => page.evaluate(() => window.__t.store.snapshot.things[0]);
  const before = await thing();
  // a 0.16 × 0.2 thing is about 2/3 of the Medium box (0.24 × 0.32): the nearest size, Small, is pressed
  assert.equal(await page.locator('.kf-tc-size[data-size="small"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('.kf-tc-size[aria-pressed="true"]').count(), 1);
  await shot(page, "card-size-small");

  await page.locator('.kf-tc-size[data-size="big"]').click();
  await pressed(page, '.kf-tc-size[data-size="big"]');
  const big = await thing();
  const b0 = box(before.outline), b1 = box(big.outline);
  assert.ok(Math.abs(b1.w - 0.24 * 1.3) < 0.002, `big width ${b1.w}`); // the width fills the box
  assert.ok(Math.abs(b1.h / b1.w - b0.h / b0.w) < 0.02, "same shape");
  assert.ok(Math.abs(b1.bottom - b0.bottom) < 0.002, "feet stay where they stand");
  const spread = (t) => t.legs[1].x - t.legs[0].x;
  assert.ok(Math.abs(spread(big) / spread(before) - b1.h / b0.h) < 0.03, "legs scale with the body");
  assert.equal(big.eyes.length, 1);
  await shot(page, "card-size-big");

  await page.locator('.kf-tc-size[data-size="medium"]').click();
  await pressed(page, '.kf-tc-size[data-size="medium"]');
  assert.ok(Math.abs(box((await thing()).outline).w - 0.24) < 0.002);

  assert.deepEqual(await page.locator(".kf-tc-motion").allTextContents(), ["🐾 Walks", "🐇 Hops", "🦀 Scuttles", "〰 Floats"]);
  for (const preset of ["hop", "scuttle"]) {
    await page.locator(`.kf-tc-motion[data-motion="${preset}"]`).click();
    await page.waitForFunction((p) => window.__t.store.snapshot.things[0].motion.preset === p, preset);
    await pressed(page, `.kf-tc-motion[data-motion="${preset}"]`);
  }
  await shot(page, "card-moves");
  assert.deepEqual(page.errors, []);
});

test("guided add: Size on the Felt step rescales at once and survives another shape; Moves offers four styles", async () => {
  const page = await panelPage("kf-guided-add", false);
  await page.evaluate(() => {
    const el = window.__el;
    el.draft.thing.outline = [[0.4, 0.5], [0.64, 0.5], [0.64, 0.66], [0.4, 0.66]]; // Medium: fills the width
    el._go(1);
  });
  await page.getByRole("heading", { name: "Pick its felt" }).waitFor();
  assert.equal(await page.locator('.kf-ga-size[data-size="medium"]').getAttribute("aria-pressed"), "true");
  await page.locator('.kf-swatch[data-color="pink"]').click();
  await page.locator('.kf-ga-size[data-size="small"]').click();
  assert.equal(await page.locator('.kf-ga-size[data-size="small"]').getAttribute("aria-pressed"), "true", "shows at once");
  assert.ok(Math.abs(box(await page.evaluate(() => window.__el.thing.outline)).w - 0.24 * 0.7) < 1e-9);
  await page.waitForFunction(async () => {
    const d = (await window.__t.store.listDrafts())[0];
    const xs = d?.thing.outline.map((p) => p[0]) ?? [];
    return xs.length > 0 && Math.max(...xs) - Math.min(...xs) < 0.2;
  });
  await shot(page, "add-felt-small");
  await page.locator('.kf-ga-size[data-size="big"]').click();
  assert.ok(Math.abs(box(await page.evaluate(() => window.__el.thing.outline)).w - 0.24 * 1.3) < 1e-9);
  await shot(page, "add-felt-big");

  // another shape glued on refits the drawing but keeps the picked size
  await page.evaluate(() => {
    const el = window.__el;
    el._drawing = { merged: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.2], [0.1, 0.2]] };
    el._applyDrawing();
  });
  assert.ok(Math.abs(box(await page.evaluate(() => window.__el.thing.outline)).w - 0.24 * 1.3) < 1e-9);

  await page.evaluate(() => window.__el._go(4));
  await page.getByRole("heading", { name: "How does it move?" }).waitFor();
  assert.deepEqual(await page.locator(".kf-ga-motion").allTextContents(), ["🐾 Walks", "🐇 Hops", "🦀 Scuttles", "〰 Floats"]);
  for (const preset of ["hop", "scuttle"]) {
    await page.locator(`.kf-ga-motion[data-motion="${preset}"]`).click();
    assert.equal(await page.locator(`.kf-ga-canvas.${preset}`).count(), 1, `live preview ${preset}`);
    assert.equal(await page.evaluate(() => window.__el.thing.motion.preset), preset);
  }
  await shot(page, "add-moves");
  assert.deepEqual(page.errors, []);
});
