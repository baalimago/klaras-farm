// Find games (playtest round 3): the find buttons and the find game setup, each mounted alone, and
// two journeys through the real app (the question is heard before the sound; long-press → adult
// check → record a question and a colour word → a colour round plays them).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const STUBS = join(ROOT, "tests/browser/stubs/f1-stubs.js");
let h;

before(async () => { h = await setup({ fakeMedia: true }); });
after(async () => { await h?.teardown(); });

/** A device voice like iPad's: starts after 10 ms, ends 300 ms later. Logs what it says. */
function speechStub() {
  window.__speech = [];
  const synth = new EventTarget();
  Object.assign(synth, {
    speaking: false,
    pending: false,
    getVoices: () => [],
    cancel() { this.speaking = false; },
    speak(u) {
      window.__speech.push(u.text);
      this.speaking = true;
      setTimeout(() => { u.onstart?.(); setTimeout(() => { this.speaking = false; u.onend?.(); }, 300); }, 10);
    },
  });
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
}

const center = async (locator) => {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// ---------------------------------------------------------------- <kf-find-buttons> alone

test("find buttons: a tap starts the game when the finger lifts; a 1 s hold opens that game's setup after the adult check", async () => {
  const page = await h.modulePage('<div id="stage"></div><div id="parent-layer"></div>');
  await page.evaluate(async () => {
    await import("./js/components/kf-find-buttons/define.js");
    const { Session } = await import("./js/session.js");
    window.__log = [];
    const log = (...a) => window.__log.push(a.join(":"));
    const engine = new EventTarget();
    Object.assign(engine, { mode: "play", findAvailable: true, findRound: null, startFind: (k) => log("startFind", k), setMode: (m) => log("setMode", m) });
    const audio = { unlock: () => log("unlock"), holdTone: () => {}, chime: () => {} };
    const session = new Session({ holdMs: 1500 });
    const services = { engine, audio, session };
    session.connect(services);
    const el = document.createElement("kf-find-buttons");
    el.services = services;
    document.getElementById("stage").append(el);
    window.__session = session;
  });
  const animal = page.getByRole("button", { name: "Find the animal" });
  const color = page.getByRole("button", { name: "Find a colour" });
  const log = () => page.evaluate(() => window.__log);

  // A short tap: nothing starts on the way down, the game starts on the way up (iOS speech).
  const a = await center(animal);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  assert.deepEqual(await log(), ["unlock"]);
  assert.equal(await animal.evaluate((b) => b.classList.contains("is-held")), true, "the button shows it is pressed");
  await page.mouse.up();
  assert.deepEqual(await log(), ["unlock", "unlock", "startFind:animal"]);
  assert.equal(await animal.evaluate((b) => b.classList.contains("is-held")), false);

  // A hold: the ring fills, the adult check is asked for, and the lift starts no game.
  const c = await center(color);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(1250);
  await page.locator("kf-hold-ring").waitFor({ state: "attached" });
  await page.mouse.up();
  const after = await page.evaluate(() => ({ log: window.__log, mode: window.__session.state.mode, then: window.__session.state.then }));
  assert.ok(!after.log.includes("startFind:color"), JSON.stringify(after.log));
  assert.equal(after.mode, "gate");
  assert.deepEqual(after.then, { name: "find-setup", params: { game: "color" } });
  await page.evaluate(() => window.__session.gatePassed());
  assert.deepEqual(await page.evaluate(() => window.__session.state.panel), { name: "find-setup", params: { game: "color" } });
  assert.deepEqual(page.errors, []);
});

test("find buttons: a hold whose lift never reaches the button is not left pressed once the adult check opens", async () => {
  const page = await h.modulePage('<div id="stage"></div><div id="parent-layer"></div>');
  await page.evaluate(async () => {
    await import("./js/components/kf-find-buttons/define.js");
    const { Session } = await import("./js/session.js");
    window.__log = [];
    const engine = new EventTarget();
    Object.assign(engine, { mode: "play", findAvailable: true, findRound: null, startFind: (k) => window.__log.push(k), setMode: () => {} });
    const services = { engine, audio: { unlock: () => {}, holdTone: () => {}, chime: () => {} }, session: new Session({ holdMs: 1500 }) };
    services.session.connect(services);
    const el = document.createElement("kf-find-buttons");
    el.services = services;
    document.getElementById("stage").append(el);
    window.__session = services.session;
  });
  const color = page.getByRole("button", { name: "Find a colour" });
  const c = await center(color);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__session.state.mode === "gate", null, { timeout: 3000 });
  // The finger lifts over the adult check, not the button: no pointerup for the button.
  // (The buttons hide outside play, so look the button up directly.)
  assert.equal(await page.locator(".kf-find-btn--color").evaluate((b) => b.classList.contains("is-held")), false, "leaving play ends the press");
  assert.deepEqual(page.errors, []);
});

