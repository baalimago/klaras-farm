// The animal library (QA round 3): <kf-library> mounted alone with a real FarmStore over MemoryRepo
// and fake session, engine and audio, at iPad size; then one journey through the real app.
// KF_SHOTS=<dir> saves screenshots.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

let h;
before(async () => (h = await setup()));
after(async () => h?.teardown());

const EXAMPLES = JSON.parse(readFileSync(join(ROOT, "web/data/library.json"), "utf8")).examples;
const shot = async (page, name) => process.env.KF_SHOTS && page.screenshot({ path: join(process.env.KF_SHOTS, `library-${name}.png`) });

/** Mounts <kf-library> over a farm with `things` plain things (and one with recordings) in the current scene. */
async function mount({ things = 2, maxThings = 8, examples = EXAMPLES } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.evaluate(
    async ({ things, maxThings, examples }) => {
      const { FarmStore } = await import("./js/farm-store.js");
      const { MemoryRepo } = await import("./js/io/memory-repo.js");
      await import("./js/components/kf-library/define.js");
      let n = 0, t = Date.UTC(2026, 10, 5);
      const env = { now: () => new Date((t += 1000)).toISOString(), rng: () => 0.42, newId: () => `id-${++n}`, deviceId: "test" };
      const store = new FarmStore(new MemoryRepo(), env);
      await store.hydrate();
      await store.updateSettings({ patch: { maxThings } });
      await store.createPlace({ name: "Farm" });
      const farm = store.currentPlace.id;
      const sq = (cx) => [[cx - 0.05, 0.75], [cx + 0.05, 0.75], [cx + 0.05, 0.9], [cx - 0.05, 0.9]];
      for (let i = 0; i < things; i++) await store.addThing({ placeId: farm, names: { en: `Thing ${i}` }, outline: sq(0.15 + i * 0.12), color: "red" });
      // One of ours, with recordings, lives in another scene.
      await store.createPlace({ name: "Sea" });
      const sea = store.currentPlace.id;
      const blob = { sha256: "c".repeat(64), mime: "audio/mp4", size: 1, createdAt: env.now(), bytes: new Uint8Array([1]).buffer };
      await store.addThing({ placeId: sea, names: { en: "Our cow" }, outline: sq(0.5), color: "white", eyes: [{ x: 0.52, y: 0.8 }] });
      const cow = store.thingsIn(sea)[0].id;
      await store.saveClip({ clip: { thingId: cow, language: "en", kind: "name", take: 1, blobSha256: blob.sha256, mime: "audio/mp4", durationMs: 400, trimStartMs: 0, trimEndMs: 400, gainDb: 0 }, blob });
      await store.saveClip({ clip: { thingId: cow, language: "en", kind: "sound", take: 1, blobSha256: blob.sha256, mime: "audio/mp4", durationMs: 400, trimStartMs: 0, trimEndMs: 400, gainDb: 0 } });
      await store.setCurrentPlace({ placeId: farm });
      const log = [];
      const session = Object.assign(new EventTarget(), {
        state: { mode: "edit", panel: { name: "library", params: {} } },
        openPanel: (name, params) => log.push(["openPanel", name, params]),
        activity: () => {},
      });
      const engine = { dropIn: (id) => log.push(["dropIn", id]) };
      const audio = { unlock: () => {}, chime: (k) => log.push(["chime", k]) };
      const toasts = [];
      const shell = { toast: (m) => toasts.push(m) };
      window.t = { store, log, toasts, farm, sea, cow };
      const el = document.createElement("kf-library");
      el.services = { store, session, engine, audio, shell, examples };
      el.addEventListener("kf-close", () => {
        log.push(["kf-close"]);
        el.remove();
      });
      document.getElementById("parent-layer").append(el);
    },
    { things, maxThings, examples },
  );
  await page.locator("kf-library .kf-library-tile").first().waitFor();
  return page;
}

