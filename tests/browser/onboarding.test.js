// Encouraging the grown-up (playtest round 3): the recording tip beside a find button, the onboarding
// tour (each mounted alone with fake services), and first-run journeys through the real app:
// welcome, then the tour to the end; welcome, then Skip tour; Settings, "Show the tour again".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const SHOTS = join(ROOT, "tests/browser/.shots");
let h;

before(async () => { h = await setup({ fakeMedia: true }); });
after(async () => { await h?.teardown(); });

const box = (locator) => locator.boundingBox();
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// ---------------------------------------------------------------- <kf-find-buttons>: the recording tip

test("recording tip: an unrecorded question shows it beside that game's button, never blocks a tap, and fades", async () => {
  const page = await h.modulePage('<div id="stage"></div><div id="parent-layer"></div>');
  await page.evaluate(async () => {
    await import("./js/components/kf-find-buttons/define.js");
    window.__log = [];
    const engine = new EventTarget();
    Object.assign(engine, { mode: "play", findAvailable: true, findRound: null, startFind: (k) => window.__log.push(k) });
    const session = new EventTarget();
    session.state = { mode: "play", panel: null };
    session.holdStart = () => {};
    const prefs = new EventTarget();
    prefs._on = true;
    Object.defineProperty(prefs, "recordingTips", { get() { return this._on; }, set(v) { this._on = v; this.dispatchEvent(new Event("change")); } });
    const el = document.createElement("kf-find-buttons");
    el.services = { engine, session, audio: { unlock() {} }, prefs };
    document.getElementById("stage").append(el);
    window.__t = { engine, session, prefs, el };
    window.__ask = (kind, recorded) => engine.dispatchEvent(new CustomEvent("ask", { detail: { kind, recorded, repeat: false } }));
  });
  const hint = page.locator(".kf-find-hint");
  const animal = page.getByRole("button", { name: "Find the animal" });

  // A recorded question: no tip.
  await page.evaluate(() => window.__ask("animal", true));
  assert.equal(await hint.isVisible(), false);

  // The iPad's voice asks: the tip shows beside the 🔍 button, with the real hold time.
  await page.evaluate(() => window.__ask("animal", false));
  await page.waitForTimeout(500); // fully faded in
  assert.equal(await hint.isVisible(), true);
  assert.equal((await hint.textContent()).trim(), "🎤Hold 1 s to record your own question");
  assert.equal(await hint.getAttribute("data-kind"), "animal");
  const [hb, ab] = [await box(hint), await box(animal)];
  assert.ok(hb.x > ab.x + ab.width && hb.x - (ab.x + ab.width) < 40, "right beside the button");
  assert.ok(hb.y < ab.y + ab.height && hb.y + hb.height > ab.y, "level with it");
  assert.equal(await hint.evaluate((e) => getComputedStyle(e).pointerEvents), "none");
  await page.screenshot({ path: join(SHOTS, "recording-tip.png") }).catch(() => {});

  // It never blocks the child: the button still starts a game, and a touch on the tip reaches what is under it.
  await animal.tap();
  assert.deepEqual(await page.evaluate(() => window.__log), ["animal"]);
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest(".kf-find-hint") ?? null, [hb.x + hb.width / 2, hb.y + hb.height / 2]);
  assert.equal(under, null);

  // Asked again at once: no new tip (cooldown); the same bubble keeps fading.
  const key = await hint.getAttribute("data-key");
  await page.evaluate(() => window.__ask("animal", false));
  assert.equal(await hint.getAttribute("data-key"), key);

  // It fades away by itself.
  await page.waitForFunction(() => document.querySelector(".kf-find-hint").hidden, null, { timeout: 8000 });
  await page.evaluate(() => window.__ask("animal", false));
  assert.equal(await hint.isVisible(), false, "not again within a few minutes");

  // The colour game has its own tip, on the other side.
  await page.evaluate(() => window.__ask("color", false));
  assert.equal(await hint.getAttribute("data-kind"), "color");
  const cb = await box(page.getByRole("button", { name: "Find a colour" }));
  const hc = await box(hint);
  assert.ok(hc.x + hc.width < cb.x, "left of the colour button");

  // Switching tips off in Settings hides it at once, and none comes back.
  await page.evaluate(() => { window.__t.prefs.recordingTips = false; });
  assert.equal(await hint.isVisible(), false);
  await page.evaluate(() => { window.__t.el._hint.shownAt = {}; window.__ask("color", false); });
  assert.equal(await hint.isVisible(), false);

  // Leaving play hides a tip that is up.
  await page.evaluate(() => { window.__t.prefs.recordingTips = true; window.__ask("color", false); });
  assert.equal(await hint.isVisible(), true);
  await page.evaluate(() => { window.__t.session.state = { mode: "gate", panel: null }; window.__t.session.dispatchEvent(new Event("change")); });
  assert.equal(await hint.evaluate((e) => e.hidden), true);
  assert.deepEqual(page.errors, []);
});