// ---------------------------------------------------------------- <kf-find-setup> alone

async function setupPage(game) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.addScriptTag({ path: STUBS, type: "module" });
  await page.waitForFunction(() => window.__f1);
  await page.evaluate(async (game) => {
    const { FarmStore } = await import("./js/farm-store.js");
    const { MemoryRepo } = await import("./js/io/memory-repo.js");
    let n = 0;
    let t = Date.UTC(2026, 10, 3, 12);
    const env = { now: () => new Date((t += 1000)).toISOString(), rng: () => 0.5, newId: () => `id-${String(++n).padStart(4, "0")}`, deviceId: "test" };
    const store = new FarmStore(new MemoryRepo(), env, "test");
    await store.hydrate();
    await store.createPlace({ name: "Farm" });
    const placeId = store.currentPlace.id;
    const sq = (cx) => [[cx - 0.08, 0.5], [cx + 0.08, 0.5], [cx + 0.08, 0.7], [cx - 0.08, 0.7]];
    await store.addThing({ placeId, names: { en: "Hen" }, outline: sq(0.3), color: "yellow" });
    await store.addThing({ placeId, names: { en: "Pig" }, outline: sq(0.6), color: "pink" });
    const scripts = { en: await (await fetch("data/scripts/en.json")).json() };
    const services = window.__f1.makeServices({ store, scripts });
    await import("./js/components/kf-find-setup/define.js");
    const el = document.createElement("kf-find-setup");
    el.services = services;
    el.params = { game };
    window.__closed = 0;
    el.addEventListener("kf-close", () => { window.__closed++; el.remove(); });
    document.getElementById("parent-layer").append(el);
    await el.ready;
    const [hen, pig] = store.thingsIn(placeId);
    window.__t = { store, hen: hen.id, pig: pig.id, el };
  }, game);
  return page;
}

test("find game setup: record a question per animal, edit the example lines freely, add and remove questions", async () => {
  const page = await setupPage("animal");
  await page.getByRole("heading", { name: "Find game" }).waitFor();
  const hen = page.locator(`.kf-fs-thing[data-thing="${await page.evaluate(() => window.__t.hen)}"]`);
  assert.equal(await page.locator(".kf-fs-thing").count(), 2, "one section per thing in the scene");
  await hen.getByText("Examples, change them freely", { exact: false }).waitFor();
  assert.equal(await hen.locator('input[name^="cue-"]').count(), 3);
  assert.equal(await hen.locator('input[name="cue-1"]').inputValue(), "Where is the Hen?");

  // Record question 1 (the stub recorder finishes a take at once).
  await hen.locator('.kf-tc-clip[data-kind="prompt"][data-take="1"] [data-action="record"]').click();
  assert.equal(await page.locator("kf-recorder .stub-label").textContent(), "Where is the Hen?", "the recorder says what to say");
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction(() => window.__t.store.clipsFor(window.__t.hen, { kind: "prompt" }).length === 1);
  await hen.locator('.kf-tc-clip[data-take="1"] [data-action="play"]').waitFor();
  assert.equal(await page.locator("kf-recorder").count(), 0, "the recorder closes after a good take");

  // Free text: change question 2, add a fourth.
  await hen.locator('input[name="cue-2"]').fill("Where is my little hen?");
  await hen.locator('input[name="cue-2"]').press("Tab");
  await page.waitForFunction(() => window.__t.store.snapshot.things.find((t) => t.id === window.__t.hen).cues.en?.lines?.[1] === "Where is my little hen?");
  await hen.getByRole("button", { name: "+ Add a question" }).click();
  await hen.locator('input[name="cue-4"]').waitFor();
  assert.equal(await hen.locator('input[name^="cue-"]').count(), 4);

  // Removing question 1 removes its recording; the lines move up.
  await hen.getByRole("button", { name: "Remove question 1" }).click();
  await page.waitForFunction(() => window.__t.store.clipsFor(window.__t.hen, { kind: "prompt" }).length === 0);
  assert.equal(await hen.locator('input[name^="cue-"]').count(), 3);
  assert.equal(await hen.locator('input[name="cue-1"]').inputValue(), "Where is my little hen?");
  // The removal offers Undo, which brings the question and its recording back.
  const toast = await page.evaluate(() => window.__f1.toasts.at(-1)?.message);
  assert.equal(toast, "Removed question 1");
  await page.evaluate(() => window.__f1.toasts.at(-1).undo());
  await page.waitForFunction(() => window.__t.store.clipsFor(window.__t.hen, { kind: "prompt" }).length === 1);
  await hen.locator('input[name="cue-4"]').waitFor();
  assert.equal(await hen.locator('input[name="cue-1"]').inputValue(), "Where is the Hen?");

  await page.getByRole("button", { name: "Done" }).click();
  assert.equal(await page.evaluate(() => window.__closed), 1);
  assert.deepEqual(page.errors, []);
});

