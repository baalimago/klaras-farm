// QA round 3: "re-recorded sound, this is like the original one, I don't know what the animals say
// anymore", "it doesn't have a name", "enter does not finish the form", and "encourage recording your
// own question". The thing card and the find setup, each mounted alone with the F1 stubs (the stub
// recorder finishes a take at once). After every step the screen must say what play would play.
// Set KF_SHOTS to a folder to save iPad-sized screenshots.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const STUBS = join(ROOT, "tests/browser/stubs/f1-stubs.js");
const SHOTS = process.env.KF_SHOTS;
let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

/** A store with one place and one cow (names, languages and clips as given), and `tag` mounted. */
async function mounted(tag, { names = { en: "Cow" }, languages = ["en"], clips = [], params } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.addScriptTag({ path: STUBS, type: "module" });
  await page.waitForFunction(() => window.__f1);
  await page.evaluate(async ({ tag, names, languages, clips, params }) => {
    const { FarmStore } = await import("./js/farm-store.js");
    const { MemoryRepo } = await import("./js/io/memory-repo.js");
    let n = 0;
    let t = Date.UTC(2026, 10, 3, 12);
    const env = { now: () => new Date((t += 1000)).toISOString(), rng: () => 0.5, newId: () => `id-${String(++n).padStart(4, "0")}`, deviceId: "test" };
    const store = new FarmStore(new MemoryRepo(), env, "test");
    await store.hydrate();
    await store.updateSettings({ patch: { languages } });
    await store.createPlace({ name: "Farm" });
    const placeId = store.currentPlace.id;
    await store.addThing({ placeId, names, outline: [[0.42, 0.5], [0.58, 0.5], [0.58, 0.7], [0.42, 0.7]], color: "white", eyes: [{ x: 0.52, y: 0.56 }] });
    const thingId = store.thingsIn(placeId)[0].id;
    let k = 0;
    for (const c of clips) {
      const sha = `c0${(++k).toString(16)}`.padStart(64, "0");
      await store.saveClip({ clip: { thingId: c.thingId === null ? null : thingId, take: 1, blobSha256: sha, mime: "audio/mp4", durationMs: 600, trimStartMs: 0, trimEndMs: 600, gainDb: 0, ...c } });
    }
    const scripts = { en: await (await fetch("data/scripts/en.json")).json(), sv: await (await fetch("data/scripts/sv.json")).json() };
    const services = window.__f1.makeServices({ store, scripts });
    window.__t = { store, thingId, services };
    await import(`./js/components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.services = services;
    el.params = params ?? { thingId };
    window.__closed = 0;
    el.addEventListener("kf-close", () => { window.__closed++; el.remove(); });
    document.getElementById("parent-layer").append(el);
    await el.ready;
    window.__el = el;
  }, { tag, names, languages, clips, params });
  return page;
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const slot = (page, kind, take = 1) => page.locator(`kf-thing-card .kf-tc-clip[data-kind="${kind}"][data-take="${take}"]`);
const voiceOf = (loc) => loc.locator(".kf-tc-voice");
const finishTake = (page) => page.locator('kf-recorder [data-stub="take"]').click();
const sounds = (page) => page.evaluate(() => window.__t.store.clipsFor(window.__t.thingId, { kind: "sound" }).map((c) => c.language));

test("thing card: nothing recorded says the iPad voice; a new take replaces it and the card says “Your recording”", async () => {
  const page = await mounted("kf-thing-card");
  const name = slot(page, "name");
  assert.equal(await name.getAttribute("data-voice"), "voice");
  assert.equal(await voiceOf(name).textContent(), "Built-in voice says “Cow” for now");
  assert.match(await name.locator('[data-action="record"]').getAttribute("class"), /primary/, "Record is the invitation");
  assert.equal(await name.locator('[data-action="play"]').count(), 0, "nothing of yours to play yet");
  assert.equal(await voiceOf(slot(page, "sound")).textContent(), "No sound yet");
  await shot(page, "card-nothing-recorded");

  await name.locator('[data-action="record"]').click();
  await finishTake(page);
  await page.locator("kf-recorder").waitFor({ state: "detached" });
  assert.equal(await voiceOf(name).textContent(), "Your recording");
  assert.equal(await name.locator('[data-action="record"]').textContent(), "Re-record: say “Cow”");

  // Re-record: the card's ▶ plays the new take, and only one name clip is kept.
  await name.locator('[data-action="record"]').click();
  await finishTake(page);
  await page.locator("kf-recorder").waitFor({ state: "detached" });
  const names = await page.evaluate(() => window.__t.store.clipsFor(window.__t.thingId, { kind: "name" }).map((c) => c.id));
  assert.equal(names.length, 1);
  await name.locator('[data-action="play"]').click();
  assert.equal(await page.evaluate(() => window.__f1.played.at(-1)), names[0], "▶ plays the take now in use");
  assert.deepEqual(page.errors, []);
});

test("thing card: one sound for every language; re-recording it on the Swedish tab replaces the English take", async () => {
  const page = await mounted("kf-thing-card", {
    names: { en: "Cow", sv: "Ko" }, languages: ["en", "sv"],
    clips: [{ language: "en", kind: "sound" }, { language: "en", kind: "name" }],
  });
  await page.locator('[role="tab"][data-lang="sv"]').click();
  const sound = slot(page, "sound");
  assert.equal(await voiceOf(sound).textContent(), "Your recording", "the English sound is this tab's sound too");
  assert.equal(await voiceOf(slot(page, "name")).textContent(), "Plays your English recording for now");
  assert.equal(await slot(page, "name").locator('[data-action="play"]').count(), 1, "▶ plays what Klara hears");
  await shot(page, "card-swedish-tab");

  await sound.locator('[data-action="record"]').click();
  await finishTake(page);
  await page.locator("kf-recorder").waitFor({ state: "detached" });
  assert.deepEqual(await sounds(page), ["sv"], "the old sound is gone: Klara hears the new one in every language");
  await page.locator('[role="tab"][data-lang="en"]').click();
  await voiceOf(slot(page, "sound")).filter({ hasText: "Your recording" }).waitFor();
  const soundId = await page.evaluate(() => window.__t.store.clipsFor(window.__t.thingId, { kind: "sound" })[0].id);
  await slot(page, "sound").locator('[data-action="play"]').click();
  assert.equal(await page.evaluate(() => window.__f1.played.at(-1)), soundId);
  assert.deepEqual(page.errors, []);
});

test("thing card: a missing name stands out; Enter saves it and closes the keyboard", async () => {
  const page = await mounted("kf-thing-card", { names: {} });
  assert.equal(await page.locator("#kf-tc-title").textContent(), "No name yet");
  const label = page.locator(".kf-tc-name");
  assert.match(await label.getAttribute("class"), /is-missing/);
  assert.equal(await label.locator("span").textContent(), "Give it a name");
  const input = page.locator('input[name="name"]');
  assert.equal(await input.getAttribute("aria-invalid"), "true");
  assert.equal(await input.getAttribute("enterkeyhint"), "done");
  assert.equal(await slot(page, "name").locator('[data-action="record"]').textContent(), "Record its name");
  await shot(page, "card-no-name");

  await input.fill("Ko");
  await input.press("Enter");
  await page.waitForFunction(() => window.__t.store.snapshot.things[0].names.en === "Ko");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "BODY", "the field let go: the keyboard closes");
  await page.locator("#kf-tc-title").filter({ hasText: "Ko" }).waitFor();
  assert.doesNotMatch(await page.locator(".kf-tc-name").getAttribute("class"), /is-missing/);
  assert.equal(await voiceOf(slot(page, "name")).textContent(), "Built-in voice says “Ko” for now");

  assert.deepEqual(page.errors, []);
});

test("find setup: the unrecorded find question invites your own; a take replaces the iPad voice", async () => {
  const page = await mounted("kf-find-setup", { params: { game: "animal" } });
  const invite = page.getByTestId("find-invite");
  await invite.waitFor();
  assert.equal(await invite.textContent(), "The built-in voice asks this for now. Record your own: Klara knows your voice best.");
  const q1 = page.locator('.kf-tc-clip[data-kind="find-question"][data-take="1"]');
  assert.equal(await voiceOf(q1).textContent(), "Built-in voice for now");
  assert.equal(await q1.locator('[data-action="record"]').textContent(), "Record your own");
  await shot(page, "find-setup-invite");
  await q1.locator('[data-action="record"]').click();
  await finishTake(page);
  await page.locator("kf-recorder").waitFor({ state: "detached" });
  assert.equal(await invite.count(), 0);
  // Its own recording plays only with the animal's recorded name: until then the slot says so.
  assert.equal(await voiceOf(q1).textContent(), "Built-in voice until a name is recorded");
  const name = page.locator('.kf-fs-thing .kf-tc-clip[data-kind="name"]');
  await name.locator('[data-action="record"]').click();
  await finishTake(page);
  await voiceOf(q1).filter({ hasText: "Your recording" }).waitFor();
  assert.deepEqual(page.errors, []);
});

test("colour game setup: “Tap on an animal that is…” invites your own until it is recorded", async () => {
  const page = await mounted("kf-find-setup", { params: { game: "color" } });
  const invite = page.getByTestId("color-invite");
  await invite.waitFor();
  const q = page.locator('.kf-tc-clip[data-kind="color-question"][data-take="1"]');
  assert.equal(await voiceOf(q).textContent(), "Built-in voice for now");
  await page.locator('.kf-fs-swatch[data-group="white"]').click();
  const word = page.locator('.kf-tc-clip[data-kind="color-word"][data-color="white"]');
  assert.equal(await voiceOf(word).textContent(), "Built-in voice for now");
  await shot(page, "colour-setup-invite");
  await q.locator('[data-action="record"]').click();
  await finishTake(page);
  // The recorded question plays only with the colour's recorded word (play/ask.js planColorAsk).
  await voiceOf(q).filter({ hasText: "Built-in voice until a colour word is recorded" }).waitFor();
  assert.equal(await invite.count(), 0);
  await word.locator('[data-action="record"]').click();
  await finishTake(page);
  await voiceOf(word).filter({ hasText: "Your recording" }).waitFor();
  assert.equal(await voiceOf(q).textContent(), "Your recording", "the scene's one colour has its word");
  assert.deepEqual(page.errors, []);
});
