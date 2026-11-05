// Integration: the whole app booted from the real Python server, driven like a parent and a child.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup({ fakeMedia: true }); });
after(() => h.teardown());

const kf = (page, fn, arg) => page.evaluate(fn, arg);

async function dismissWelcome(page) {
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
  // The onboarding tour follows the welcome card; these tests are about other things.
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page.locator("kf-tour").waitFor({ state: "detached" });
}

async function boardPoint(page, x, y) {
  return kf(page, ([x, y]) => window.__kf.board.toClient(x, y), [x, y]).then((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
}

async function hold(page, x, y, ms = 1700) {
  const p = await boardPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function enterEdit(page) {
  await hold(page, 0.5, 0.2);
  await page.locator("kf-adult-check").waitFor();
  const text = await page.locator("kf-adult-check").textContent();
  const digits = text.match(/Tap\s+(\d)\s+(\d)\s+(\d)/).slice(1);
  for (const d of digits) await page.locator("kf-adult-check").getByRole("button", { name: d, exact: true }).click();
  await page.locator("kf-edit-layer").waitFor();
}

async function drag(page, points) {
  const first = await boardPoint(page, ...points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const pt of points.slice(1)) {
    const p = await boardPoint(page, ...pt);
    await page.mouse.move(p.x, p.y, { steps: 2 });
  }
  await page.mouse.up();
}

const circle = (cx, cy, r, n = 40) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * 0.75 * Math.sin((i / n) * 2 * Math.PI)]);

test("first run: starter farm, welcome once, a child view without text or buttons, and an idle board", async () => {
  const page = await h.newPage();
  await dismissWelcome(page);
  const s = await kf(page, () => ({
    places: window.__kf.store.snapshot.places.map((p) => p.name),
    things: window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).length,
  }));
  assert.deepEqual(s.places.sort(), ["Farm", "Kitchen", "Sea"]);
  assert.ok(s.things >= 2 && s.things <= 7);

  // US-5.2: the child sees no text and no buttons (the VoiceOver "Edit" button is visually hidden),
  // except the two icon-only find game buttons (playtest round 2), each at least 88 px.
  const visible = await kf(page, () => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden"; };
    const texts = [...document.body.querySelectorAll("*")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && isVisible(el) && !el.closest("noscript, kf-find-buttons"));
    const buttons = [...document.querySelectorAll("button, a, input")].filter(isVisible);
    const find = buttons.filter((b) => b.closest("kf-find-buttons"));
    return {
      texts: texts.map((e) => e.textContent.trim()),
      buttons: buttons.length - find.length,
      find: find.map((b) => b.getAttribute("aria-label")),
      small: find.filter((b) => b.getBoundingClientRect().width < 88 || b.getBoundingClientRect().height < 88).length,
    };
  });
  assert.deepEqual(visible, { texts: [], buttons: 0, find: ["Find the animal", "Find a colour"], small: 0 });

  // Welcome shows only once.
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("kf-welcome").count(), 0);

  // An idle board stops requesting frames (ARCHITECTURE §7): count rAF calls over a quiet stretch.
  await kf(page, () => { window.__kf.engine.setMode("edit"); window.__kf.engine.setMode("play"); });
  const frames = await kf(page, async () => {
    const r = window.__kf.board.renderer;
    await new Promise((ok) => setTimeout(ok, 2500)); // the edit wiggle settles; walkers may rest
    const start = r.frames;
    await new Promise((ok) => setTimeout(ok, 500));
    return { running: r.running, idle: window.__kf.engine.isIdle(), delta: r.frames - start };
  });
  if (frames.idle) assert.equal(frames.delta, 0, "no frames while idle");
  assert.deepEqual(page.errors, []);
});

test("a tap makes a thing react; hold, adult check, edit mode and Done", async () => {
  const page = await h.newPage();
  await dismissWelcome(page);
  const target = await kf(page, () => {
    const a = window.__kf.engine.actors[0];
    return { id: a.thingId, x: a.x, y: a.y };
  });
  const reacted = kf(page, () => new Promise((ok) => window.__kf.engine.addEventListener("reaction", (e) => ok(e.detail.thingId), { once: true })));
  const p = await boardPoint(page, target.x, target.y);
  await page.mouse.click(p.x, p.y);
  assert.equal(await reacted, target.id);

  await enterEdit(page);
  assert.equal(await kf(page, () => window.__kf.session.state.mode), "edit");
  for (const name of ["Scenes", "Change scene", "Settings", "Done"]) assert.equal(await page.getByRole("button", { name, exact: true }).count(), 1, name);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator("kf-edit-layer").waitFor({ state: "detached" });
  assert.equal(await kf(page, () => window.__kf.session.state.mode), "play");
  assert.deepEqual(page.errors, []);
});