test("find game setup: typing a question then tapping a button straight away keeps the tap (no lost Done)", async () => {
  const page = await setupPage("animal");
  const hen = page.locator(`.kf-fs-thing[data-thing="${await page.evaluate(() => window.__t.hen)}"]`);
  // No Tab first: the field commits on blur, inside this very tap.
  await hen.locator('input[name="cue-2"]').fill("Where is my little hen?");
  await hen.getByRole("button", { name: "+ Add a question" }).click();
  await hen.locator('input[name="cue-4"]').waitFor({ timeout: 2000 });
  assert.equal(await page.evaluate(() => window.__t.store.snapshot.things.find((t) => t.id === window.__t.hen).cues.en.lines[1]), "Where is my little hen?");
  await hen.locator('input[name="cue-1"]').fill("Peekaboo, hen!");
  await page.getByRole("button", { name: "Done" }).click();
  assert.equal(await page.evaluate(() => window.__closed), 1, "one tap on Done closes the panel");
  assert.equal(await page.evaluate(() => window.__t.store.snapshot.things.find((t) => t.id === window.__t.hen).cues.en.lines[0]), "Peekaboo, hen!");
  assert.deepEqual(page.errors, []);
});

test("find game setup: editing the last animal's question keeps the place on screen, and its Record opens", async () => {
  const page = await setupPage("animal");
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(async () => {
    const { store } = window.__t;
    const sq = (cx, cy) => [[cx - 0.04, cy], [cx + 0.04, cy], [cx + 0.04, cy + 0.1], [cx - 0.04, cy + 0.1]];
    for (let i = 0; i < 5; i++) await store.addThing({ placeId: store.currentPlace.id, names: { en: `Thing ${i}` }, outline: sq(0.1 + i * 0.15, 0.2), color: "blue" });
  });
  const last = page.locator(".kf-fs-thing").last();
  await last.locator('input[name="cue-2"]').scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => document.querySelector(".kf-fs").scrollTop);
  assert.ok(before > 300, `the sheet scrolled down (${before})`);
  await last.locator('input[name="cue-2"]').fill("Where did it go?");
  await last.locator('.kf-tc-clip[data-take="2"] [data-action="record"]').click();
  await page.locator("kf-recorder").waitFor({ timeout: 2000 });
  const after = await page.evaluate(() => document.querySelector(".kf-fs").scrollTop);
  assert.ok(Math.abs(after - before) < 80, `the sheet stays where it was (${before} → ${after})`);
  assert.equal(await page.locator(".kf-fs-thing").last().locator("kf-recorder").count(), 1, "the recorder opens on the animal that was tapped");
  assert.deepEqual(page.errors, []);
});

test("find game setup: while a question records, removing questions waits (it would move the recordings)", async () => {
  const page = await setupPage("animal");
  const hen = page.locator(`.kf-fs-thing[data-thing="${await page.evaluate(() => window.__t.hen)}"]`);
  await hen.locator('.kf-tc-clip[data-take="3"] [data-action="record"]').click();
  await page.locator("kf-recorder").waitFor();
  for (let i = 1; i <= 3; i++) assert.equal(await hen.getByRole("button", { name: `Remove question ${i}` }).isDisabled(), true);
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.locator("kf-recorder").waitFor({ state: "detached" });
  assert.equal(await hen.getByRole("button", { name: "Remove question 2" }).isDisabled(), false);
  assert.deepEqual(page.errors, []);
});

