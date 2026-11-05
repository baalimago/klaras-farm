// Parents' playtest 2: the bugs they hit, reproduced in Chromium and kept fixed.
//   - eye stamping was a dead end (no visible way out, no instruction for the grown-up hold)
//   - the leg count could not be changed while placing, the panel did not follow the state, and
//     placing many legs was hard (a tap near a leg took it off)
//   - edits showed up late or not at all (the UI waited for the disk, or skipped re-rendering)
//   - a stray tap threw away the parent's progress
// Thing card and guided add run on a modulePage with a real FarmStore over MemoryRepo and the F1
// stubs; settings runs with the F2 stubs. `slowDisk` delays every write, like a busy iPad.
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

/** Every repository write now takes `ms` (an iPad busy writing a recording). */
const slowDisk = (page, ms = 400) =>
  page.evaluate((ms) => {
    const repo = (window.__t ?? { repo: window.services.store.repo }).repo;
    const write = repo.write.bind(repo);
    repo.write = (w) => new Promise((ok) => setTimeout(ok, ms)).then(() => write(w));
  }, ms);

async function tapBoard(page, x, y) {
  const [cx, cy] = await page.evaluate(([x, y]) => window.__el.toClient(x, y), [x, y]);
  await page.mouse.click(cx, cy);
}

async function dragBoard(page, [x0, y0], [x1, y1]) {
  const a = await page.evaluate(([x, y]) => window.__el.toClient(x, y), [x0, y0]);
  const b = await page.evaluate(([x, y]) => window.__el.toClient(x, y), [x1, y1]);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 6 });
  await page.mouse.up();
}

const heading = (page) => page.locator(".kf-legs-heading").textContent();
const pressed = (page, n) => page.locator(`.kf-legs-count[data-count="${n}"]`).getAttribute("aria-pressed");
const thingNow = (page) => page.evaluate(() => structuredClone(window.__t.store.snapshot.things[0]));

/** Guided add straight on the Legs step, with a square outline (0.4–0.6 × 0.5–0.7). */
async function guidedOnLegs(page) {
  await mount(page, "kf-guided-add");
  await page.evaluate(() => {
    const el = window.__el;
    el.draft.thing.outline = [[0.4, 0.5], [0.6, 0.5], [0.6, 0.7], [0.4, 0.7]];
    el.draft.thing.color = "red";
    el._go(3);
  });
  await page.locator('[data-testid="leg-placing"]').waitFor();
}

async function holdButton(page, locator, ms = 1150) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

// ---------------------------------------------------------------- legs

test("legs: pressing another count while placing re-renders the whole panel at once", async () => {
  const page = await farmPage({ things: 0 });
  await guidedOnLegs(page);
  assert.equal(await heading(page), "How many legs?");
  await page.getByRole("button", { name: "2 legs" }).click();
  assert.equal(await heading(page), "Tap where leg 1 of 2 goes");
  await tapBoard(page, 0.45, 0.68);
  assert.equal(await heading(page), "Tap where leg 2 of 2 goes");

  // The bug: press 4 and the panel still asked for "leg 2" of two. Now every part follows at once.
  const after4 = await page.evaluate(() => {
    document.querySelector('.kf-legs-count[data-count="4"]').click();
    return {
      heading: document.querySelector(".kf-legs-heading").textContent,
      four: document.querySelector('.kf-legs-count[data-count="4"]').getAttribute("aria-pressed"),
      two: document.querySelector('.kf-legs-count[data-count="2"]').getAttribute("aria-pressed"),
      legs: window.__el.thing.legs.length,
    };
  });
  assert.deepEqual(after4, { heading: "Tap where leg 2 of 4 goes", four: "true", two: "false", legs: 1 });
  for (const x of [0.5, 0.55, 0.58]) await tapBoard(page, x, 0.68);
  assert.equal(await heading(page), "4 legs");
  // Fewer than placed drops the newest legs, at once.
  await page.getByRole("button", { name: "1 leg", exact: true }).click();
  assert.equal(await heading(page), "One leg");
  assert.equal(await page.evaluate(() => window.__el.thing.legs.length), 1);
  assert.equal(await pressed(page, 1), "true");
  await page.waitForFunction(async () => (await window.__t.store.listDrafts())[0]?.thing.legs.length === 1);
  assert.deepEqual(page.errors, []);
});

