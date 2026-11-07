// <kf-guided-add> per step, mounted alone on a modulePage with a real FarmStore over MemoryRepo and
// the F1 stubs (tests/browser/stubs/f1-stubs.js): the Legs step never leaves with fewer legs than
// chosen, many legs get smaller markers, Name picks the article for the iPad voice, there is no Ask
// step (format 5), and Finish closes the sheet right after the tap.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const STUBS = join(ROOT, "tests/browser/stubs/f1-stubs.js");
let h;
// Set KF_SHOTS to a folder to save iPad-sized screenshots of the Legs and Ask steps.
const SHOTS = process.env.KF_SHOTS;
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : null);

before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

/** A modulePage with the stubs, a store with one place, and guided add mounted at `step` with a drawn, felted thing. */
async function atStep(stepIndex, { languages = ["en"] } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.addScriptTag({ path: STUBS, type: "module" });
  await page.waitForFunction(() => window.__f1);
  await page.evaluate(async ({ languages, stepIndex }) => {
    const { FarmStore } = await import("./js/farm-store.js");
    const { MemoryRepo } = await import("./js/io/memory-repo.js");
    let n = 0;
    let t = Date.UTC(2026, 10, 3, 12);
    const env = { now: () => new Date((t += 1000)).toISOString(), rng: () => 0.5, newId: () => `id-${String(++n).padStart(4, "0")}`, deviceId: "test" };
    const repo = new MemoryRepo();
    const store = new FarmStore(repo, env, "test");
    await store.hydrate();
    await store.updateSettings({ patch: { languages, playLanguage: languages[0] } });
    await store.createPlace({ name: "Farm" });
    const load = async (l) => [l, await (await fetch(`data/scripts/${l}.json`)).json()];
    const scripts = Object.fromEntries(await Promise.all(["en", "de", "sv"].map(load)));
    window.__t = { store, repo, placeId: store.currentPlace.id, services: window.__f1.makeServices({ store, scripts }) };
    await import("./js/components/kf-guided-add/define.js");
    const el = document.createElement("kf-guided-add");
    el.services = window.__t.services;
    el.params = {};
    window.__closed = 0;
    el.addEventListener("kf-close", () => { window.__closed++; el.remove(); });
    document.getElementById("parent-layer").append(el);
    await el.ready;
    const th = el.draft.thing;
    th.outline = [[0.38, 0.45], [0.62, 0.45], [0.62, 0.7], [0.38, 0.7]];
    th.color = "red";
    th.motion = { kind: "preset", preset: "walk", params: {} };
    th.names = { [languages[0]]: "Hen" };
    el._go(stepIndex);
    window.__el = el;
  }, { languages, stepIndex });
  return page;
}

const step = (page) => page.evaluate(() => window.__el.dataset.step);
const thing = (page) => page.evaluate(() => structuredClone(window.__el.thing));
const LEGS = 3, NAME = 5, SOUND = 6;

async function tapBoard(page, x, y) {
  const [cx, cy] = await page.evaluate(([x, y]) => window.__el.toClient(x, y), [x, y]);
  await page.mouse.click(cx, cy);
}

test("legs: 1 of 4 placed → 'Spread the rest and continue' keeps leg 1, adds 3 and moves on", async () => {
  const page = await atStep(LEGS);
  await page.getByRole("button", { name: "4 legs" }).click();
  await tapBoard(page, 0.42, 0.68);
  await page.getByRole("heading", { name: "Tap where leg 2 of 4 goes" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Next" }).count(), 0, "no Next while legs are missing");
  const leg1 = (await thing(page)).legs[0];
  await shot(page, "ga-legs-spread-rest.png");
  await page.getByRole("button", { name: "Spread the rest and continue" }).click();
  assert.equal(await step(page), "moves");
  const t = await thing(page);
  assert.equal(t.legs.length, 4, "as many legs as chosen");
  assert.deepEqual(t.legs[0], leg1, "the placed leg stays where it was put");
  assert.equal(t.legTarget, 4);
  await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d[0]?.thing.legs.length === 4));
  // Back on the step: all four are there, and the button is a plain Next.
  await page.getByRole("button", { name: "‹ Back" }).click();
  await page.getByRole("heading", { name: "4 legs" }).waitFor();
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await step(page), "moves");
  assert.deepEqual(page.errors, []);
});

test("legs: Skip before a count leaves no legs; a count of 0 goes on with Next", async () => {
  const page = await atStep(LEGS);
  await page.getByRole("button", { name: "Skip" }).click();
  assert.equal(await step(page), "moves");
  assert.deepEqual((await thing(page)).legs, []);
  await page.getByRole("button", { name: "‹ Back" }).click();
  await page.getByRole("button", { name: "0 legs" }).click();
  await page.getByRole("heading", { name: "No legs" }).waitFor();
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await step(page), "moves");
});

test("legs: with 8 spread legs the markers shrink so they never overlap, and a leg still drags", async () => {
  const page = await atStep(LEGS);
  await page.getByRole("button", { name: "8 legs" }).click();
  await page.getByRole("button", { name: "Spread evenly" }).click();
  await page.getByRole("heading", { name: "8 legs" }).waitFor();
  const m = await page.evaluate(() => {
    const el = window.__el;
    const t = el.thing;
    const xs = t.legs.map((l) => l.x).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
    return { gap, r8: el.preview.legMarkRadius(t, 8), r4: el.preview.legMarkRadius(t, 4), base: el.preview.legRadius(t) * 0.6, hit: el.preview.legRadius(t) };
  });
  assert.ok(2 * m.r8 < m.gap, `markers fit between legs: ${JSON.stringify(m)}`);
  assert.equal(m.r4, m.base, "up to 4 legs keep the big marker");
  assert.ok(m.hit >= m.r8, "the touch target is not smaller than the marker");
  await shot(page, "ga-legs-8.png");
  // Drag leg 5 up; only leg 5 moves.
  const before = (await thing(page)).legs;
  const a = await page.evaluate(([x, y]) => window.__el.toClient(x, y), [before[4].x, before[4].y]);
  const b = await page.evaluate(() => window.__el.toClient(0.53, 0.6));
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 6 });
  await page.mouse.up();
  const after = (await thing(page)).legs;
  assert.equal(after.length, 8);
  assert.ok(after[4].y < before[4].y - 0.03, "leg 5 moved up");
  assert.deepEqual(after.filter((_, i) => i !== 4), before.filter((_, i) => i !== 4), "the others stay");
  assert.deepEqual(page.errors, []);
});

