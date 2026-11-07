// Find games (playtest round 3): the find buttons and the find game setup, each mounted alone, and
// two journeys through the real app (the question is heard before the sound; long-press → adult
// check → record a question and a colour word → a colour round plays them).
// Format 5: the find game works like the colour game: the family's question, then the animal's name.
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

test("find game setup: record the question once, then each animal's name; what plays and what is missing show", async () => {
  const page = await setupPage("animal");
  await page.getByRole("heading", { name: "Find game" }).waitFor();
  const status = page.locator(".kf-fs-status");
  assert.equal(await status.textContent(), "Still to record: the question, Hen, Pig.");
  assert.equal(await page.locator('[role="tab"][data-lang="en"]').textContent(), "English · 3 to record");
  assert.equal(await page.locator('input[name^="cue-"]').count(), 0, "no per-animal questions any more");
  assert.equal(await page.locator(".kf-fs-thing").count(), 2, "one name slot per thing in the scene");
  await page.getByTestId("find-invite").waitFor();

  // The question: the stub recorder finishes a take at once.
  await page.locator('.kf-tc-clip[data-kind="find-question"][data-take="1"] [data-action="record"]').click();
  assert.equal(await page.locator("kf-recorder .stub-label").textContent(), "Where is the…", "the recorder says what to say");
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction(() => window.__t.store.gameClips({ kind: "find-question" }).length === 1);
  assert.equal(await page.locator("kf-recorder").count(), 0, "the recorder closes after a good take");
  assert.equal(await page.getByTestId("find-invite").count(), 0);
  await status.filter({ hasText: "Still to record: Hen, Pig." }).waitFor();
  const q1 = page.locator('.kf-tc-clip[data-kind="find-question"][data-take="1"] .kf-tc-voice');
  assert.equal(await q1.textContent(), "Built-in voice until a name is recorded", "never says Your recording while Klara hears the iPad voice");

  // The hen's name: the question now plays for the hen, the iPad voice still asks for the pig.
  const hen = page.locator(`.kf-fs-thing[data-thing="${await page.evaluate(() => window.__t.hen)}"]`);
  assert.equal(await hen.locator(".kf-tc-voice").textContent(), "Built-in voice says “Hen” for now");
  await hen.locator('.kf-tc-clip[data-kind="name"] [data-action="record"]').click();
  assert.equal(await page.locator("kf-recorder .stub-label").textContent(), "Say just its name, slowly and clearly: “Hen”");
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction(() => window.__t.store.clipsFor(window.__t.hen, { kind: "name" }).length === 1);
  await status.filter({ hasText: "Still to record: Pig." }).waitFor();
  assert.equal(await hen.locator(".kf-tc-voice").textContent(), "Your recording");
  assert.equal(await q1.getAttribute("data-voice"), "partial");
  assert.equal(await q1.textContent(), "Plays with each name: 1 of 2 recorded (Pig: built-in voice for now)");
  assert.equal(await page.locator('[role="tab"][data-lang="en"]').textContent(), "English · 1 to record");

  // A second way to ask, then the pig: everything is recorded.
  await page.getByRole("button", { name: "+ Another way to ask" }).click();
  await page.locator('.kf-tc-clip[data-kind="find-question"][data-take="2"] [data-action="record"]').click();
  await page.locator('kf-recorder [data-stub="take"]').click();
  const pig = page.locator(`.kf-fs-thing[data-thing="${await page.evaluate(() => window.__t.pig)}"]`);
  await pig.locator('.kf-tc-clip[data-kind="name"] [data-action="record"]').click();
  await page.locator('kf-recorder [data-stub="take"]').click();
  await status.filter({ hasText: "Everything for this scene is recorded in English ✓" }).waitFor();
  assert.equal(await q1.textContent(), "Your recording");
  const clips = await page.evaluate(() => window.__t.store.snapshot.clips.map((c) => [c.kind, c.take, c.thingId === null]).sort());
  assert.deepEqual(clips, [["find-question", 1, true], ["find-question", 2, true], ["name", 1, false], ["name", 1, false]]);
  await page.screenshot({ path: join(ROOT, "tests/browser/.shots/find-setup.png"), fullPage: true }).catch(() => {});

  await page.getByRole("button", { name: "Done" }).click();
  assert.equal(await page.evaluate(() => window.__closed), 1);
  assert.deepEqual(page.errors, []);
});