test("legs: eight legs go on by tapping close together; drag moves one; Undo, Clear, Spread evenly", async () => {
  const page = await farmPage();
  await mount(page, "kf-thing-card", { thingId: "id-0002" });
  await page.locator('[data-action="legs"]').click();
  await page.locator('[data-testid="leg-placing"]').waitFor();
  await page.getByRole("button", { name: "8 legs" }).click();
  const xs = [0.13, 0.15, 0.17, 0.19, 0.21, 0.23, 0.25, 0.27];
  for (let i = 0; i < xs.length; i++) {
    assert.equal(await heading(page), `Tap where leg ${i + 1} of 8 goes`);
    await tapBoard(page, xs[i], 0.69);
  }
  assert.equal(await heading(page), "8 legs");
  let legs = await page.evaluate(() => window.__el._overlay.placer.legs);
  assert.equal(legs.length, 8);

  // Drag the first leg up into the body: it moves, it is not taken off.
  await dragBoard(page, [legs[0].x, legs[0].y], [0.2, 0.6]);
  const moved = await page.evaluate(() => window.__el._overlay.placer.legs);
  assert.equal(moved.length, 8);
  assert.ok(Math.abs(moved[0].x - 0.2) < 0.02 && Math.abs(moved[0].y - 0.6) < 0.02, JSON.stringify(moved[0]));
  // Undo puts it back where it was.
  await page.locator('[data-action="undo-leg"]').click();
  const undone = await page.evaluate(() => window.__el._overlay.placer.legs);
  assert.deepEqual(undone, legs, "undo put the leg back");
  // Clear takes them all off and asks for leg 1 again; Spread evenly places all 8 along the bottom.
  await page.locator('[data-action="clear-legs"]').click();
  assert.equal(await heading(page), "Tap where leg 1 of 8 goes");
  await page.locator('[data-action="spread-legs"]').click();
  assert.equal(await heading(page), "8 legs");
  legs = await page.evaluate(() => window.__el._overlay.placer.legs);
  assert.equal(legs.length, 8);
  assert.ok(legs.every((l) => l.x > 0.12 && l.x < 0.28 && l.y > 0.6 && l.y <= 0.7), JSON.stringify(legs));
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction(() => window.__t.store.snapshot.things[0].legs.length === 8);
  assert.equal(await page.locator(".kf-tc-overlay").count(), 0);
  assert.deepEqual(page.errors, []);
});

test("legs: stray taps never throw away progress", async () => {
  const page = await farmPage();
  await mount(page, "kf-thing-card", { thingId: "id-0002" });
  await page.locator('[data-action="legs"]').click();
  await page.getByRole("button", { name: "2 legs" }).click();
  await tapBoard(page, 0.16, 0.69);
  await tapBoard(page, 0.24, 0.69);
  assert.equal(await heading(page), "2 legs");
  const legs = await page.evaluate(() => window.__el._overlay.placer.legs);
  // A tap on a placed leg, and taps far outside the shape, change nothing and close nothing.
  await tapBoard(page, legs[0].x, legs[0].y);
  await tapBoard(page, 0.9, 0.1);
  await tapBoard(page, 0.6, 0.9);
  assert.deepEqual(await page.evaluate(() => window.__el._overlay.placer.legs), legs);
  assert.equal(await heading(page), "2 legs");
  assert.equal(await page.locator('[data-testid="leg-placing"]').count(), 1);
  // While placing, a tap outside the shape is a placement, kept inside the outline.
  await page.getByRole("button", { name: "3 legs" }).click();
  await tapBoard(page, 0.31, 0.76);
  const three = await page.evaluate(() => window.__el._overlay.placer.legs);
  assert.equal(three.length, 3);
  assert.ok(three[2].x <= 0.28 && three[2].y <= 0.7, JSON.stringify(three[2]));
  assert.deepEqual(page.errors, []);
});

// ---------------------------------------------------------------- eyes