test("colour game setup: record the question, tap an animal to record its colour word; missing colours show", async () => {
  const page = await setupPage("color");
  await page.getByRole("heading", { name: "Colour game" }).waitFor();
  const status = page.locator(".kf-fs-status");
  assert.equal(await status.textContent(), "Still to record: the question, yellow, pink.");
  assert.equal(await page.locator('[role="tab"][data-lang="en"]').textContent(), "English · 3 to record");

  await page.locator('.kf-tc-clip[data-kind="color-question"][data-take="1"] [data-action="record"]').click();
  assert.match(await page.locator("kf-recorder .stub-label").textContent(), /Tap on an animal that is…/);
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction(() => window.__t.store.gameClips({ kind: "color-question" }).length === 1);
  await status.filter({ hasText: "Still to record: yellow, pink." }).waitFor();

  // Tap the hen: its colour (yellow) opens; record the word.
  await page.locator(`.kf-fs-pick-thing[data-thing="${await page.evaluate(() => window.__t.hen)}"]`).click();
  assert.equal(await page.locator('.kf-fs-swatch[data-group="yellow"]').getAttribute("aria-pressed"), "true");
  await page.locator('.kf-tc-clip[data-kind="color-word"][data-color="yellow"] [data-action="record"]').click();
  assert.equal(await page.locator("kf-recorder .stub-label").textContent(), "Say just the colour: “yellow”");
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction(() => window.__t.store.gameClips({ kind: "color-word", color: "yellow" }).length === 1);
  await status.filter({ hasText: "Still to record: pink." }).waitFor();
  assert.equal(await page.locator('.kf-fs-swatch[data-group="yellow"]').getAttribute("aria-label"), "yellow, recorded");
  assert.equal(await page.locator('[role="tab"][data-lang="en"]').textContent(), "English · 1 to record");

  // A swatch works too: pink, then everything is recorded.
  await page.locator('.kf-fs-swatch[data-group="pink"]').click();
  await page.locator('.kf-tc-clip[data-kind="color-word"][data-color="pink"] [data-action="record"]').click();
  await page.locator('kf-recorder [data-stub="take"]').click();
  await status.filter({ hasText: "Everything for this scene is recorded in English ✓" }).waitFor();
  const words = await page.evaluate(() => window.__t.store.gameClips({ kind: "color-word" }).map((c) => [c.color, c.language, c.thingId]));
  assert.deepEqual(words.sort(), [["pink", "en", null], ["yellow", "en", null]]);
  await page.screenshot({ path: join(ROOT, "tests/browser/.shots/colour-setup.png"), fullPage: true }).catch(() => {});
  assert.deepEqual(page.errors, []);
});

// ---------------------------------------------------------------- journeys through the real app

async function startPlaying(page) {
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
}

/** Records what the app plays, in order: device voice lines and clip starts. */
async function listen(page) {
  await page.evaluate(() => {
    window.__heard = [];
    const a = window.__kf.audio;
    a.addEventListener("speak", (e) => window.__heard.push(["speak", e.detail.text, performance.now()]));
    a.addEventListener("clip-start", (e) => window.__heard.push(["clip", e.detail.clipId, performance.now()]));
  });
}

/** A short real WAV tone, stored as a blob, saved as a clip. */
async function seedClip(page, clip) {
  return page.evaluate(async (clip) => {
    const { encodeWav } = await import("./js/dsp/wav.js");
    const { sha256Hex } = await import("./js/io/sha.js");
    const rate = 44100;
    const samples = new Float32Array(rate * 0.25).map((_, i) => 0.3 * Math.sin((i / rate) * 2 * Math.PI * (clip.freq ?? 440)));
    const bytes = encodeWav(samples, rate);
    const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const sha256 = await sha256Hex(buf);
    const store = window.__kf.store;
    const { freq, ...rest } = clip;
    const blob = { sha256, mime: "audio/wav", size: buf.byteLength, createdAt: new Date().toISOString(), bytes: buf };
    await store.saveClip({ clip: { language: "en", take: 1, blobSha256: sha256, mime: "audio/wav", durationMs: 250, trimStartMs: 0, trimEndMs: 250, gainDb: 0, ...rest }, blob });
    return store.snapshot.clips.at(-1).id;
  }, clip);
}

test("journey: the 🔍 asks “Where is the …?” in the device voice first, and the animal's sound follows after it", async () => {
  const page = await h.newPage({ init: speechStub });
  await startPlaying(page);
  const ids = await page.evaluate(() => window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).map((t) => t.id));
  const sounds = {};
  for (const [i, thingId] of ids.entries()) sounds[await seedClip(page, { thingId, kind: "sound", freq: 300 + i * 100 })] = thingId;
  await listen(page);
  const animal = page.getByRole("button", { name: "Find the animal" });
  await animal.click();
  await page.waitForFunction(() => window.__heard.some((x) => x[0] === "clip"), null, { timeout: 5000 });
  const heard = await page.evaluate(() => window.__heard);
  const target = await page.evaluate(() => window.__kf.engine.asking);
  assert.equal(heard[0][0], "speak", `the question comes first: ${JSON.stringify(heard)}`);
  assert.match(heard[0][1], /Where is|Can you find|Show me/);
  const clip = heard.find((x) => x[0] === "clip");
  assert.equal(sounds[clip[1]], target, "then the asked animal's own sound");
  assert.ok(clip[2] - heard[0][2] >= 300, "the sound waits for the question to finish");
  assert.deepEqual(await page.evaluate(() => window.__speech), [" ", heard[0][1]], "the first tap (Start playing) primed the voice silently; then one question");
  assert.deepEqual(page.errors, []);
});