test("library: Draw a new animal first, then ours across scenes, then the examples, each with a felt picture and a name", async () => {
  const page = await mount();
  assert.equal(await page.locator("kf-library [data-testid=library-count]").innerText(), "2 of 8 things in this scene");
  const tiles = page.locator("kf-library .kf-library-tile");
  assert.equal(await tiles.first().getAttribute("data-action"), "draw-new");
  assert.equal(await tiles.first().innerText().then((s) => s.replace(/\s+/g, " ").trim()), "+ Draw a new animal");
  const headings = await page.locator("kf-library h3").allInnerTexts();
  assert.deepEqual(headings, ["Your animals", "Examples"]);
  const own = await page.locator('kf-library [data-source="own"] .kf-library-name').allInnerTexts();
  assert.deepEqual(own, ["Thing 0", "Thing 1", "Our cow"], "every scene's own things");
  assert.equal(await page.locator(`kf-library [data-thing-id="${await page.evaluate(() => window.t.cow)}"]`).getAttribute("aria-label"), "Add Our cow, with 2 recordings");
  const examples = await page.locator('kf-library [data-source="example"] .kf-library-name').allInnerTexts();
  assert.equal(examples.length, EXAMPLES.length);
  for (const name of ["Pig", "Fox", "Frog", "Owl", "Whale"]) assert.ok(examples.includes(name), name);
  // Pictures are painted (felt, not blank cream) in the middle of the tile.
  await page.waitForFunction(() => {
    const c = document.querySelector('kf-library [data-source="example"] canvas');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let coloured = 0;
    for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - 255) + Math.abs(d[i + 1] - 246) + Math.abs(d[i + 2] - 224) > 60) coloured++;
    return coloured > 200;
  });
  // Every target is at least 44 px; the sheet fits the iPad and Close is in view.
  const small = await page.evaluate(() => [...document.querySelectorAll("kf-library button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
  assert.equal(small, 0);
  await page.locator("kf-library .kf-sheet").evaluate((el) => (el.scrollTop = el.scrollHeight));
  assert.ok(await page.getByRole("button", { name: "Close" }).isVisible(), "Close stays in view while scrolled");
  await shot(page, "sheet");
  assert.deepEqual(page.errors, []);
});

test("library: tapping an example adds a copy at once, drops it in with the add sound, and closes", async () => {
  const page = await mount();
  const result = await page.evaluate(() => {
    const { store, log, farm } = window.t;
    const before = store.thingsIn(farm).length;
    document.querySelector('kf-library [aria-label="Add Fox"]').click();
    // Same task as the tap: the store already shows it.
    const things = store.thingsIn(farm);
    return { before, after: things.length, last: things.at(-1), log: log.slice() };
  });
  assert.equal(result.after, result.before + 1);
  assert.equal(result.last.names.en, "Fox");
  assert.equal(result.last.names.fi, "Kettu");
  assert.notEqual(result.last.id, "example-fox");
  assert.deepEqual(result.log, [["chime", "add"], ["dropIn", result.last.id], ["kf-close"]]);
  await page.locator("kf-library").waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.t.toasts), []);
  assert.deepEqual(page.errors, []);
});

test("library: tapping one of ours copies it with its recordings into this scene", async () => {
  const page = await mount();
  await page.locator('kf-library [aria-label="Add Our cow, with 2 recordings"]').click();
  await page.locator("kf-library").waitFor({ state: "detached" });
  const r = await page.evaluate(async () => {
    const { store, farm, sea, cow } = window.t;
    const copy = store.thingsIn(farm).at(-1);
    await store.deleteThing({ thingId: cow }); // the original goes
    return { name: copy.names.en, id: copy.id, sea: store.thingsIn(sea).length, clips: store.clipsFor(copy.id).map((c) => c.kind) };
  });
  assert.equal(r.name, "Our cow");
  assert.equal(r.sea, 0);
  assert.deepEqual(r.clips, ["name", "sound"], "the copy keeps its recordings");
});