test("eyes: the stamping screen always shows the way out and what the grown-up must do", async () => {
  const page = await farmPage({ things: 0 });
  await mount(page, "kf-guided-add");
  await page.evaluate(() => {
    const el = window.__el;
    el.draft.thing.outline = [[0.4, 0.5], [0.6, 0.5], [0.6, 0.7], [0.4, 0.7]];
    el.draft.thing.color = "red";
    el._go(2);
  });
  const view = page.locator('[data-testid="eye-stamping"]');
  await page.getByRole("button", { name: "Let Klara stamp" }).click();
  await view.waitFor();
  const done = view.getByRole("button", { name: /^Done/ });
  const cancel = view.getByRole("button", { name: /^Cancel/ });
  for (const b of [done, cancel]) {
    assert.ok(await b.isVisible());
    const box = await b.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
  }
  assert.match(await view.locator(".kf-eyes-label").textContent(), /hold/i, "the hold is explained on screen");

  await tapBoard(page, 0.47, 0.6);
  await tapBoard(page, 0.53, 0.6);
  // A quick tap on Done does not leave (Klara mashing), but tells the grown-up to keep holding.
  await done.click();
  assert.equal(await view.count(), 1);
  assert.match(await view.locator(".kf-eyes-label").textContent(), /keep holding/i);
  await holdButton(page, done);
  assert.equal(await view.count(), 0);
  assert.equal(await page.evaluate(() => window.__el.thing.eyes.length), 2);

  // Cancel restores the eyes from before stamping.
  const before = await page.evaluate(() => structuredClone(window.__el.thing.eyes));
  await page.getByRole("button", { name: "Let Klara stamp" }).click();
  await view.waitFor();
  await tapBoard(page, 0.45, 0.55);
  await tapBoard(page, 0.55, 0.65);
  await holdButton(page, page.locator('[data-testid="eye-stamping"]').getByRole("button", { name: /^Cancel/ }));
  assert.equal(await view.count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__el.thing.eyes), before);
  await page.waitForFunction((n) => window.__t.store.listDrafts().then((d) => d[0]?.thing.eyes.length === n), before.length);
  assert.deepEqual(page.errors, []);
});

test("eyes: Cancel on the thing card's Re-stamp keeps the old eyes and the card keeps updating", async () => {
  const page = await farmPage();
  await mount(page, "kf-thing-card", { thingId: "id-0002" });
  const old = (await thingNow(page)).eyes;
  await page.locator('[data-action="restamp"]').click();
  const view = page.locator('[data-testid="eye-stamping"]');
  await view.waitFor();
  await tapBoard(page, 0.15, 0.6);
  await holdButton(page, view.getByRole("button", { name: /^Cancel/ }));
  assert.equal(await view.count(), 0);
  assert.deepEqual((await thingNow(page)).eyes, old);
  const swatch = await page.evaluate(() => {
    document.querySelector('.kf-swatch[data-color="blue"]').click();
    return document.querySelector('.kf-swatch[data-color="blue"]').getAttribute("aria-pressed");
  });
  assert.equal(swatch, "true");
  assert.deepEqual(page.errors, []);
});

// ---------------------------------------------------------------- state propagation

test("thing card: felt, moves, name and question edits show at once, even with a slow disk", async () => {
  const page = await farmPage();
  await mount(page, "kf-thing-card", { thingId: "id-0002" });
  await slowDisk(page);
  const out = await page.evaluate(async () => {
    const q = (s) => document.querySelector(s);
    const tick = () => Promise.resolve();
    const store = window.__t.store;
    const r = {};
    q('.kf-swatch[data-color="blue"]').click();
    await tick();
    r.swatch = q('.kf-swatch[data-color="blue"]').getAttribute("aria-pressed");
    r.color = store.snapshot.things[0].color;

    const name = q('input[name="name"]');
    name.value = "Piglet";
    name.dispatchEvent(new Event("change"));
    await tick();
    r.title = q("#kf-tc-title").textContent;
    r.name = store.snapshot.things[0].names.en;

    const cue = q('input[name="cue-1"]');
    cue.value = "Where is my Piglet?";
    cue.dispatchEvent(new Event("change"));
    await tick();
    r.cue = store.snapshot.things[0].cues.en.lines[0];
    r.cueInput = q('input[name="cue-1"]').value;

    // iPad: tapping a button does not take the focus from a text field.
    q('input[name="name"]').focus();
    q('.kf-tc-motion[data-motion="float"]').click();
    await tick();
    r.float = q('.kf-tc-motion[data-motion="float"]').getAttribute("aria-pressed");
    q('.kf-swatch[data-color="leaf"]').click();
    await tick();
    r.leaf = q('.kf-swatch[data-color="leaf"]').getAttribute("aria-pressed");
    r.focusKept = document.activeElement === q('input[name="name"]');
    return r;
  });
  assert.deepEqual(out, {
    swatch: "true", color: "blue", title: "Piglet", name: "Piglet", cue: "Where is my Piglet?", cueInput: "Where is my Piglet?",
    float: "true", leaf: "true", focusKept: true,
  });
  // And it all reaches the disk.
  await page.waitForFunction(async () => {
    const { things } = await window.__t.repo.load();
    return things[0].color === "leaf" && things[0].names.en === "Piglet" && things[0].motion.preset === "float";
  });
  assert.deepEqual(page.errors, []);
});

