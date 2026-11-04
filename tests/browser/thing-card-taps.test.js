// The thing card's questions after the meeting 2 review: typing in a field and then tapping a
// button straight away must keep that tap (the field commits on blur, inside the tap), and an edit
// must not scroll the card back to the top. Real touch input at iPad size.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const F1 = join(ROOT, "tests/browser/stubs/f1-stubs.js");
const F2 = join(ROOT, "tests/browser/stubs/f2-stubs.js");
let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

async function farmPage({ things = 1 } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.addScriptTag({ path: F1, type: "module" });
  await page.waitForFunction(() => window.__f1);
  await page.evaluate(async (things) => {
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
    const sq = (cx) => [[cx - 0.08, 0.5], [cx + 0.08, 0.5], [cx + 0.08, 0.7], [cx - 0.08, 0.7]];
    for (let i = 0; i < things; i++) {
      await store.addThing({ placeId, names: { en: i ? `Thing ${i}` : "Pig" }, outline: sq(0.2 + i * 0.2), color: "red", eyes: [{ x: 0.2 + i * 0.2, y: 0.58 }] });
    }
    const scripts = { en: await (await fetch("data/scripts/en.json")).json() };
    window.__t = { store, repo, placeId, services: window.__f1.makeServices({ store, scripts }) };
  }, things);
  return page;
}

async function mount(page, tag, params = {}) {
  await page.evaluate(async ({ tag, params }) => {
    await import(`./js/components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.services = window.__t.services;
    el.params = params;
    window.__closed = 0;
    el.addEventListener("kf-close", () => { window.__closed++; el.remove(); });
    document.getElementById("parent-layer").append(el);
    await el.ready;
    window.__el = el;
  }, { tag, params });
}




test("thing card: typing a question then tapping Record or + Add a question works on the first tap", async () => {
  const page = await farmPage();
  await page.setViewportSize({ width: 1180, height: 820 });
  await mount(page, "kf-thing-card", { thingId: "id-0002" });
  await page.locator('input[name="cue-2"]').fill("Where is my piggy?");
  await page.locator('.kf-question[data-index="1"] [data-action="record"]').click();
  await page.locator("kf-recorder").waitFor({ timeout: 2000 });
  await page.locator('[data-action="cancel-record"]').click();
  await page.locator("kf-recorder").waitFor({ state: "detached" });
  await page.locator('input[name="cue-3"]').fill("Peekaboo!");
  await page.getByRole("button", { name: "+ Add a question" }).click();
  await page.locator('input[name="cue-4"]').waitFor({ timeout: 2000 });
  const lines = await page.evaluate(() => window.__t.store.snapshot.things[0].cues.en.lines);
  assert.equal(lines[1], "Where is my piggy?");
  assert.equal(lines[2], "Peekaboo!");
  assert.equal(lines.length, 4);
});

test("thing card: an edit far down the card keeps the card where it was", async () => {
  const page = await farmPage();
  await page.setViewportSize({ width: 1180, height: 600 });
  await mount(page, "kf-thing-card", { thingId: "id-0002" });
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "+ Add a question" }).click();
  const field = page.locator('input[name="cue-6"]');
  await field.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => document.querySelector(".kf-tc").scrollTop);
  assert.ok(before > 100, `the card scrolled (${before})`);
  await field.fill("Last one?");
  await page.locator('input[name="name"]').evaluate((el) => el.blur());
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForFunction(() => window.__t.store.snapshot.things[0].cues.en.lines[5] === "Last one?");
  await new Promise((r) => setTimeout(r, 100));
  const after = await page.evaluate(() => document.querySelector(".kf-tc").scrollTop);
  assert.ok(Math.abs(after - before) < 80, `stays put (${before} → ${after})`);
});