test("find games: the 🔍 button asks for an animal, tapping it celebrates; hidden in edit mode", async () => {
  const page = await h.newPage();
  await dismissWelcome(page);
  const animal = page.getByRole("button", { name: "Find the animal" });
  await animal.waitFor();
  const asked = kf(page, () => new Promise((ok) => window.__kf.engine.addEventListener("ask", (e) => ok(e.detail), { once: true })));
  await animal.click();
  const ask = await asked;
  assert.equal(ask.kind, "animal");
  assert.equal(await animal.getAttribute("aria-pressed"), "true", "the button shows the round is on");

  // Wait for the question to settle, then the child taps the right thing.
  const target = await kf(page, (id) => { const a = window.__kf.engine.actorFor(id); return { x: a.x, y: a.y }; }, ask.thingId);
  const answered = kf(page, () => new Promise((ok) => window.__kf.engine.addEventListener("answer", (e) => ok(e.detail), { once: true })));
  const p = await boardPoint(page, target.x, target.y);
  await page.mouse.click(p.x, p.y);
  assert.deepEqual(await answered, { thingId: ask.thingId, outcome: "correct" });
  assert.equal(await animal.getAttribute("aria-pressed"), "false");
  assert.equal(await kf(page, () => window.__kf.engine.findRound), null);

  // The colour button starts a colour round, then edit mode hides both buttons and ends it.
  await page.getByRole("button", { name: "Find a colour" }).click();
  assert.equal(await kf(page, () => window.__kf.engine.findRound?.kind), "color");
  await enterEdit(page);
  assert.equal(await page.locator("kf-find-buttons").isHidden(), true);
  assert.equal(await kf(page, () => window.__kf.engine.findRound), null);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await animal.waitFor();
  assert.deepEqual(page.errors, []);
});

test("a parent adds a thing with a recorded name, and it survives a reload", async () => {
  const page = await h.newPage();
  await dismissWelcome(page);
  // The Farm starts with 3 things; a scene holds 8 by default.
  const before = await kf(page, () => window.__kf.store.thingsIn(window.__kf.store.currentPlace.id).length);
  await enterEdit(page);
  await page.locator('[data-action="add"]').click();
  await page.locator('kf-library [data-action="draw-new"]').click();
  await page.locator("kf-guided-add").waitFor();
  await page.locator("kf-draw-pad").waitFor();
  await drag(page, circle(0.5, 0.55, 0.15));
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('.kf-swatch[data-color="blue"]').click();
  await page.getByRole("button", { name: "Next" }).click();
  // Eyes: Klara taps twice, then the grown-up holds the strip to take over.
  await page.locator('[data-testid="eye-stamping"]').waitFor();
  const e1 = await page.locator('[data-testid="eye-stamping"]').boundingBox();
  await page.mouse.click(e1.x + e1.width * 0.45, e1.y + e1.height * 0.5);
  await page.mouse.click(e1.x + e1.width * 0.55, e1.y + e1.height * 0.5);
  const strip = await page.locator('[data-action="eyes-done"]').boundingBox();
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip" }).click(); // legs (tests/browser/legs.test.js places them)
  await page.locator('[data-motion="walk"]').click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('input[name="name"]').fill("Bird");
  // Record the name with Chromium's fake microphone.
  const rec = page.locator('kf-recorder[data-kind="name"]');
  await rec.getByRole("button", { name: /^Record/ }).click();
  await page.waitForTimeout(1500);
  await rec.getByRole("button", { name: "Stop" }).click().catch(() => {});
  // Every good take is kept: no Keep tap, the recorder just says Saved.
  await rec.locator(".kf-rec-saved").waitFor({ timeout: 10000 });
  assert.equal(await rec.getByRole("button", { name: "Keep" }).count(), 0);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.locator("kf-guided-add").waitFor({ state: "detached" });

  const after = await kf(page, () => {
    const s = window.__kf.store;
    const t = s.thingsIn(s.currentPlace.id).at(-1);
    return { count: s.thingsIn(s.currentPlace.id).length, name: t.names.en, color: t.color, clips: s.clipsFor(t.id).map((c) => c.kind) };
  });
  assert.deepEqual(after, { count: before + 1, name: "Bird", color: "blue", clips: ["name"] });
  // A scene holds 8 by default (meeting 2); the starter leaves room for exactly one own thing.
  assert.equal(after.count, 8);
  await page.waitForFunction(() => document.querySelector('[data-action="add"]').classList.contains("full"));
  assert.equal((await page.locator('[data-testid="add-count"]').innerText()).trim(), "8/8", "the eighth thing fills the scene");

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const persisted = await kf(page, async () => {
    const s = window.__kf.store;
    const t = s.thingsIn(s.currentPlace.id).at(-1);
    const clip = s.clipsFor(t.id)[0];
    return { name: t.names.en, blob: (await s.getBlob(clip.blobSha256))?.size > 0 };
  });
  assert.deepEqual(persisted, { name: "Bird", blob: true });
  assert.deepEqual(page.errors, []);
});

test("export, delete all data, import: everything comes back", async () => {
  const page = await h.newPage();
  await dismissWelcome(page);
  const result = await kf(page, async () => {
    const { store, share, storage } = window.__kf;
    await store.renamePlace({ placeId: store.currentPlace.id, name: "Klara's farm" });
    const { bytes, counts } = await share.buildExport(store);
    await storage.deleteAllData();
    return { bytes: Array.from(new Uint8Array(bytes)), counts };
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const names = await kf(page, async (bytes) => {
    const { store, share } = window.__kf;
    const fresh = store.snapshot.places.map((p) => p.name).sort();
    await share.importReplacing(store, new Uint8Array(bytes).buffer);
    return { fresh, imported: store.snapshot.places.map((p) => p.name).sort() };
  }, result.bytes);
  assert.deepEqual(names.fresh, ["Farm", "Kitchen", "Sea"], "delete all data starts over with the starter places");
  assert.ok(names.imported.includes("Klara's farm"));
  assert.deepEqual(page.errors, []);
});

test("works offline once installed", async () => {
  const page = await h.newPage();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.context().setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 });
  assert.ok(await kf(page, () => window.__kf.store.snapshot.places.length === 3));
  await page.context().setOffline(false);
});