// ---------------------------------------------------------------- <kf-tour> alone

async function mountTour(page, { mode = "play" } = {}) {
  await page.evaluate(async (mode) => {
    await import("./js/components/kf-tour/define.js");
    const session = new EventTarget();
    session.state = { mode, panel: null };
    session.holdMs = 1500;
    session.activity = () => {};
    const store = new EventTarget();
    store.currentPlace = { id: "p" };
    store.thingsIn = () => [{ id: "cow" }, { id: "hen" }];
    const board = { actorRect: (id) => (id === "cow" ? new DOMRect(500, 520, 160, 120) : new DOMRect(60, 60, 80, 80)) };
    if (mode === "edit") {
      const layer = document.createElement("kf-edit-layer");
      layer.innerHTML = '<button class="kf-badge pencil" style="position:fixed;left:540px;top:490px;width:52px;height:52px">✎</button><nav style="position:fixed;bottom:16px;left:400px"><button data-action="scenes" style="width:120px;height:44px">Scenes</button></nav>';
      document.body.append(layer);
    }
    window.__closed = 0;
    const el = document.createElement("kf-tour");
    el.services = { session, store, board };
    el.addEventListener("kf-close", () => { window.__closed++; el.remove(); });
    document.getElementById("parent-layer").append(el);
    window.__t = { session, el };
  }, mode);
}

const step = (page) => page.evaluate(() => window.__t.el.step);
const ringBox = (page) => box(page.locator(".kf-tour-ring"));

test("recording tip: a timer that fires a moment before the clock reaches its end still hides the tip", async () => {
  const page = await h.modulePage('<div id="stage"></div><div id="parent-layer"></div>');
  await page.evaluate(async () => {
    await import("./js/components/kf-find-buttons/define.js");
    const engine = new EventTarget();
    Object.assign(engine, { mode: "play", findAvailable: true, findRound: null, startFind: () => {} });
    const session = new EventTarget();
    session.state = { mode: "play", panel: null };
    session.holdStart = () => {};
    const el = document.createElement("kf-find-buttons");
    el.services = { engine, session, audio: { unlock() {} }, prefs: { recordingTips: true } };
    document.getElementById("stage").append(el);
    engine.dispatchEvent(new CustomEvent("ask", { detail: { kind: "animal", recorded: false, repeat: false } }));
    // From now on the clock reads 200 ms behind the timers (coarsened clocks do this).
    el.now = () => performance.now() - 200;
  });
  const hint = page.locator(".kf-find-hint");
  assert.equal(await hint.isVisible(), true);
  await page.waitForFunction(() => document.querySelector(".kf-find-hint").hidden, null, { timeout: 9000 });
});

