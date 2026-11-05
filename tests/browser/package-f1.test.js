// Package F1: <kf-guided-add> and <kf-thing-card>, tested on a modulePage with a real FarmStore over
// MemoryRepo and stubbed draw pad, recorder, audio, engine and shell (tests/browser/stubs/f1-stubs.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const STUBS = join(ROOT, "tests/browser/stubs/f1-stubs.js");
let h;

before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

/** A modulePage with stubs, a store with one place (+ `things`), and services on window.__t. */
async function farmPage({ things = 0, languages = ["en"], withClip = false } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.addScriptTag({ path: STUBS, type: "module" });
  await page.waitForFunction(() => window.__f1);
  await page.evaluate(async ({ things, languages, withClip }) => {
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
    const placeId = store.currentPlace.id;
    const sq = (cx) => [[cx - 0.08, 0.5], [cx + 0.08, 0.5], [cx + 0.08, 0.7], [cx - 0.08, 0.7]];
    for (let i = 0; i < things; i++) {
      const sha = String(i + 1).padStart(64, "a");
      const clips = withClip ? [{ language: "en", kind: "name", take: 1, blobSha256: sha, mime: "audio/mp4", durationMs: 600, trimStartMs: 0, trimEndMs: 600, gainDb: 0 }] : [];
      if (withClip) await store.putBlob({ sha256: sha, mime: "audio/mp4", size: 1, createdAt: env.now(), bytes: new Uint8Array([9]).buffer });
      await store.addThing({ placeId, names: { en: i ? `Thing ${i}` : "Pig" }, outline: sq(0.2 + i * 0.2), color: "red", eyes: [{ x: 0.2 + i * 0.2, y: 0.58 }], clips });
    }
    const load = async (l) => [l, await (await fetch(`data/scripts/${l}.json`)).json()];
    const scripts = Object.fromEntries(await Promise.all(["en", "de", "sv"].map(load)));
    window.__t = { store, repo, placeId, services: window.__f1.makeServices({ store, scripts }) };
  }, { things, languages, withClip });
  return page;
}

/** Mounts a panel like the Shell does and counts kf-close. */
async function mount(page, tag, params = {}) {
  await page.evaluate(async ({ tag, params }) => {
    await import(`./js/components/${tag}/define.js`);
    const el = document.createElement(tag);
    el.services = window.__t.services;
    el.params = params;
    window.__closed = (window.__closed ?? 0);
    el.addEventListener("kf-close", () => { window.__closed++; el.remove(); });
    document.getElementById("parent-layer").append(el);
    await el.ready;
    window.__el = el;
  }, { tag, params });
}

const closedCount = (page) => page.evaluate(() => window.__closed);
const step = (page) => page.evaluate(() => window.__el.dataset.step);
const circle = (cx, cy, r, n = 32) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * 0.8 * Math.sin((i / n) * 2 * Math.PI)]);

async function draw(page, points = circle(0.4, 0.4, 0.3)) {
  await page.evaluate((pts) => document.querySelector("kf-draw-pad").emitStroke(pts), points);
}

async function tapBoard(page, x, y) {
  const [cx, cy] = await page.evaluate(([x, y]) => window.__el.toClient(x, y), [x, y]);
  await page.mouse.click(cx, cy);
}