test("journey: long-press 🔍 → adult check → record a question with the mic; long-press colours → record question and word → a colour round plays them", async () => {
  const page = await h.newPage({ init: speechStub });
  await startPlaying(page);
  const passGate = async () => {
    await page.locator("kf-adult-check").waitFor();
    const digits = (await page.locator("kf-adult-check").textContent()).match(/Tap\s+(\d)\s+(\d)\s+(\d)/).slice(1);
    for (const d of digits) await page.locator("kf-adult-check").getByRole("button", { name: d, exact: true }).click();
  };
  const holdButton = async (name) => {
    const p = await center(page.getByRole("button", { name }));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(1300);
    await page.mouse.up();
  };
  const recordWithMic = async (slot) => {
    await slot.locator('[data-action="record"]').click();
    const rec = slot.locator("kf-recorder");
    await rec.getByRole("button", { name: /^Record/ }).click();
    await page.waitForTimeout(1200);
    await rec.getByRole("button", { name: "Stop" }).click().catch(() => {});
    await slot.locator('[data-action="play"]').waitFor({ timeout: 10000 });
  };

  await holdButton("Find the animal");
  assert.equal(await page.evaluate(() => window.__kf.engine.findRound), null, "the hold starts no round");
  await passGate();
  await page.locator("kf-find-setup").getByRole("heading", { name: "Find game" }).waitFor();
  await page.screenshot({ path: join(ROOT, "tests/browser/.shots/find-setup.png") }).catch(() => {});
  const first = page.locator(".kf-fs-thing").first();
  await recordWithMic(first.locator('.kf-tc-clip[data-kind="prompt"][data-take="1"]'));
  assert.equal(await page.evaluate(() => window.__kf.store.snapshot.clips.filter((c) => c.kind === "prompt").length), 1);
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.locator("kf-find-setup").waitFor({ state: "detached" });
  await page.locator("kf-edit-layer").getByRole("button", { name: "Done", exact: true }).click();
  await page.locator("kf-edit-layer").waitFor({ state: "detached" });

  await holdButton("Find a colour");
  await passGate();
  await page.locator("kf-find-setup").getByRole("heading", { name: "Colour game" }).waitFor();
  await recordWithMic(page.locator('.kf-tc-clip[data-kind="color-question"][data-take="1"]'));
  await page.locator(".kf-fs-pick-thing").first().click();
  const color = await page.locator(".kf-fs-pick-thing").first().getAttribute("data-color");
  await recordWithMic(page.locator(`.kf-tc-clip[data-kind="color-word"][data-color="${color}"]`));
  await page.screenshot({ path: join(ROOT, "tests/browser/.shots/colour-setup-app.png") }).catch(() => {});
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.locator("kf-edit-layer").getByRole("button", { name: "Done", exact: true }).click();
  await page.locator("kf-edit-layer").waitFor({ state: "detached" });

  // A colour round on that colour plays the recorded question, then the recorded word.
  const clips = await page.evaluate((color) => ({
    q: window.__kf.store.gameClips({ kind: "color-question" })[0].id,
    w: window.__kf.store.gameClips({ kind: "color-word", color })[0].id,
  }), color);
  await listen(page);
  const colorButton = page.getByRole("button", { name: "Find a colour" });
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => { window.__heard = []; window.__kf.engine.stopFind(); });
    await colorButton.click();
    if ((await page.evaluate(() => window.__kf.engine.findRound?.color)) === color) break;
  }
  assert.equal(await page.evaluate(() => window.__kf.engine.findRound?.color), color);
  await page.waitForFunction((w) => window.__heard.some((x) => x[1] === w), clips.w, { timeout: 5000 });
  const heard = await page.evaluate(() => window.__heard.map((x) => x[1]));
  assert.deepEqual(heard.slice(0, 2), [clips.q, clips.w], "the recorded question, then the colour word, and no device voice");
  assert.deepEqual(page.errors, []);
});