test("library: a full scene says so with the way out, the tiles are off, and they come back on when there is room", async () => {
  const page = await mount({ things: 4, maxThings: 4 });
  assert.equal(await page.locator("kf-library [data-testid=library-full]").innerText(), "This scene holds 4 things. Delete one, or allow more in Settings.");
  assert.equal(await page.locator("kf-library .kf-library-tile:not(:disabled)").count(), 0);
  await page.locator('kf-library [aria-label="Add Fox"]').click({ force: true });
  assert.equal(await page.evaluate(() => window.t.store.thingsIn(window.t.farm).length), 4, "nothing added");
  await shot(page, "full");
  await page.evaluate(() => window.t.store.updateSettings({ patch: { maxThings: 8 } }));
  await page.locator("kf-library [data-testid=library-full]").waitFor({ state: "detached" });
  assert.equal(await page.locator("kf-library .kf-library-tile:disabled").count(), 0);
  assert.equal(await page.locator("kf-library [data-testid=library-count]").innerText(), "4 of 8 things in this scene");
});

test("library: Draw a new animal opens guided add; Close closes the sheet", async () => {
  const page = await mount();
  await page.locator('kf-library [data-action="draw-new"]').click();
  assert.deepEqual(await page.evaluate(() => window.t.log), [["chime", "select"], ["openPanel", "guided", {}]]);
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator("kf-library").waitFor({ state: "detached" });
});

test("library: pictures are painted once and reused across renders", async () => {
  const page = await mount();
  await page.locator('kf-library [data-source="example"] canvas').first().waitFor();
  const painted = () => page.evaluate(async () => (await import("./js/components/kf-library/thumbnail.js")).stats.painted);
  await page.waitForFunction(async () => (await import("./js/components/kf-library/thumbnail.js")).stats.painted >= 29);
  const first = await painted();
  await page.evaluate(() => window.t.store.updateSettings({ patch: { sleepMinutes: 5 } })); // a store change re-renders
  await page.waitForTimeout(200);
  assert.equal(await painted(), first, "no repaint for unchanged things");
  // A changed thing is a new object: only it is painted again.
  await page.evaluate(() => window.t.store.updateThing({ thingId: window.t.cow, patch: { color: "blue" } }));
  await page.waitForFunction((n) => import("./js/components/kf-library/thumbnail.js").then((m) => m.stats.painted === n + 1), first);
});

test("library: without examples (offline fetch failed) it still offers our animals and drawing", async () => {
  const page = await mount({ examples: [] });
  assert.equal(await page.locator('kf-library [data-source="example"]').count(), 0);
  assert.equal(await page.locator('kf-library [data-source="own"]').count(), 3);
});

test("journey: + Add in the real app, pick an example, it appears in the scene", async () => {
  const page = await h.newPage();
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
  await page.evaluate(() => { const s = window.__kf.session; s.holdArmed(); s.gatePassed(); });
  const before = await page.evaluate(() => window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).length);
  assert.equal((await page.locator('[data-testid="add-count"]').innerText()).trim(), `${before}/8`);
  await page.locator('[data-action="add"]').click();
  await page.locator('kf-library [aria-label="Add Frog"]').click();
  await page.locator("kf-library").waitFor({ state: "detached" });
  const after = await page.evaluate(() => window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).map((t) => t.names.en));
  assert.equal(after.length, before + 1);
  assert.equal(after.at(-1), "Frog");
  await page.waitForFunction((n) => document.querySelector('[data-testid="add-count"]').textContent.trim() === `${n}/8`, before + 1);
  const id = await page.evaluate(() => window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).at(-1).id);
  await page.waitForFunction((id) => !!window.__kf.board.actorRect(id), id);
  await shot(page, "journey");
  // It survives a reload.
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  assert.equal(await page.evaluate(() => window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).at(-1).names.en), "Frog");
  assert.deepEqual(page.errors, []);
});