async function holdStrip(page, ms = 1150) {
  const box = await page.locator('[data-action="eyes-done"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function thingOutlineInfo(page) {
  return page.evaluate(async () => {
    const g = await import("./js/components/kf-guided-add/shape.js");
    const t = window.__el.thing;
    const b = g.bbox(t.outline);
    const [cx, cy] = g.centroid(t.outline);
    return { b, cx, cy };
  });
}

const eyesInside = (page, eyes) =>
  page.evaluate(async (eyes) => {
    const g = await import("./js/components/kf-guided-add/shape.js");
    const t = window.__el.thing ?? window.__t.store.snapshot.things.at(-1);
    return eyes.map((e) => g.pointInPolygon([e.x, e.y], t.outline));
  }, eyes);

test("add a thing end to end: draw, felt, eyes, legs, moves, name, one question, skip sound", async () => {
  const page = await farmPage({ things: 1 });
  await mount(page, "kf-guided-add");
  assert.equal(await step(page), "draw");
  const next = page.getByRole("button", { name: "Next" });
  assert.equal(await next.isDisabled(), true);

  // Draw: a too-open stroke warns, a closed one is fitted to thing size at a free spot.
  await page.evaluate(() => document.querySelector("kf-draw-pad").emitOpen());
  await page.getByText("Close the outline").waitFor();
  await draw(page);
  assert.equal(await next.isDisabled(), false);
  const { b } = await thingOutlineInfo(page);
  assert.ok(b.w <= 0.2401 && b.h <= 0.3201, `fitted to thing size: ${JSON.stringify(b)}`);
  assert.ok(Math.abs(b.x + b.w / 2 - 0.2) > 0.1, "placed away from the existing thing");
  await next.click();

  // Felt
  assert.equal(await step(page), "felt");
  assert.equal(await page.locator('.kf-swatch[aria-pressed="true"]').getAttribute("data-color"), "tan", "the felt the drawing showed");
  assert.equal(await next.isDisabled(), false);
  await page.locator('.kf-swatch[data-color="pink"]').click();
  assert.equal(await page.locator('.kf-swatch[data-color="pink"]').getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Next" }).click();

  // Eyes: the panel first (playtest 3: no dead end), with Back and ✕; then Klara's full-screen stamping,
  // no buttons but the grown-up's Done and Cancel; snapping; third tap moves the oldest.
  assert.equal(await step(page), "eyes");
  assert.equal(await page.locator('[data-testid="eye-stamping"]').count(), 0, "stamping waits for the parent");
  await page.getByRole("button", { name: "‹ Back" }).waitFor();
  await page.getByRole("button", { name: "Let Klara stamp" }).click();
  await page.locator('[data-testid="eye-stamping"]').waitFor();
  assert.equal(await page.locator(".kf-eyes button").count(), 2, "only the grown-up's Done and Cancel");
  const o = await thingOutlineInfo(page);
  await tapBoard(page, o.cx - o.b.w * 0.15, o.cy - o.b.h * 0.1);
  await tapBoard(page, o.b.x + o.b.w + 0.06, o.cy); // outside, right
  let eyes = await page.evaluate(() => window.__el.thing.eyes);
  assert.equal(eyes.length, 2);
  assert.deepEqual(await eyesInside(page, eyes), [true, true], "outside tap snapped inside");
  assert.ok(eyes[1].x > o.cx, "snapped to the near (right) side");
  const second = eyes[1];
  await tapBoard(page, o.cx + o.b.w * 0.1, o.cy - o.b.h * 0.2);
  eyes = await page.evaluate(() => window.__el.thing.eyes);
  assert.equal(eyes.length, 2);
  assert.deepEqual(eyes[0], second, "third tap moved the oldest eye");
  assert.deepEqual(await page.evaluate(() => window.__f1.chimes.filter((c) => c === "tap").length), 3);
  // A short press on Done does nothing; a 1 s hold hands over to the parent.
  await holdStrip(page, 200);
  assert.equal(await page.locator('[data-testid="eye-stamping"]').count(), 1);
  await holdStrip(page);
  assert.equal(await page.locator('[data-testid="eye-stamping"]').count(), 0);
  await page.getByRole("button", { name: "Next" }).click();

  // Legs: pick the count first, then tap where each leg goes (snapped inside); drag a leg to move it.
  assert.equal(await step(page), "legs");
  await page.getByRole("heading", { name: "How many legs?" }).waitFor();
  assert.deepEqual(await page.locator(".kf-legs-count").allTextContents(), ["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(await page.getByRole("button", { name: "Next" }).count(), 0, "pick a number or Skip");
  await page.getByRole("button", { name: "Skip" }).waitFor();
  await page.getByRole("button", { name: "3 legs" }).click();
  await page.getByRole("heading", { name: "Tap where leg 1 of 3 goes" }).waitFor();
  const bottom = o.b.y + o.b.h;
  await tapBoard(page, o.cx - o.b.w * 0.25, bottom - 0.02);
  await page.getByRole("heading", { name: "Tap where leg 2 of 3 goes" }).waitFor();
  await tapBoard(page, o.cx, bottom + 0.05); // below the outline: snapped inside
  await tapBoard(page, o.cx + o.b.w * 0.25, bottom - 0.02);
  await page.getByRole("heading", { name: "3 legs" }).waitFor();
  let legs = await page.evaluate(() => window.__el.thing.legs);
  assert.equal(legs.length, 3);
  assert.deepEqual(await eyesInside(page, legs), [true, true, true], "legs snapped inside the outline");
  assert.ok(legs[1].y < bottom && legs[1].y > o.cy, "the tap below the shape lands near its bottom");
  // Drag leg 1 somewhere else; Undo puts it back; drag it again and keep it.
  const drag = async (from, to) => {
    const a = await page.evaluate(([x, y]) => window.__el.toClient(x, y), from);
    const b = await page.evaluate(([x, y]) => window.__el.toClient(x, y), to);
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move(b[0], b[1], { steps: 5 });
    await page.mouse.up();
  };
  await drag([legs[0].x, legs[0].y], [o.cx - o.b.w * 0.15, bottom - 0.03]);
  assert.notDeepEqual((await page.evaluate(() => window.__el.thing.legs))[0], legs[0]);
  await page.getByRole("button", { name: "Undo" }).click();
  assert.deepEqual((await page.evaluate(() => window.__el.thing.legs))[0], legs[0]);
  await drag([legs[0].x, legs[0].y], [o.cx - o.b.w * 0.2, bottom - 0.03]);
  await page.getByRole("heading", { name: "3 legs" }).waitFor();
  legs = await page.evaluate(() => window.__el.thing.legs);
  assert.equal(legs.length, 3);
  await page.waitForFunction((x) => window.__t.store.listDrafts().then((d) => d[0]?.thing.legs[0]?.x === x), legs[0].x);
  await page.getByRole("button", { name: "Next" }).click();

  // Moves
  assert.equal(await step(page), "moves");
  await page.locator('[data-motion="float"]').click();
  assert.equal(await page.locator(".kf-ga-canvas.float").count(), 1, "live preview floats");
  await page.getByRole("button", { name: "Next" }).click();

  // Name: typed name + name clip
  assert.equal(await step(page), "name");
  await page.locator('input[name="name"]').fill("Pig");
  assert.match(await page.locator('kf-recorder[data-kind="name"] .stub-label').textContent(), /“Pig”/);
  await page.locator('kf-recorder[data-kind="name"] [data-stub="take"]').click();
  await page.waitForFunction(async () => (await window.__t.store.listDrafts())[0]?.clips.length === 1);
  await page.getByRole("button", { name: "Next" }).click();

  // Ask: the three example questions, editable; record one, then go on
  assert.equal(await step(page), "ask");
  assert.equal(await page.locator('input[name="cue-1"]').inputValue(), "Where is the Pig?");
  assert.doesNotMatch(await page.locator(".kf-ga-panel").textContent(), /null|undefined/, "no stray optional parts");
  await page.getByRole("button", { name: "Record question 1" }).click();
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.getByRole("heading", { name: "Questions (1/3)" }).waitFor();
  await page.getByRole("button", { name: "Next" }).click();

  // Sound: skip → finish
  assert.equal(await step(page), "sound");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.waitForFunction(() => window.__closed === 1);

  const out = await page.evaluate(async () => {
    const { store, repo, placeId } = window.__t;
    const things = store.thingsIn(placeId);
    const t = things.at(-1);
    const clips = store.clipsFor(t.id);
    const blobs = await Promise.all(clips.map((c) => repo.getBlob(c.blobSha256)));
    return { count: things.length, t, clips, blobs: blobs.map(Boolean), drafts: (await store.listDrafts()).length, dropped: window.__f1.dropped, chimes: window.__f1.chimes };
  });
  assert.equal(out.count, 2);
  assert.deepEqual(out.t.names, { en: "Pig" });
  assert.equal(out.t.color, "pink");
  assert.equal(out.t.motion.preset, "float");
  assert.equal(out.t.eyes.length, 2);
  assert.deepEqual(await eyesInside(page, out.t.eyes), [true, true]);
  assert.deepEqual(out.t.legs, legs.map(({ x, y }) => ({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 })));
  assert.equal(out.t.legTarget, undefined, "the picked count is a draft detail, not part of the thing");
  assert.deepEqual(out.clips.map((c) => `${c.kind}${c.take}`).sort(), ["name1", "prompt1"]);
  assert.ok(out.clips.every((c) => c.thingId === out.t.id));
  assert.deepEqual(out.blobs, [true, true], "blobs stored");
  assert.equal(out.drafts, 0, "draft discarded");
  assert.deepEqual(out.dropped, [out.t.id], "engine.dropIn");
  assert.ok(out.chimes.includes("plink"));
  assert.deepEqual(page.errors, []);
});

test("✕ → Keep draft, reopen resumes at the same step with data intact", async () => {
  const page = await farmPage({ languages: ["en", "de"] });
  await mount(page, "kf-guided-add");
  await draw(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('.kf-swatch[data-color="blue"]').click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Let Klara stamp" }).click();
  const o = await thingOutlineInfo(page);
  await tapBoard(page, o.cx - 0.03, o.cy);
  await tapBoard(page, o.cx + 0.03, o.cy);
  await holdStrip(page);
  const before = await page.evaluate(() => structuredClone(window.__el.thing));
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Keep draft" }).click();
  await page.waitForFunction(() => window.__closed === 1);
  assert.equal(await page.evaluate(async () => (await window.__t.store.listDrafts()).length), 1);
  assert.equal(await page.evaluate(() => window.__t.store.thingsIn(window.__t.placeId).length), 0);

  await mount(page, "kf-guided-add");
  assert.equal(await step(page), "eyes");
  const after = await page.evaluate(() => window.__el.thing);
  assert.deepEqual(after.outline, before.outline);
  assert.equal(after.color, "blue");
  assert.deepEqual(after.eyes, before.eyes);
  assert.equal(after.eyes.length, 2);
  // Back keeps data too.
  await page.getByRole("button", { name: "‹ Back" }).click();
  assert.equal(await step(page), "felt");
  assert.equal(await page.locator('.kf-swatch[data-color="blue"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(page.errors, []);
});

test("✕ → Stop adding removes the draft; reopening starts fresh", async () => {
  const page = await farmPage();
  await mount(page, "kf-guided-add");
  await draw(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForFunction(async () => (await window.__t.store.listDrafts()).length === 1);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Stop adding" }).click();
  await page.waitForFunction(() => window.__closed === 1);
  assert.equal(await page.evaluate(async () => (await window.__t.store.listDrafts()).length), 0);
  await mount(page, "kf-guided-add");
  assert.equal(await step(page), "draw");
  assert.equal(await page.evaluate(() => window.__el.thing.outline), null);
});

test("+ Add is refused when the place already has as many things as Settings allows", async () => {
  const page = await farmPage({ things: 4 });
  await page.evaluate(() => window.__t.store.updateSettings({ patch: { maxThings: 4 } }));
  await mount(page, "kf-guided-add");
  assert.equal(await step(page), "full");
  await page.getByText("This scene is full").waitFor();
  await page.getByText("already has 4 things").waitFor();
  assert.equal(await page.locator("kf-draw-pad").count(), 0);
  await page.getByRole("button", { name: "OK" }).click();
  assert.equal(await closedCount(page), 1);
});

test("guided add records the article and edited question words in another language", async () => {
  const page = await farmPage({ languages: ["de", "en"] });
  await mount(page, "kf-guided-add");
  await page.evaluate(() => { const el = window.__el; el.draft.thing.outline = [[0.4, 0.5], [0.6, 0.5], [0.6, 0.7], [0.4, 0.7]]; el.draft.thing.color = "red"; el.draft.thing.motion = { kind: "preset", preset: "walk", params: {} }; el._go(5); });
  assert.equal(await step(page), "name");
  await page.locator('input[name="name"]').fill("Schwein");
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('select[name="article"]').selectOption("das");
  assert.equal(await page.locator('input[name="cue-1"]').inputValue(), "Wo ist das Schwein?");
  await page.locator('input[name="cue-1"]').fill("Wo ist denn das Schwein?");
  await page.locator('input[name="cue-1"]').press("Tab");
  assert.equal(await page.locator('input[name="cue-1"]').inputValue(), "Wo ist denn das Schwein?");
  assert.match(await page.locator('input[name="cue-2"]').inputValue(), /Kannst du das Schwein finden/);
  const cues = await page.evaluate(() => window.__el.thing.cues.de);
  assert.equal(cues.article, "das");
  assert.equal(cues.lines[0], "Wo ist denn das Schwein?");
});

test("thing card: rename, recolour, motion, + Language, re-record (cancel keeps, keep replaces), redraw, re-stamp, delete + Undo", async () => {
  const page = await farmPage({ things: 1, withClip: true });
  const thingId = await page.evaluate(() => window.__t.store.thingsIn(window.__t.placeId)[0].id);
  await mount(page, "kf-thing-card", { thingId });
  const thing = () => page.evaluate((id) => window.__t.store.snapshot.things.find((t) => t.id === id) ?? null, thingId);
  const clips = () => page.evaluate((id) => window.__t.store.clipsFor(id), thingId);

  // Rename
  await page.locator('input[name="name"]').fill("Piggy");
  await page.locator('input[name="name"]').blur();
  await page.waitForFunction((id) => window.__t.store.snapshot.things.find((t) => t.id === id).names.en === "Piggy", thingId);
  await page.locator("#kf-tc-title", { hasText: "Piggy" }).waitFor();

  // Recolour and motion save immediately
  await page.locator('.kf-swatch[data-color="blue"]').click();
  await page.waitForFunction((id) => window.__t.store.snapshot.things.find((t) => t.id === id).color === "blue", thingId);
  await page.locator('.kf-tc-motion[data-motion="float"]').click();
  await page.waitForFunction((id) => window.__t.store.snapshot.things.find((t) => t.id === id).motion.preset === "float", thingId);
  assert.equal(await page.locator('.kf-tc-motion[data-motion="float"]').getAttribute("aria-pressed"), "true");

  // Play the name clip
  await page.locator('.kf-tc-clip[data-kind="name"] [data-action="play"]').click();
  assert.equal((await page.evaluate(() => window.__f1.played)).length, 1);

  // Re-record: cancel keeps the old clip, a finished take replaces it
  const old = (await clips())[0];
  await page.locator('.kf-tc-clip[data-kind="name"] [data-action="record"]').click();
  assert.equal(await page.evaluate(() => window.__f1.recorded.length), 0);
  assert.equal(await page.locator('.kf-tc-clip[data-kind="name"] kf-recorder').count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector("kf-recorder").existing?.id), old.id, "recorder gets the existing clip");
  await page.locator('[data-action="cancel-record"]').click();
  assert.equal(await page.locator("kf-recorder").count(), 0);
  assert.deepEqual(await clips(), [old]);
  await page.locator('.kf-tc-clip[data-kind="name"] [data-action="record"]').click();
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.waitForFunction((id) => window.__t.store.clipsFor(id)[0]?.blobSha256.startsWith("0"), thingId);
  const now = await clips();
  assert.equal(now.length, 1);
  assert.notEqual(now[0].blobSha256, old.blobSha256);
  assert.ok(await page.evaluate((sha) => window.__t.repo.getBlob(sha).then(Boolean), now[0].blobSha256), "new blob stored");

  // A question clip can be recorded from the card too
  await page.locator('.kf-tc-clip[data-kind="prompt"][data-take="2"] [data-action="record"]').click();
  await page.locator('kf-recorder [data-stub="take"]').click();
  await page.getByRole("heading", { name: "Questions (1/3)" }).waitFor();

  // Decode failures are flagged "re-record"
  await page.evaluate((id) => window.__t.services.audio.dispatchEvent(new CustomEvent("decode-failed", { detail: { clipId: id } })), now[0].id);
  await page.getByText("Won't play: re-record").waitFor();

  // + Language adds a tab and the language to settings
  await page.locator('[data-action="add-language"]').click();
  await page.locator('select[name="language"]').selectOption("de");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator('[role="tab"][data-lang="de"][aria-selected="true"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__t.store.settings.languages), ["en", "de"]);
  assert.equal(await page.locator('input[name="name"]').inputValue(), "");
  await page.locator('input[name="name"]').fill("Schwein");
  await page.locator('input[name="name"]').blur();
  await page.locator('select[name="article"]').selectOption("das");
  await page.waitForFunction((id) => window.__t.store.snapshot.things.find((t) => t.id === id).cues.de?.article === "das", thingId);
  assert.equal(await page.locator('input[name="cue-1"]').inputValue(), "Wo ist das Schwein?");
  assert.equal((await thing()).names.de, "Schwein");
  await page.locator('[role="tab"][data-lang="en"]').click();
  assert.equal(await page.locator('input[name="name"]').inputValue(), "Piggy");

  // Place legs: Cancel keeps the old legs; pick 4, tap each, Done saves them.
  assert.deepEqual((await thing()).legs, []);
  await page.locator('[data-action="legs"]').click();
  await page.locator('[data-testid="leg-placing"]').waitFor();
  await page.getByRole("button", { name: "2 legs" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  assert.equal(await page.locator(".kf-tc-overlay").count(), 0);
  assert.deepEqual((await thing()).legs, []);
  await page.locator('[data-action="legs"]').click();
  await page.getByRole("button", { name: "4 legs" }).click();
  for (const x of [0.13, 0.17, 0.23, 0.27]) await tapBoard(page, x, 0.69);
  await page.getByRole("heading", { name: "4 legs" }).waitFor();
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction((id) => window.__t.store.snapshot.things.find((t) => t.id === id).legs.length === 4, thingId);
  await page.waitForFunction(() => !document.querySelector(".kf-tc-overlay"));
  assert.deepEqual(await eyesInside(page, (await thing()).legs), [true, true, true, true]);

  // Redraw keeps eyes and legs (re-snapped inside) and clips
  const clipCount = (await clips()).length;
  await page.locator('[data-action="redraw"]').click();
  await page.locator(".kf-tc-shapes").getByText("1 shape").waitFor(); // starts from the current outline
  await page.locator('[data-action="start-over"]').click();
  await draw(page, circle(0.5, 0.5, 0.4));
  await page.locator('[data-action="redraw-done"]').click();
  await page.waitForFunction(() => !document.querySelector(".kf-tc-overlay"));
  const redrawn = await thing();
  assert.notDeepEqual(redrawn.outline, [[0.12, 0.5], [0.28, 0.5], [0.28, 0.7], [0.12, 0.7]]);
  assert.equal(redrawn.eyes.length, 1);
  assert.deepEqual(await eyesInside(page, redrawn.eyes), [true]);
  assert.equal(redrawn.legs.length, 4);
  assert.deepEqual(await eyesInside(page, redrawn.legs), [true, true, true, true]);
  assert.equal((await clips()).length, clipCount);

  // Re-stamp eyes
  await page.locator('[data-action="restamp"]').click();
  await page.locator('[data-testid="eye-stamping"]').waitFor();
  const g = await page.evaluate(async (id) => {
    const s = await import("./js/components/kf-guided-add/shape.js");
    const t = window.__t.store.snapshot.things.find((x) => x.id === id);
    return s.centroid(t.outline);
  }, thingId);
  await tapBoard(page, g[0] - 0.02, g[1]);
  await tapBoard(page, g[0] + 0.02, g[1]);
  await holdStrip(page);
  await page.waitForFunction((id) => window.__t.store.snapshot.things.find((t) => t.id === id).eyes.length === 2, thingId);

  // Delete: refusing keeps it; confirming deletes, names the recordings, and Undo restores it
  await page.evaluate(() => { window.__f1.confirmAnswer = false; });
  await page.locator('[data-action="delete"]').click();
  await page.waitForFunction(() => window.__f1.confirms.length === 1);
  assert.ok(await thing());
  await page.evaluate(() => { window.__f1.confirmAnswer = true; });
  await page.locator('[data-action="delete"]').click();
  await page.waitForFunction(() => window.__closed === 1);
  const confirm = await page.evaluate(() => window.__f1.confirms[1]);
  assert.match(confirm.body, /2 recordings/);
  assert.equal(confirm.danger, true);
  assert.equal(await thing(), null);
  assert.equal((await clips()).length, 0);
  assert.ok(await page.evaluate(() => window.__f1.chimes.includes("poof")));
  await page.evaluate(() => window.__f1.toasts[0].undo());
  await page.waitForFunction((id) => !!window.__t.store.snapshot.things.find((t) => t.id === id), thingId);
  assert.equal((await clips()).length, 2);
  assert.equal((await thing()).names.en, "Piggy");
  assert.deepEqual(page.errors, []);
});