test("tour alone: four cards in order with Next and Back; it points at an animal and never covers it", async () => {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await mountTour(page);
  const card = page.locator(".kf-tour-card");
  assert.equal(await step(page), "creature");
  assert.match(await card.textContent(), /This is a felt animal.*Tap it to hear it/);
  assert.match(await card.textContent(), /1 of 4/);
  const ring = await ringBox(page);
  assert.ok(ring.x <= 500 && ring.x + ring.width >= 660 && ring.y <= 520, "the ring is around the animal nearest the middle");
  assert.equal(overlaps(await box(card), ring), false, "the card does not cover the animal");
  assert.equal(await page.getByRole("button", { name: "Back" }).count(), 0, "no Back on the first card");

  // Not modal: a touch beside the card reaches the board underneath.
  const through = await page.evaluate(() => document.elementFromPoint(580, 580)?.closest("kf-tour") ?? null);
  assert.equal(through, null);

  await page.getByRole("button", { name: "Next" }).tap();
  assert.equal(await step(page), "edit");
  assert.match(await card.textContent(), /Press and hold the scene for 1\.5 s/);
  assert.equal(await page.locator(".kf-tour-ring").isVisible(), false, "nothing to point at in play");
  await page.getByRole("button", { name: "Back" }).tap();
  assert.equal(await step(page), "creature");
  for (const want of ["edit", "scenes", "sounds"]) {
    await page.getByRole("button", { name: "Next" }).tap();
    assert.equal(await step(page), want);
  }
  assert.match(await card.textContent(), /What does the fox say\?/);
  assert.equal(await page.getByRole("button", { name: "Skip tour" }).count(), 0, "the last card just ends");
  for (const b of await page.locator(".kf-tour-card button").all()) {
    const r = await b.boundingBox();
    assert.ok(r.height >= 44 && r.width >= 44, "parent targets at least 44 px");
  }
  await page.getByRole("button", { name: "Done" }).tap();
  assert.equal(await page.evaluate(() => window.__closed), 1);
  assert.equal(await page.locator("kf-tour").count(), 0);
  assert.deepEqual(page.errors, []);
});

test("tour alone: Skip tour ends it from any card; it steps aside for the adult check and panels", async () => {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await mountTour(page);
  await page.getByRole("button", { name: "Next" }).tap();
  await page.evaluate(() => { window.__t.session.state = { mode: "gate", panel: null }; window.__t.session.dispatchEvent(new Event("change")); });
  assert.equal(await page.locator("kf-tour").isVisible(), false, "hidden while the adult check is up");
  await page.evaluate(() => { window.__t.session.state = { mode: "play", panel: null }; window.__t.session.dispatchEvent(new Event("change")); });
  assert.equal(await page.locator(".kf-tour-card").isVisible(), true);
  assert.equal(await step(page), "edit", "the same card comes back");
  await page.getByRole("button", { name: "Skip tour" }).tap();
  assert.equal(await page.evaluate(() => window.__closed), 1);

  // Escape skips too.
  await mountTour(page);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.__closed), 1, "a fresh mount counts from 0");
  assert.deepEqual(page.errors, []);
});

test("tour alone in edit mode: the cards point at the pencil and the Scenes button", async () => {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await mountTour(page, { mode: "edit" });
  await page.getByRole("button", { name: "Next" }).tap();
  assert.equal(await step(page), "edit");
  const pencil = await box(page.locator(".kf-badge.pencil"));
  let ring = await ringBox(page);
  assert.ok(ring.x <= pencil.x && ring.x + ring.width >= pencil.x + pencil.width, "around the pencil");
  assert.match(await page.locator(".kf-tour-card").textContent(), /Tap an animal to select it, then drag the round handle on its ring.*✎ pencil/);
  await page.getByRole("button", { name: "Next" }).tap();
  const scenes = await box(page.locator('[data-action="scenes"]'));
  ring = await ringBox(page);
  assert.ok(ring.y <= scenes.y && ring.y + ring.height >= scenes.y + scenes.height, "around Scenes");
  assert.equal(await page.locator(".kf-tour-card").getAttribute("data-place"), "top", "the card stays clear of the edit bar");
  assert.equal(overlaps(await box(page.locator(".kf-tour-card")), ring), false);
  assert.deepEqual(page.errors, []);
});

// ---------------------------------------------------------------- journeys through the real app

async function welcome(page) {
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).tap();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
  await page.locator(".kf-tour-card").waitFor();
}