test("sound: one sound whichever language tab is open, and Finish stands the new thing on the ground", async () => {
  const page = await atStep(SOUND, { languages: ["en", "sv"] });
  const take = () => page.locator('kf-recorder[data-kind="sound"] [data-stub="take"]').click();
  const shown = () => page.evaluate(() => document.querySelector('kf-recorder[data-kind="sound"]').existing?.blobSha256 ?? null);
  await take();
  const first = await page.evaluate(() => window.__f1.recorded.at(-1).sha);
  await page.getByRole("button", { name: "‹ Back" }).click();
  await page.getByRole("tab", { name: "Swedish" }).click();
  await page.getByRole("button", { name: "Next" }).click(); // Name → Sound (there is no Ask step since format 5)
  assert.equal(await step(page), "sound");
  assert.equal(await shown(), first, "the sound shows on the Swedish tab too");
  await take();
  const second = await page.evaluate(() => window.__f1.recorded.at(-1).sha);
  assert.deepEqual(await page.evaluate(() => window.__el.draft.clips.filter((c) => c.kind === "sound").map((c) => c.blobSha256)), [second], "the new take replaced it in the draft");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.waitForFunction(() => window.__t.store.snapshot.things.length === 1);
  const sounds = await page.evaluate(() => window.__t.store.snapshot.clips.filter((c) => c.kind === "sound").map((c) => c.blobSha256));
  assert.deepEqual(sounds, [second], "one sound");
  const bottom = await page.evaluate(() => Math.max(...window.__t.store.snapshot.things[0].outline.map((p) => p[1])));
  assert.ok(bottom >= 0.75, `stands low on the ground: ${bottom}`);
  assert.deepEqual(page.errors, []);
});

test("finish closes the sheet and chimes right after the tap, before the store has saved", async () => {
  const page = await atStep(SOUND);
  await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d.length === 1));
  await page.evaluate(() => {
    const repo = window.__t.repo;
    const write = repo.write.bind(repo);
    window.__release = null;
    // The thing's write hangs until the test lets it go (as an iPad promise sometimes does).
    repo.write = (writes) => writes.some((w) => w.store === "things")
      ? new Promise((ok) => { window.__release = () => ok(write(writes)); })
      : write(writes);
  });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__closed), 1, "closed without waiting for the save");
  assert.ok(await page.evaluate(() => window.__f1.chimes.includes("plink")));
  assert.equal(await page.evaluate(() => window.__f1.dropped.length), 1);
  assert.equal(await page.evaluate(async () => (await window.__t.store.listDrafts()).length), 1, "the draft stays until the thing is saved");
  await page.evaluate(() => window.__release());
  await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d.length === 0));
  assert.deepEqual(page.errors, []);
});

test("finish: when the thing cannot be saved, the parent hears so and the draft is kept", async () => {
  const page = await atStep(SOUND);
  await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d.length === 1));
  await page.evaluate(() => { window.__t.repo.failOn = (writes) => (writes.some((w) => w.store === "things") ? new Error("disk") : null); });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__closed), 1);
  await page.waitForFunction(() => window.__f1.toasts.length === 1);
  assert.match(await page.evaluate(() => window.__f1.toasts[0].message), /kept as a draft/);
  assert.equal(await page.evaluate(() => window.__t.store.snapshot.things.length), 0, "the store rolled back");
  assert.equal(await page.evaluate(async () => (await window.__t.store.listDrafts()).length), 1, "the draft is kept");
});

test("finish in a full scene keeps the sheet and says the scene is full", async () => {
  const page = await atStep(SOUND);
  await page.evaluate(async () => {
    const { store, placeId } = window.__t;
    await store.updateSettings({ patch: { maxThings: 1 } });
    await store.addThing({ placeId, names: { en: "Pig" }, outline: [[0.1, 0.5], [0.2, 0.5], [0.2, 0.6]], color: "red" });
  });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByText("This scene is full").waitFor();
  assert.equal(await page.evaluate(() => window.__closed), 0);
  assert.equal(await page.evaluate(() => window.__f1.chimes.includes("plink")), false);
});

test("name: the article for the iPad voice where the language has articles; no Ask step, Next goes to Sound", async () => {
  const page = await atStep(NAME, { languages: ["en", "de"] });
  assert.equal(await page.locator('select[name="article"]').count(), 0, "English has no articles");
  await page.getByRole("tab", { name: "German" }).click();
  await page.locator('input[name="name"]').fill("Huhn");
  await page.locator('select[name="article"]').selectOption("das");
  await page.waitForFunction(() => window.__el.thing.cues?.de?.article === "das");
  assert.equal(await page.locator('select[name="article"]').inputValue(), "das", "the picker shows the choice");
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await step(page), "sound");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.waitForFunction(() => window.__t.store.snapshot.things.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__t.store.snapshot.things[0].cues), { de: { article: "das" } });
  assert.deepEqual(page.errors, []);
});