test("find game setup: recording the last animal's name keeps the place on screen", async () => {
  const page = await setupPage("animal");
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(async () => {
    const { store } = window.__t;
    const sq = (cx, cy) => [[cx - 0.04, cy], [cx + 0.04, cy], [cx + 0.04, cy + 0.1], [cx - 0.04, cy + 0.1]];
    for (let i = 0; i < 5; i++) await store.addThing({ placeId: store.currentPlace.id, names: { en: `Thing ${i}` }, outline: sq(0.1 + i * 0.15, 0.2), color: "blue" });
  });
  const last = page.locator(".kf-fs-thing").last();
  await last.locator('[data-action="record"]').scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => document.querySelector(".kf-fs").scrollTop);
  assert.ok(before > 200, `the sheet scrolled down (${before})`);
  await last.locator('[data-action="record"]').click();
  await page.locator("kf-recorder").waitFor({ timeout: 2000 });
  const after = await page.evaluate(() => document.querySelector(".kf-fs").scrollTop);
  assert.ok(Math.abs(after - before) < 80, `the sheet stays where it was (${before} → ${after})`);
  assert.equal(await page.locator(".kf-fs-thing").last().locator("kf-recorder").count(), 1, "the recorder opens on the animal that was tapped");
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction(() => window.__t.store.snapshot.clips.length === 1);
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
  // The recorded question plays only with a recorded colour word (play/ask.js planColorAsk): the slot
  // never says "Your recording" while Klara still hears the iPad voice.
  const q1 = page.locator('.kf-tc-clip[data-kind="color-question"][data-take="1"] .kf-tc-voice');
  assert.equal(await q1.getAttribute("data-voice"), "voice");
  assert.equal(await q1.textContent(), "Built-in voice until a colour word is recorded");

  // Tap the hen: its colour (yellow) opens; record the word.
  await page.locator(`.kf-fs-pick-thing[data-thing="${await page.evaluate(() => window.__t.hen)}"]`).click();
  assert.equal(await page.locator('.kf-fs-swatch[data-group="yellow"]').getAttribute("aria-pressed"), "true");
  await page.locator('.kf-tc-clip[data-kind="color-word"][data-color="yellow"] [data-action="record"]').click();
  assert.equal(await page.locator("kf-recorder .stub-label").textContent(), "Say just the colour: “yellow”");
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction(() => window.__t.store.gameClips({ kind: "color-word", color: "yellow" }).length === 1);
  await status.filter({ hasText: "Still to record: pink." }).waitFor();
  assert.equal(await q1.getAttribute("data-voice"), "partial");
  assert.equal(await q1.textContent(), "Plays with each colour's word: 1 of 2 recorded (pink: built-in voice for now)");
  assert.equal(await page.locator('.kf-fs-swatch[data-group="yellow"]').getAttribute("aria-label"), "yellow, recorded");
  assert.equal(await page.locator('[role="tab"][data-lang="en"]').textContent(), "English · 1 to record");

  // A swatch works too: pink, then everything is recorded.
  await page.locator('.kf-fs-swatch[data-group="pink"]').click();
  await page.locator('.kf-tc-clip[data-kind="color-word"][data-color="pink"] [data-action="record"]').click();
  await page.locator('kf-recorder [data-stub="take"]').click();
  await status.filter({ hasText: "Everything for this scene is recorded in English ✓" }).waitFor();
  assert.equal(await q1.textContent(), "Your recording");
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
  // The onboarding tour follows the welcome card; these tests are about other things.
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page.locator("kf-tour").waitFor({ state: "detached" });
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

test("journey: long-press 🔍 → adult check → record the question and a name with the mic, an animal round plays them; long-press colours → record question and word → a colour round plays them", async () => {
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
  await recordWithMic(page.locator('.kf-tc-clip[data-kind="find-question"][data-take="1"]'));
  const first = page.locator(".kf-fs-thing").first();
  const firstId = await first.getAttribute("data-thing");
  await recordWithMic(first.locator('.kf-tc-clip[data-kind="name"]'));
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.locator("kf-find-setup").waitFor({ state: "detached" });
  // Done on the setup goes straight back to the child's game, not to edit mode.
  assert.equal(await page.evaluate(() => window.__kf.session.state.mode), "play");
  assert.equal(await page.locator("kf-edit-layer").count(), 0);

  // An animal round on that animal plays the recorded question, then its recorded name.
  const asked = await page.evaluate((id) => ({
    q: window.__kf.store.gameClips({ kind: "find-question" })[0].id,
    n: window.__kf.store.clipsFor(id, { kind: "name" })[0].id,
  }), firstId);
  await listen(page);
  const animalButton = page.getByRole("button", { name: "Find the animal" });
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => { window.__heard = []; window.__kf.engine.stopFind(); });
    await animalButton.click();
    if ((await page.evaluate(() => window.__kf.engine.asking)) === firstId) break;
  }
  assert.equal(await page.evaluate(() => window.__kf.engine.asking), firstId);
  await page.waitForFunction((n) => window.__heard.some((x) => x[1] === n), asked.n, { timeout: 5000 });
  assert.deepEqual((await page.evaluate(() => window.__heard.map((x) => x[1]))).slice(0, 2), [asked.q, asked.n], "the question, then the name, and no device voice");
  await page.evaluate(() => window.__kf.engine.stopFind());

  // Within the grace window the next hold opens its setup without asking the check again.
  await holdButton("Find a colour");
  await page.locator("kf-find-setup").getByRole("heading", { name: "Colour game" }).waitFor();
  await recordWithMic(page.locator('.kf-tc-clip[data-kind="color-question"][data-take="1"]'));
  await page.locator(".kf-fs-pick-thing").first().click();
  const color = await page.locator(".kf-fs-pick-thing").first().getAttribute("data-color");
  await recordWithMic(page.locator(`.kf-tc-clip[data-kind="color-word"][data-color="${color}"]`));
  await page.screenshot({ path: join(ROOT, "tests/browser/.shots/colour-setup-app.png") }).catch(() => {});
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.locator("kf-find-setup").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__kf.session.state.mode), "play");

  // A colour round on that colour plays the recorded question, then the recorded word.
  const clips = await page.evaluate((color) => ({
    q: window.__kf.store.gameClips({ kind: "color-question" })[0].id,
    w: window.__kf.store.gameClips({ kind: "color-word", color })[0].id,
  }), color);
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