test("first run: welcome, then the tour to the end; neither comes back", async () => {
  const page = await h.newPage();
  await welcome(page);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const card = page.locator(".kf-tour-card");
    seen.push(await card.getAttribute("data-step"));
    if (i === 0) {
      await page.waitForTimeout(300);
      const ring = await ringBox(page);
      assert.ok(ring && ring.width > 40, "the first card points at a real animal on the board");
      assert.equal(overlaps(await box(card), ring), false);
    }
    await page.screenshot({ path: join(SHOTS, `tour-${i + 1}.png`) }).catch(() => {});
    await page.getByRole("button", { name: i === 3 ? "Done" : "Next" }).tap();
  }
  assert.deepEqual(seen, ["creature", "edit", "scenes", "sounds"]);
  await page.locator("kf-tour").waitFor({ state: "detached" });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("kf-welcome, kf-tour").count(), 0, "the child never gets the tour");
  assert.deepEqual(page.errors, []);
});

test("first run: Skip tour; Settings, Show the tour again, in edit mode", async () => {
  const page = await h.newPage();
  await welcome(page);
  await page.getByRole("button", { name: "Skip tour" }).tap();
  await page.locator("kf-tour").waitFor({ state: "detached" });

  await page.evaluate(() => { window.__kf.session.holdArmed(); window.__kf.session.gatePassed(); });
  await page.locator("kf-edit-layer").waitFor();
  await page.locator('[data-action="settings"]').tap();
  await page.locator("kf-settings").waitFor();
  await page.getByRole("button", { name: "Show the tour again" }).tap();
  await page.locator("kf-settings").waitFor({ state: "detached" });
  await page.locator(".kf-tour-card").waitFor();
  assert.equal(await page.locator(".kf-tour-card").getAttribute("data-step"), "creature");
  await page.getByRole("button", { name: "Next" }).tap();
  await page.waitForTimeout(700); // the edit layer places its badges after things settle
  const pencil = await box(page.locator("kf-edit-layer .kf-badge.pencil").first());
  const ring = await ringBox(page);
  assert.ok(ring.x <= pencil.x + 1 && ring.y <= pencil.y + 1, "points at a real pencil");
  await page.screenshot({ path: join(SHOTS, "tour-edit-pencil.png") }).catch(() => {});
  await page.getByRole("button", { name: "Next" }).tap();
  await page.waitForTimeout(100);
  const scenes = await box(page.locator('kf-edit-layer [data-action="scenes"]'));
  const sceneRing = await ringBox(page);
  assert.ok(sceneRing.x <= scenes.x && sceneRing.x + sceneRing.width >= scenes.x + scenes.width, "points at the real Scenes button");
  assert.equal(overlaps(await box(page.locator(".kf-tour-card")), sceneRing), false);
  await page.screenshot({ path: join(SHOTS, "tour-edit-scenes.png") }).catch(() => {});

  // Opening Scenes from the tour: the tour steps aside, and comes back when the panel closes.
  await page.locator('kf-edit-layer [data-action="scenes"]').tap();
  await page.locator("kf-scenes").waitFor();
  assert.equal(await page.locator(".kf-tour-card").isVisible(), false);
  await page.evaluate(() => window.__kf.session.closePanel());
  await page.locator(".kf-tour-card").waitFor();
  await page.getByRole("button", { name: "Skip tour" }).tap();
  await page.locator("kf-tour").waitFor({ state: "detached" });
  assert.deepEqual(page.errors, []);
});

test("real app: a find question in the iPad's voice shows the recording tip; Settings turns it off", async () => {
  const page = await h.newPage();
  await welcome(page);
  await page.getByRole("button", { name: "Skip tour" }).tap();
  await page.locator("kf-tour").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Find a colour" }).tap();
  const hint = page.locator(".kf-find-hint");
  await hint.waitFor({ state: "visible" });
  assert.equal(await hint.getAttribute("data-kind"), "color");
  assert.match(await hint.textContent(), /Hold 1 s to record your own question/);
  await page.waitForTimeout(500); // faded in
  await page.screenshot({ path: join(SHOTS, "recording-tip-app.png") }).catch(() => {});

  await page.evaluate(() => { window.__kf.session.holdArmed(); window.__kf.session.gatePassed(); });
  await page.locator('[data-action="settings"]').tap();
  const tips = page.getByLabel("Show recording tips");
  assert.equal(await tips.isChecked(), true, "on by default");
  await tips.tap();
  assert.equal(await page.evaluate(() => window.__kf.prefs.recordingTips), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("kf.recordingTips")), "off");
  assert.deepEqual(page.errors, []);
});
