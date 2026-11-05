// Size and walking style in the parent UI (meeting 2), each element mounted alone with fake services:
// the thing card's Moves row (its Size row is gone since QA round 3), and guided add's Felt step
// (no size picker since QA round 3) and Moves step.
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

test("thing card: no Size row (animals are resized with the edit-mode scale tool); Hops and Scuttles save", async () => {
  const page = await panelPage("kf-thing-card", true);
  assert.equal(await page.locator(".kf-tc-size").count(), 0, "QA round 3: no Small / Medium / Big on the card");
  assert.equal(await page.getByRole("group", { name: "Size" }).count(), 0);
  assert.deepEqual(await page.locator(".kf-tc-motion").allTextContents(), ["🐾 Walks", "🐇 Hops", "🦀 Scuttles", "〰 Floats"]);
  for (const preset of ["hop", "scuttle"]) {
    await page.locator(`.kf-tc-motion[data-motion="${preset}"]`).click();
    await page.waitForFunction((p) => window.__t.store.snapshot.things[0].motion.preset === p, preset);
    await pressed(page, `.kf-tc-motion[data-motion="${preset}"]`);
  }
  await shot(page, "card-moves");
  assert.deepEqual(page.errors, []);
});

test("guided add: the Felt step has no size picker (playtest 3), a drawing always gets the default size; Moves offers four styles", async () => {
  const page = await panelPage("kf-guided-add", false);
  await page.evaluate(() => {
    const el = window.__el;
    el.draft.thing.outline = [[0.4, 0.5], [0.64, 0.5], [0.64, 0.66], [0.4, 0.66]];
    el._go(1);
  });
  await page.getByRole("heading", { name: "Pick its felt" }).waitFor();
  assert.equal(await page.locator('.kf-ga-size, [aria-label="Size"]').count(), 0, "no Small / Medium / Big");
  await page.getByText("The whole animal is made of this felt.").waitFor();
  await page.locator('.kf-swatch[data-color="pink"]').click();
  assert.equal(await page.locator('.kf-swatch[data-color="pink"]').getAttribute("aria-pressed"), "true", "shows at once");
  assert.equal(await page.evaluate(() => window.__el.thing.color), "pink");
  await page.waitForFunction(async () => (await window.__t.store.listDrafts())[0]?.thing.color === "pink");
  await shot(page, "add-felt");

  // a drawing (even a small or a huge one) is fitted to the default thing size
  for (const merged of [[[0.1, 0.1], [0.12, 0.1], [0.12, 0.11], [0.1, 0.11]], [[0, 0], [1, 0], [1, 0.9], [0, 0.9]]]) {
    await page.evaluate((merged) => {
      const el = window.__el;
      el._drawing = { merged };
      el._applyDrawing();
    }, merged);
    const b = box(await page.evaluate(() => window.__el.thing.outline));
    assert.ok(Math.abs(b.w - 0.24) < 1e-9 || Math.abs(b.h - 0.32) < 1e-9, JSON.stringify(b));
  }

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

test("thing card Redraw draws its pencil line in ink, never in the felt (a white cow's lines must show)", async () => {
  const page = await panelPage("kf-thing-card", true);
  await page.evaluate(() => window.__t.store.updateThing({ thingId: window.__t.thingId, patch: { color: "white" } }));
  await page.locator('[data-action="redraw"]').click();
  assert.equal(await page.evaluate(() => document.querySelector(".kf-tc-overlay kf-draw-pad").color), "dark");
  assert.deepEqual(page.errors, []);
});

test("thing card: Undo changes shows after an edit and puts the thing back as it was when the card opened; recordings stay", async () => {
  const page = await panelPage("kf-thing-card", true);
  const undo = page.locator('[data-action="revert"]');
  assert.equal(await undo.count(), 0, "nothing changed yet");
  await page.evaluate(() => window.__t.store.saveClip({ clip: { thingId: window.__t.thingId, language: "en", kind: "sound", take: 1, blobSha256: "a".repeat(64), mime: "audio/mp4", durationMs: 400, trimStartMs: 0, trimEndMs: 400, gainDb: 0 }, blob: { sha256: "a".repeat(64), mime: "audio/mp4", size: 1, createdAt: "2026-11-05T00:00:00.000Z", bytes: new Uint8Array([1]).buffer } }));
  assert.equal(await undo.count(), 0, "a recording is not a change to put back");
  await page.locator('.kf-swatch[data-color="red"]').click();
  await page.locator('.kf-tc-motion[data-motion="hop"]').click();
  await page.locator('input[name="name"]').fill("Piggy");
  await page.locator('input[name="name"]').press("Enter");
  await undo.waitFor();
  const b = await undo.boundingBox();
  assert.ok(b.height >= 44 && b.y < 150, `in the head beside ✕, seen without scrolling: ${JSON.stringify(b)}`);
  await shot(page, "card-undo-changes");
  await undo.click();
  await page.waitForFunction(() => window.__t.store.snapshot.things[0].color === "pink");
  const t = await page.evaluate(() => window.__t.store.snapshot.things[0]);
  assert.deepEqual([t.color, t.motion.preset, t.names.en], ["pink", "walk", "Pig"]);
  assert.equal(await page.evaluate(() => window.__t.store.clipsFor(window.__t.thingId).length), 1, "the recording stays");
  await undo.waitFor({ state: "detached" });
  assert.equal(await page.locator(".kf-swatch[aria-pressed=true]").getAttribute("data-color"), "pink", "the card shows it at once");
  const toast = await page.evaluate(() => window.__f1.toasts.at(-1));
  assert.match(toast.message, /Pig is back as it was/);
  assert.equal(await page.evaluate(() => typeof window.__f1.toasts.at(-1).undo), "function", "the toast can take it back");
  assert.deepEqual(page.errors, []);
});

test("thing card: an opened recorder scrolls into view", async () => {
  const page = await panelPage("kf-thing-card", true);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await window.__t.store.addQuestion({ thingId: window.__t.thingId, language: "en", text: `Where is the pig ${i}?` });
  });
  await page.locator('.kf-tc-clip[data-kind="sound"]').evaluate((slot) => slot.scrollIntoView({ block: "end" }));
  await page.locator('.kf-tc-clip[data-kind="sound"] [data-action="record"]').click();
  await page.locator(".kf-tc-clip[data-kind=sound] .kf-tc-recorder").waitFor();
  const inView = await page.evaluate(() => {
    const r = document.querySelector(".kf-tc-clip[data-kind=sound] .kf-tc-recorder").getBoundingClientRect();
    const s = document.querySelector(".kf-tc").getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= Math.min(s.bottom, innerHeight) + 1;
  });
  assert.ok(inView, "the whole recorder shows");
  await shot(page, "card-record-sound");
  assert.deepEqual(page.errors, []);
});
