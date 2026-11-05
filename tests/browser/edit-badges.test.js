// <kf-edit-layer>'s badges, mounted alone with a real FarmStore over MemoryRepo and a fake board,
// session and engine: the pencil says what a thing still needs (QA round 3). A thing left without a
// name (cleared on its card) shows a "needs a name" mark, the way a thing without a recorded name
// shows the mic dot, and the pencil's label says so.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

async function mount() {
  const page = await h.modulePage("");
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(async () => {
    const { FarmStore } = await import("./js/farm-store.js");
    const { MemoryRepo } = await import("./js/io/memory-repo.js");
    await import("./js/components/kf-edit-layer/define.js");
    let n = 0;
    const env = { now: () => new Date().toISOString(), rng: () => 0.5, newId: () => `id-${++n}`, deviceId: "test" };
    const store = new FarmStore(new MemoryRepo(), env, "test");
    await store.hydrate();
    await store.createPlace({ name: "Farm" });
    const placeId = store.currentPlace.id;
    const sq = (cx) => [[cx - 0.05, 0.6], [cx + 0.05, 0.6], [cx + 0.05, 0.8], [cx - 0.05, 0.8]];
    await store.addThing({ placeId, names: { en: "Cow" }, outline: sq(0.3), color: "white" });
    await store.addThing({ placeId, names: {}, outline: sq(0.7), color: "pink" });
    const [cow, nameless] = store.thingsIn(placeId).map((t) => t.id);
    const blob = { sha256: "c".repeat(64), mime: "audio/mp4", size: 1, createdAt: env.now(), bytes: new Uint8Array([1]).buffer };
    await store.saveClip({ clip: { thingId: cow, language: "en", kind: "name", take: 1, blobSha256: blob.sha256, mime: "audio/mp4", durationMs: 400, trimStartMs: 0, trimEndMs: 400, gainDb: 0 }, blob });
    const board = Object.assign(new EventTarget(), {
      actorRect: (id) => {
        const left = id === cow ? 300 : 800;
        return { left, top: 400, right: left + 120, bottom: 560, width: 120, height: 160 };
      },
    });
    const session = Object.assign(new EventTarget(), { state: { mode: "edit", panel: null }, services: {}, openPanel: () => {} });
    const el = document.createElement("kf-edit-layer");
    el.services = { store, board, session, engine: { settling: false } };
    document.body.append(el);
    window.__t = { store, cow, nameless };
  });
  await page.locator("kf-edit-layer .kf-badge.pencil").nth(1).waitFor();
  return page;
}

const pencil = (page, id) => page.locator(`kf-edit-layer .kf-badge.pencil[data-thing-id="${id}"]`);

test("a nameless thing's pencil carries a 'needs a name' mark and says so; a named, recorded one has no mark", async () => {
  const page = await mount();
  const { cow, nameless } = await page.evaluate(() => window.__t);
  assert.equal(await pencil(page, nameless).getAttribute("aria-label"), "Edit this thing (needs a name)");
  assert.equal(await pencil(page, nameless).locator(".kf-name-dot").count(), 1);
  assert.equal(await pencil(page, nameless).locator(".kf-voice-dot").count(), 0, "one mark: the name comes first");
  assert.equal(await pencil(page, cow).getAttribute("aria-label"), "Edit Cow");
  assert.equal(await pencil(page, cow).locator(".kf-name-dot, .kf-voice-dot").count(), 0);

  // Naming it moves the mark on to the voice; clearing the cow's name brings the name mark.
  await page.evaluate(({ cow, nameless }) => {
    window.__t.store.updateThing({ thingId: nameless, patch: { names: { en: "Pig" } } });
    window.__t.store.updateThing({ thingId: cow, patch: { names: {} } });
  }, { cow, nameless });
  await page.waitForFunction((id) => document.querySelector(`.kf-badge.pencil[data-thing-id="${id}"]`)?.getAttribute("aria-label") === "Edit Pig (needs your voice)", nameless);
  assert.equal(await pencil(page, nameless).locator(".kf-voice-dot").count(), 1);
  assert.equal(await pencil(page, cow).getAttribute("aria-label"), "Edit this thing (needs a name)");
  assert.deepEqual(page.errors, []);
});