test("thing card: a leg overlay survives the name field losing focus, and the card updates after", async () => {
  const page = await farmPage();
  await mount(page, "kf-thing-card", { thingId: "id-0002" });
  await page.locator('input[name="name"]').fill("Hog");
  // iPad: the button tap leaves the focus in the name field; it blurs later, saving the name.
  await page.evaluate(() => document.querySelector('[data-action="legs"]').click());
  await page.locator('[data-testid="leg-placing"]').waitFor();
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => window.__t.store.snapshot.things[0].names.en === "Hog");
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok())));
  assert.equal(await page.locator('[data-testid="leg-placing"]').count(), 1, "the overlay is still open");
  await page.getByRole("button", { name: "2 legs" }).click();
  await page.locator('[data-action="spread-legs"]').click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction(() => !document.querySelector(".kf-tc-overlay"));
  assert.equal(await page.locator("#kf-tc-title").textContent(), "Hog");
  assert.equal((await thingNow(page)).legs.length, 2);
  const swatch = await page.evaluate(() => {
    document.querySelector('.kf-swatch[data-color="blue"]').click();
    return document.querySelector('.kf-swatch[data-color="blue"]').getAttribute("aria-pressed");
  });
  assert.equal(swatch, "true", "the card still follows the store");
  assert.deepEqual(page.errors, []);
});

test("settings: changes show at once with a slow disk, and the sheet keeps its scroll and open help", async () => {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.addScriptTag({ path: F2 });
  await page.evaluate(async () => {
    const store = (await window.F2.boot(null)).store;
    await store.createPlace({ name: "Farm" });
    await window.F2.mount("kf-settings");
  });
  await page.locator("kf-settings").getByLabel("Sleep timer").waitFor();
  await page.setViewportSize({ width: 800, height: 500 });
  await slowDisk(page);
  const out = await page.evaluate(async () => {
    const q = (s) => document.querySelector(s);
    const tick = () => Promise.resolve();
    const store = window.services.store;
    const sheet = q(".kf-settings.kf-sheet");
    q(".kf-settings-details summary").click();
    sheet.scrollTop = 150;
    await new Promise((ok) => setTimeout(ok, 100)); // the toggle and scroll events arrive
    const top = sheet.scrollTop;
    const sleep = q('[data-key="sleep"]');
    sleep.value = "15";
    sleep.dispatchEvent(new Event("change"));
    await tick();
    const findIt = q('[data-key="find-it"]');
    findIt.click();
    await tick();
    return {
      sleep: store.settings.sleepMinutes,
      sleepShown: q('[data-key="sleep"]').value,
      findIt: store.currentPlace.findIt,
      findItShown: q('[data-key="find-it"]').checked,
      scrolled: top > 0,
      scrollKept: q(".kf-settings.kf-sheet").scrollTop === top,
      helpOpen: q(".kf-settings-details").open,
    };
  });
  assert.deepEqual(out, { sleep: 15, sleepShown: "15", findIt: false, findItShown: false, scrolled: true, scrollKept: true, helpOpen: true });
  assert.deepEqual(page.errors, []);
});
