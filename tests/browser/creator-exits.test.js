// <kf-guided-add> playtest 3, mounted alone at the iPad's size with a real FarmStore over MemoryRepo
// and the F1 stubs: a way out at every moment (‹ Back steps back, ✕ asks "Stop adding?"), no Eyes
// dead end (a draft with no body never opens on Eyes, and Eyes never waits on Klara's stamping),
// Enter on the tablet keyboard, and no animal without a name.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const STUBS = join(ROOT, "tests/browser/stubs/f1-stubs.js");
const SHOTS = process.env.KF_SHOTS;
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}.png`) }) : null);
let h;

before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

const SQUARE = [[0.38, 0.45], [0.62, 0.45], [0.62, 0.7], [0.38, 0.7]];
const WALK = { kind: "preset", preset: "walk", params: {} };

/**
 * A modulePage with the stubs and a store with one place. `draft` is saved first (so mounting resumes
 * it); `thing` fills the new draft and `step` is where it opens.
 */
async function creator({ draft = null, thing = null, step = 0, params = {} } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.addScriptTag({ path: STUBS, type: "module" });
  await page.waitForFunction(() => window.__f1);
  await page.evaluate(async ({ draft, thing, step, params }) => {
    const { FarmStore } = await import("./js/farm-store.js");
    const { MemoryRepo } = await import("./js/io/memory-repo.js");
    let n = 0;
    let t = Date.UTC(2026, 10, 5, 12);
    const env = { now: () => new Date((t += 1000)).toISOString(), rng: () => 0.5, newId: () => `id-${String(++n).padStart(4, "0")}`, deviceId: "test" };
    const repo = new MemoryRepo();
    const store = new FarmStore(repo, env, "test");
    await store.hydrate();
    await store.createPlace({ name: "Farm" });
    const placeId = store.currentPlace.id;
    if (draft) await store.saveDraft({ ...draft, placeId });
    const load = async (l) => [l, await (await fetch(`data/scripts/${l}.json`)).json()];
    const scripts = Object.fromEntries(await Promise.all(["en"].map(load)));
    window.__t = { store, repo, placeId, services: window.__f1.makeServices({ store, scripts }) };
    await import("./js/components/kf-guided-add/define.js");
    const el = document.createElement("kf-guided-add");
    el.services = window.__t.services;
    el.params = { holdMs: 150, ...params };
    window.__closed = 0;
    el.addEventListener("kf-close", () => { window.__closed++; el.remove(); });
    document.getElementById("parent-layer").append(el);
    await el.ready;
    if (thing) Object.assign(el.draft.thing, thing);
    if (step) el._go(step);
    window.__el = el;
  }, { draft, thing, step, params });
  return page;
}

const step = (page) => page.evaluate(() => window.__el?.dataset.step ?? null);
const closed = (page) => page.evaluate(() => window.__closed);
const drafts = (page) => page.evaluate(async () => (await window.__t.store.listDrafts()).length);

/** ‹ Back and ✕ are there, enabled, at least 44 px, and the topmost thing at their centre. */
async function exitsReachable(page) {
  return page.evaluate(() => {
    const out = {};
    for (const action of ["back", "close"]) {
      const b = document.querySelector(`kf-guided-add .kf-ga-top [data-action="${action}"]`);
      if (!b) { out[action] = "missing"; continue; }
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out[action] = b.disabled ? "disabled" : r.width < 44 || r.height < 44 ? "small" : hit === b || b.contains(hit) ? "ok" : `covered by ${hit?.className}`;
    }
    return out;
  });
}

const OK = { back: "ok", close: "ok" };
const READY = { outline: SQUARE, color: "red", motion: WALK, names: { en: "Cow" } };

test("every step has ‹ Back and ✕ on top, also with a shape picked, the name keyboard up or the sound recorder showing", async () => {
  const page = await creator();
  assert.deepEqual(await exitsReachable(page), OK, "the very first screen: Back is not greyed out");
  await page.evaluate(() => document.querySelector("kf-draw-pad").emitStroke([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]));
  await page.evaluate(() => window.__el._editor.dispatch({ type: "tap", hit: 0 }));
  await page.locator(".kf-se-selection:not([hidden])").waitFor();
  assert.deepEqual(await exitsReachable(page), OK, "a shape picked in the shape editor");
  await page.evaluate((t) => Object.assign(window.__el.draft.thing, t), READY);
  for (let i = 1; i < 7; i++) {
    await page.evaluate((i) => window.__el._go(i), i);
    assert.deepEqual(await exitsReachable(page), OK, `step ${await step(page)}`);
    if ((await step(page)) === "legs") {
      await page.getByRole("button", { name: "3 legs" }).click();
      assert.deepEqual(await exitsReachable(page), OK, "placing legs");
    }
    if ((await step(page)) === "name") {
      await page.locator('input[name="name"]').focus();
      assert.deepEqual(await exitsReachable(page), OK, "typing a name");
    }
    if ((await step(page)) === "sound") {
      await page.locator('kf-recorder[data-kind="sound"]').waitFor();
      assert.deepEqual(await exitsReachable(page), OK, "the sound recorder");
    }
  }
  assert.deepEqual(page.errors, []);
});

test("‹ Back steps back on every step, and on Body asks to stop instead of doing nothing", async () => {
  const page = await creator({ thing: READY, step: 6 });
  const order = [];
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "‹ Back" }).click();
    order.push(await step(page));
  }
  assert.deepEqual(order, ["name", "moves", "legs", "eyes", "felt", "draw"]);
  await page.getByRole("button", { name: "‹ Back" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Stop adding this animal?" });
  await dialog.waitFor();
  await shot(page, "creator-leave");
  assert.deepEqual(await dialog.getByRole("button").allTextContents(), ["Keep going", "Keep draft", "Stop adding"]);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "keep-draft", "the safe choice has the focus");
  await dialog.getByRole("button", { name: "Keep going" }).click();
  assert.equal(await dialog.count(), 0);
  assert.equal(await step(page), "draw", "still drawing, nothing lost");
  assert.deepEqual(await page.evaluate(() => window.__el.thing.outline), SQUARE);
  assert.deepEqual(page.errors, []);
});

test("✕ → Stop adding throws the draft away and closes; Keep draft keeps it", async () => {
  const page = await creator({ thing: READY, step: 3 });
  await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d.length === 1));
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Stop adding" }).click();
  await page.waitForFunction(() => window.__closed === 1);
  assert.equal(await drafts(page), 0);
  assert.equal(await page.evaluate(() => window.__t.store.snapshot.things.length), 0, "nothing was added");

  const kept = await creator({ thing: READY, step: 3 });
  await kept.getByRole("button", { name: "Close" }).click();
  await kept.getByRole("button", { name: "Keep draft" }).click();
  await kept.waitForFunction(() => window.__closed === 1);
  assert.equal(await drafts(kept), 1);
});

test("✕ with nothing drawn, named or recorded closes at once and leaves no draft", async () => {
  const page = await creator();
  await page.getByRole("button", { name: "Close" }).click();
  await page.waitForFunction(() => window.__closed === 1);
  assert.equal(await drafts(page), 0);
});

test("a kept draft resumes as 'Your drawing'; with params.fresh (the library's Draw a new animal) it is thrown away and a new one starts", async () => {
  const kept = { id: null, step: 0, at: [0.5, 0.62], thing: { names: {}, cues: {}, eyes: [], legs: [], outline: SQUARE, color: null, motion: null }, clips: [] };
  const page = await creator({ draft: kept });
  assert.equal(await step(page), "draw");
  assert.equal(await page.locator(".kf-ga-shapes").textContent(), "Your drawing", "not '1 shape': the parent drew a body, a head and horns");
  await page.evaluate(() => document.querySelector("kf-draw-pad").emitStroke([[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]));
  assert.equal(await page.locator(".kf-ga-shapes").textContent(), "2 shapes", "a new shape counts from there");

  const fresh = await creator({ draft: kept, params: { fresh: true } });
  assert.equal(await fresh.evaluate(() => window.__el.thing.outline), null, "a new animal");
  await fresh.waitForFunction(() => window.__t.store.listDrafts().then((d) => d.length === 0));
  assert.deepEqual(fresh.errors, []);
});

test("eyes dead end: a draft saved on Eyes without a body opens on Body, not on Eyes", async () => {
  const page = await creator({ draft: { id: null, step: 2, at: [0.5, 0.62], thing: { names: {}, cues: {}, eyes: [], legs: [], outline: null, color: "red", motion: null }, clips: [] } });
  assert.equal(await step(page), "draw");
  assert.equal(await page.locator('[data-testid="eye-stamping"]').count(), 0);
  assert.deepEqual(await exitsReachable(page), OK);
  assert.equal(await page.getByRole("button", { name: "Next" }).isDisabled(), true, "draw a body first");
});

test("eyes dead end: on Eyes with no body, the step says so and leads back to Body; stamping never opens", async () => {
  const page = await creator({ step: 2 });
  assert.equal(await step(page), "eyes");
  await page.getByText("there is no body yet").waitFor();
  assert.equal(await page.getByRole("button", { name: "Let Klara stamp" }).count(), 0);
  await page.evaluate(() => window.__el._dispatch({ type: "stamp", canStamp: false }));
  assert.equal(await page.locator('[data-testid="eye-stamping"]').count(), 0);
  assert.deepEqual(await exitsReachable(page), OK);
  await page.getByRole("button", { name: "Draw the body" }).click();
  assert.equal(await step(page), "draw");
});

test("eyes: the step opens on its panel; the parent taps the body to put eyes on; Klara's stamping is a tap away and Cancel comes back", async () => {
  const page = await creator({ thing: { outline: SQUARE, color: "red" }, step: 2 });
  assert.equal(await page.locator('[data-testid="eye-stamping"]').count(), 0, "no full-screen takeover");
  await page.getByText("Tap the body where an eye goes").waitFor();
  const tap = async (x, y) => {
    const [cx, cy] = await page.evaluate(([x, y]) => window.__el.toClient(x, y), [x, y]);
    await page.mouse.click(cx, cy);
  };
  await tap(0.45, 0.52);
  await page.getByText("One eye.").waitFor();
  await tap(0.58, 0.52);
  await page.getByText("Two eyes.").waitFor();
  await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d[0]?.thing.eyes.length === 2));
  const eyes = await page.evaluate(() => window.__el.thing.eyes);
  assert.ok(eyes.every((e) => e.x > 0.38 && e.x < 0.62 && e.y > 0.45 && e.y < 0.7), JSON.stringify(eyes));
  assert.ok(await page.evaluate(() => window.__f1.chimes.includes("tap")));
  await page.getByRole("button", { name: "Undo eye" }).click();
  await page.getByText("One eye.").waitFor();

  await page.getByRole("button", { name: "Let Klara stamp" }).click();
  const view = page.locator('[data-testid="eye-stamping"]');
  await view.waitFor();
  assert.match(await view.locator(".kf-eyes-label").textContent(), /hold Done or Cancel for 1 second/, "both need the hold");
  const cancel = await view.getByRole("button", { name: /^Cancel/ }).boundingBox();
  await page.mouse.move(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  assert.equal(await view.count(), 0);
  assert.deepEqual(await exitsReachable(page), OK, "back on the panel with its ways out");
  assert.deepEqual(page.errors, []);
});

test("Enter on the Name field commits the name, closes the keyboard and goes on", async () => {
  const page = await creator({ thing: { ...READY, names: {} }, step: 5 });
  const input = page.locator('input[name="name"]');
  assert.equal(await input.getAttribute("enterkeyhint"), "next");
  await input.fill("Cow");
  await input.press("Enter");
  assert.equal(await step(page), "sound");
  assert.deepEqual(await page.evaluate(() => window.__el.thing.names), { en: "Cow" });
  assert.notEqual(await page.evaluate(() => document.activeElement?.name), "name", "the keyboard went down");
  await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d[0]?.thing.names.en === "Cow"));

  // The iPad's go key submits the form instead of sending a keydown: the same happens.
  await page.getByRole("button", { name: "‹ Back" }).click();
  await page.locator('input[name="name"]').fill("Ko");
  await page.evaluate(() => document.querySelector(".kf-ga-name-form").requestSubmit());
  assert.equal(await step(page), "sound");
  assert.equal(await page.evaluate(() => window.__el.thing.names.en), "Ko");
  assert.deepEqual(page.errors, []);
});

test("Enter on an empty Name closes the keyboard and asks for a name, without going on", async () => {
  const page = await creator({ thing: { ...READY, names: {} }, step: 5 });
  await page.locator('input[name="name"]').focus();
  await page.locator('input[name="name"]').press("Enter");
  assert.equal(await step(page), "name");
  await page.getByRole("alert").filter({ hasText: "Give it a name first" }).waitFor();
  assert.notEqual(await page.evaluate(() => document.activeElement?.name), "name");
});

test("a name is required: Next on Name asks for one, typing clears the ask, Finish without a name goes back to Name", async () => {
  const page = await creator({ thing: { ...READY, names: {} }, step: 5 });
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await step(page), "name");
  const ask = page.locator(".kf-ga-name-needed");
  await ask.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.name), "name", "the field is ready to type in");
  await shot(page, "creator-name-needed");
  await page.keyboard.type("C");
  assert.equal(await ask.isHidden(), true, "the ask goes as soon as there is a name");
  await page.locator('input[name="name"]').fill("");

  // Straight to Sound (a draft from before this rule): Finish asks instead of adding a nameless animal.
  await page.evaluate(() => window.__el._go(6));
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  assert.equal(await step(page), "name");
  await ask.waitFor();
  assert.equal(await page.evaluate(() => window.__t.store.snapshot.things.length), 0, "nothing was added");
  assert.equal(await closed(page), 0);
  await page.locator('input[name="name"]').fill("Kossa");
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await step(page), "sound");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.waitForFunction(() => window.__closed === 1);
  assert.deepEqual(await page.evaluate(() => window.__t.store.snapshot.things[0].names), { en: "Kossa" });
  assert.deepEqual(page.errors, []);
});

test("copy: Felt opens with the tan the drawing showed (Next on); before a name is typed the recorder says to type it first", async () => {
  const page = await creator({ thing: { outline: SQUARE } });
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await step(page), "felt");
  assert.equal(await page.locator('.kf-swatch[aria-pressed="true"]').getAttribute("data-color"), "tan");
  assert.equal(await page.getByRole("button", { name: "Next" }).isDisabled(), false);

  const named = await creator({ thing: { ...READY, names: {} }, step: 5 });
  const label = () => named.evaluate(() => document.querySelector('kf-recorder[data-kind="name"]').label);
  assert.equal(await label(), "Type its name above first, then record yourself saying it.");
  assert.ok(!(await label()).includes("…"));
  await named.locator('input[name="name"]').fill("Cow");
  assert.equal(await label(), "Record its name. Say just the word, slowly and clearly: “Cow”");
  assert.deepEqual(named.errors, []);
});

test("the leave dialog closes inside the tap even when the iPad's storage hangs; a failed save or discard shows a toast", async () => {
  // AGENTS.md rule 5: never await before closing UI after a tap. A save that never resolves must not
  // keep the creator open.
  for (const action of ["Keep draft", "Stop adding"]) {
    const page = await creator({ thing: READY, step: 3 });
    await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d.length === 1));
    await page.evaluate(() => {
      const s = window.__t.store;
      s.saveDraft = () => new Promise(() => {});
      s.discardDraft = () => new Promise(() => {});
    });
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: action }).click();
    assert.equal(await closed(page), 1, `${action} closed in the same tap`);
  }
  // An empty draft's ‹ Back on Body closes at once too, even with a save still hanging.
  const empty = await creator();
  await empty.evaluate(() => {
    window.__t.store.discardDraft = () => new Promise(() => {});
    window.__el._saving = new Promise(() => {});
    window.__el.draft.id = "d-1";
  });
  await empty.getByRole("button", { name: "‹ Back" }).click();
  assert.equal(await closed(empty), 1);

  // A refused write is not silent: a toast says so.
  for (const action of ["Keep draft", "Stop adding"]) {
    const page = await creator({ thing: READY, step: 3 });
    await page.waitForFunction(() => window.__t.store.listDrafts().then((d) => d.length === 1));
    await page.evaluate(() => {
      const s = window.__t.store;
      s.saveDraft = () => Promise.reject(Object.assign(new Error("full"), { code: "quota" }));
      s.discardDraft = () => Promise.reject(new Error("disk"));
    });
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: action }).click();
    assert.equal(await closed(page), 1);
    await page.waitForFunction(() => window.__f1.toasts.length > 0);
  }
});
