// Package F2: scenes shelf, scene tools, settings, welcome card and shared dialogs.
// Elements run in a module page with a real FarmStore over MemoryRepo, the real Shell
// (confirm/toast through <kf-dialog>) and stubs of the other packages (tests/browser/stubs/).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup } from "./harness.js";
import { aSnapshot, aPlace, aThing, aClip, square } from "../builders.js";

const STUBS = join(import.meta.dirname, "stubs/f2-stubs.js");
let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

// Board stub rect (see stubs): left 140, top 60, 900 × 675.
const B = { left: 140, top: 60, width: 900, height: 675 };
const toClient = ([x, y]) => [B.left + x * B.width, B.top + y * B.height];

function farmAndSea() {
  return aSnapshot()
    .withPlace(
      aPlace({ id: "farm", name: "Farm" })
        .withPiece({ id: "barn", kind: "shape", color: "red", stroke: square(0.2, 0.5, 0.05) })
        .withThing(aThing({ id: "pig" }).withClip(aClip({ kind: "name" })).withClip(aClip({ kind: "sound" })))
        .withThing(aThing({ id: "cow" }).withClip(aClip({ kind: "name" }))),
    )
    .withPlace(aPlace({ id: "sea", name: "Sea", backdrop: "sea", groundColor: "water" }))
    .build();
}

async function open(tag, { snapshot = farmAndSea(), params = {}, opts = {} } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.addScriptTag({ path: STUBS });
  await page.evaluate(async ({ snapshot, opts }) => { await window.F2.boot(snapshot, opts); }, { snapshot, opts });
  if (tag) await page.evaluate(async ({ tag, params }) => { await window.F2.mount(tag, params); }, { tag, params });
  return page;
}

const calls = (page) => page.evaluate(() => window.F2.calls.map((c) => c[0]));
const snap = (page) => page.evaluate(() => structuredClone(window.services.store.snapshot));
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 });

async function assertAccessible(page, tag) {
  const bad = await page.evaluate((tag) => window.F2.unnamed(document.querySelector(tag)), tag);
  assert.deepEqual(bad, [], `${tag}: controls without an accessible name`);
  const small = await page.evaluate((tag) => window.F2.smallTargets(document.querySelector(tag)), tag);
  assert.deepEqual(small, [], `${tag}: targets under 44 px`);
}

// ---------------------------------------------------------------- kf-dialog

test("dialog: confirm resolves true on confirm, false on cancel and Escape, and removes itself", async () => {
  const page = await open(null);
  const ask = (opts) => page.evaluate((o) => { window.__r = undefined; window.services.shell.confirm(o).then((v) => (window.__r = v)); }, opts);

  await ask({ title: "Delete the pig?", body: "This removes its drawing and 2 recordings.", confirmLabel: "Delete", danger: true });
  const dialog = page.getByRole("alertdialog", { name: "Delete the pig?" });
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /2 recordings/);
  assert.ok(await page.evaluate(() => document.querySelector("kf-dialog").contains(document.activeElement)), "focus moves into the dialog");
  assert.deepEqual(await page.evaluate(() => window.F2.unnamed(document.querySelector("kf-dialog"))), []);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await until(page, () => window.__r !== undefined);
  assert.equal(await page.evaluate(() => window.__r), true);
  assert.equal(await page.locator("kf-dialog").count(), 0);

  await ask({ title: "Sure?", body: "x" });
  await page.getByRole("button", { name: "Cancel" }).click();
  await until(page, () => window.__r !== undefined);
  assert.equal(await page.evaluate(() => window.__r), false);

  await ask({ title: "Sure?", body: "x" });
  await page.getByRole("alertdialog").waitFor();
  await page.keyboard.press("Escape");
  await until(page, () => window.__r !== undefined);
  assert.equal(await page.evaluate(() => window.__r), false);
  assert.equal(await page.locator("kf-dialog").count(), 0);
});

test("dialog: focus is trapped inside the confirm", async () => {
  const page = await open(null);
  await page.evaluate(() => { window.services.shell.confirm({ title: "Trap", body: "x", confirmLabel: "Yes" }); });
  await page.getByRole("alertdialog").waitFor();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.querySelector("kf-dialog").contains(document.activeElement)));
  }
  await page.keyboard.press("Shift+Tab");
  assert.ok(await page.evaluate(() => document.querySelector("kf-dialog").contains(document.activeElement)));
});

test("dialog: toast with Undo calls undo; a toast left alone resolves false and goes away", async () => {
  const page = await open(null);
  await page.evaluate(() => {
    window.__t = undefined;
    window.services.shell.toast("Deleted", { undo: () => window.F2.log("undo"), ms: 10000 }).then((v) => (window.__t = v));
  });
  const status = page.getByRole("status");
  await status.waitFor();
  assert.match(await status.textContent(), /Deleted/);
  await page.getByRole("button", { name: "Undo" }).click();
  await until(page, () => window.__t !== undefined);
  assert.equal(await page.evaluate(() => window.__t), true);
  assert.ok((await calls(page)).includes("undo"));
  assert.equal(await page.locator("kf-dialog").count(), 0);

  await page.evaluate(() => { window.__t = undefined; window.services.shell.toast("Saved", { ms: 50 }).then((v) => (window.__t = v)); });
  await until(page, () => window.__t !== undefined);
  assert.equal(await page.evaluate(() => window.__t), false);
  assert.equal(await page.locator("kf-dialog").count(), 0);
});

// ---------------------------------------------------------------- kf-scenes

test("scenes: lists places with thumbnails and switches the current place", async () => {
  const page = await open("kf-scenes");
  const shelf = page.locator("kf-scenes");
  await shelf.getByRole("button", { name: "Farm", exact: true }).waitFor();
  await shelf.getByRole("button", { name: "Sea", exact: true }).waitFor();
  assert.equal(await shelf.locator("canvas").count(), 2);
  assert.equal(await shelf.getByRole("button", { name: "Farm", exact: true }).getAttribute("aria-current"), "true");
  await assertAccessible(page, "kf-scenes");

  await shelf.getByRole("button", { name: "Sea", exact: true }).click();
  await until(page, () => window.services.store.settings.currentPlaceId === "sea");
  assert.ok((await calls(page)).includes("kf-close"));
  assert.deepEqual(page.errors, []);
});

test("scenes: renames a place", async () => {
  const page = await open("kf-scenes");
  await page.getByRole("button", { name: "Options for Farm" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  const input = page.getByLabel("Scene name");
  await input.fill("Our farm");
  await page.getByRole("button", { name: "Save" }).click();
  await until(page, () => window.services.store.snapshot.places.find((p) => p.id === "farm").name === "Our farm");
  await page.getByRole("button", { name: "Our farm", exact: true }).waitFor();
});

test("scenes: delete confirms with the number of things and recordings, Keep it keeps it", async () => {
  const page = await open("kf-scenes");
  await page.getByRole("button", { name: "Options for Farm" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  const text = await dialog.textContent();
  assert.match(text, /2 things/);
  assert.match(text, /3 recordings/);
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await page.locator("kf-dialog").waitFor({ state: "detached" });
  assert.equal((await snap(page)).places.length, 2);

  await page.getByRole("button", { name: "Options for Farm" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await until(page, () => window.services.store.snapshot.places.length === 1);
  const s = await snap(page);
  assert.deepEqual(s.places.map((p) => p.id), ["sea"]);
  assert.equal(s.things.length, 0);
  assert.equal(s.clips.length, 0);
  await page.locator("kf-scenes").getByRole("button", { name: "Farm", exact: true }).waitFor({ state: "detached" });
});

test("scenes: + New scene creates a place with name, backdrop and colours, then opens the scene tools", async () => {
  const page = await open("kf-scenes");
  await page.getByRole("button", { name: "New scene" }).click();
  await page.getByLabel("Scene name").fill("Grandma's garden");
  await page.getByRole("button", { name: "Room" }).click();
  assert.equal(await page.getByRole("button", { name: "Room" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("group", { name: "Sky colour" }).getByRole("button", { name: "Pink" }).click();
  await page.getByRole("group", { name: "Ground colour" }).getByRole("button", { name: "Sand" }).click();
  await assertAccessible(page, "kf-scenes");
  await page.getByRole("button", { name: "Start drawing" }).click();
  await until(page, () => window.F2.calls.some((c) => c[0] === "session.sceneTools"));
  const s = await snap(page);
  const made = s.places.find((p) => p.name === "Grandma's garden");
  assert.ok(made);
  assert.equal(made.backdrop, "room");
  assert.equal(made.skyColor, "pink");
  assert.equal(made.groundColor, "sand");
  assert.equal(s.settings.currentPlaceId, made.id);
  const order = await calls(page);
  assert.ok(order.indexOf("kf-close") < order.indexOf("session.sceneTools"), "closes the shelf before switching to scene tools");
});

test("scenes: thumbnails fall back to plain colours when io/felt.js is missing", async () => {
  const page = await open("kf-scenes");
  await page.locator("kf-scenes canvas").first().waitFor();
  // Farm's sky (#8fd8f5) at the top of its thumbnail.
  const px = await page.evaluate(() => {
    const c = document.querySelector("kf-scenes canvas");
    return [...c.getContext("2d").getImageData(Math.floor(c.width / 2), 2, 1, 1).data].slice(0, 3);
  });
  assert.ok(px.some((v) => v > 0), "thumbnail is painted");
});

// ---------------------------------------------------------------- kf-scene-tools

test("scene tools: shape and yarn pieces from kf-stroke, paint, move, delete, undo, back", async () => {
  const page = await open("kf-scene-tools", { opts: { mode: "scene" } });
  const tools = page.locator("kf-scene-tools");
  await tools.getByRole("button", { name: "Shape" }).waitFor();
  await assertAccessible(page, "kf-scene-tools");
  const pieces = async () => (await snap(page)).places.find((p) => p.id === "farm").pieces;

  // Shape (default tool)
  assert.equal(await tools.getByRole("button", { name: "Shape" }).getAttribute("aria-pressed"), "true");
  await tools.locator('kf-draw-pad[mode="shape"]').waitFor();
  await page.evaluate(() => document.querySelector("kf-draw-pad").stroke([[0.5, 0.3], [0.6, 0.3], [0.6, 0.4], [0.5, 0.4]]));
  await until(page, () => window.services.store.currentPlace.pieces.length === 2);
  assert.equal((await pieces())[1].kind, "shape");

  // Yarn
  await tools.getByRole("button", { name: "Yarn" }).click();
  await tools.locator('kf-draw-pad[mode="yarn"]').waitFor();
  await page.evaluate(() => document.querySelector("kf-draw-pad").stroke([[0.1, 0.8], [0.4, 0.8], [0.7, 0.75]]));
  await until(page, () => window.services.store.currentPlace.pieces.length === 3);
  const yarn = (await pieces())[2];
  assert.equal(yarn.kind, "yarn");
  assert.deepEqual(yarn.stroke, [[0.1, 0.8], [0.4, 0.8], [0.7, 0.75]]);

  // Paint the barn blue
  await tools.getByRole("button", { name: "Paint" }).click();
  assert.equal(await tools.locator("kf-draw-pad").count(), 0, "no draw pad outside Shape/Yarn");
  const [bx, by] = toClient([0.2, 0.5]);
  await page.mouse.click(bx, by);
  await tools.getByRole("group", { name: "Colour" }).getByRole("button", { name: "Blue" }).click();
  await until(page, () => window.services.store.currentPlace.pieces[0].color === "blue");

  // Paint the sky
  await tools.getByRole("button", { name: "Sky" }).click();
  await tools.getByRole("group", { name: "Colour" }).getByRole("button", { name: "Lilac" }).click();
  await until(page, () => window.services.store.currentPlace.skyColor === "lilac");

  // Move the barn right by 100 px (0.111 board units)
  await tools.getByRole("button", { name: "Move" }).click();
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx + 50, by, { steps: 4 });
  await page.mouse.move(bx + 100, by, { steps: 4 });
  await page.mouse.up();
  await until(page, () => Math.abs(window.services.store.currentPlace.pieces[0].stroke[0][0] - (0.15 + 100 / 900)) < 0.002);
  const moved = (await pieces())[0];
  assert.ok(Math.abs(moved.stroke[0][1] - 0.45) < 0.002, "y unchanged");

  // Delete the yarn line: tap near it, confirm
  await tools.getByRole("button", { name: "Delete" }).click();
  const [yx, yy] = toClient([0.25, 0.8]);
  await page.mouse.click(yx, yy + 4);
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await until(page, () => window.services.store.currentPlace.pieces.length === 2);
  assert.ok(!(await pieces()).some((p) => p.kind === "yarn"));

  // Undo restores the previous pieces, step by step
  await tools.getByRole("button", { name: "Undo" }).click();
  await until(page, () => window.services.store.currentPlace.pieces.length === 3);
  assert.equal((await pieces())[2].kind, "yarn");
  await tools.getByRole("button", { name: "Undo" }).click(); // move
  await until(page, () => Math.abs(window.services.store.currentPlace.pieces[0].stroke[0][0] - 0.15) < 0.002);
  await tools.getByRole("button", { name: "Undo" }).click(); // sky
  await until(page, () => window.services.store.currentPlace.skyColor === "sky");
  await tools.getByRole("button", { name: "Undo" }).click(); // paint
  await until(page, () => window.services.store.currentPlace.pieces[0].color === "red");
  await tools.getByRole("button", { name: "Undo" }).click(); // yarn
  await tools.getByRole("button", { name: "Undo" }).click(); // shape
  await until(page, () => window.services.store.currentPlace.pieces.length === 1);
  assert.equal(await tools.getByRole("button", { name: "Undo" }).isDisabled(), true);

  await tools.getByRole("button", { name: "Back to animals" }).click();
  assert.ok((await calls(page)).includes("session.sceneDone"));
  assert.ok((await calls(page)).includes("session.activity"), "interaction counts as activity");
  assert.deepEqual(page.errors, []);
});

test("scene tools: cancelling the delete confirm keeps the piece", async () => {
  const page = await open("kf-scene-tools", { opts: { mode: "scene" } });
  const tools = page.locator("kf-scene-tools");
  await tools.getByRole("button", { name: "Delete" }).click();
  const [bx, by] = toClient([0.2, 0.5]);
  await page.mouse.click(bx, by);
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep it" }).click();
  await page.locator("kf-dialog").waitFor({ state: "detached" });
  assert.equal((await snap(page)).places[0].pieces.length, 1);
  assert.equal(await tools.getByRole("button", { name: "Undo" }).isDisabled(), true);
});

// ---------------------------------------------------------------- kf-settings

test("settings: sleep timer, languages with alternate, adult check kind", async () => {
  const page = await open("kf-settings");
  const s = page.locator("kf-settings");
  await s.getByLabel("Sleep timer").waitFor();
  await assertAccessible(page, "kf-settings");

  await s.getByLabel("Sleep timer").selectOption("15");
  await until(page, () => window.services.store.settings.sleepMinutes === 15);
  await s.getByLabel("Sleep timer").selectOption("0");
  await until(page, () => window.services.store.settings.sleepMinutes === 0);

  await s.getByLabel("Add a language").selectOption("sv");
  await s.getByRole("button", { name: "Add language" }).click();
  await until(page, () => window.services.store.settings.languages.join() === "en,sv");
  await s.getByText("Swedish").first().waitFor();
  await s.getByLabel("Plays in").selectOption("alternate");
  await until(page, () => window.services.store.settings.playLanguage === "alternate");

  await s.getByRole("button", { name: "Remove Swedish" }).click();
  await until(page, () => window.services.store.settings.languages.join() === "en");
  assert.equal(await s.getByRole("button", { name: "Remove English" }).isDisabled(), true, "the last language stays");

  await s.getByLabel("Adult check").selectOption("sum");
  await until(page, () => window.services.store.settings.gateKind === "sum");

  // Things per scene: 8 by default, 1 to 12; the store's cap follows at once.
  assert.equal(await s.getByLabel("Things per scene").inputValue(), "8");
  assert.equal(await s.getByLabel("Things per scene").locator("option").count(), 12);
  await s.getByLabel("Things per scene").selectOption("3");
  await until(page, () => window.services.store.maxThings === 3);
  assert.equal(await s.getByLabel("Things per scene").inputValue(), "3", "the screen shows the saved value");
  assert.match(await s.textContent(), /test-1/, "shows the app version");
});

test("settings: export builds the file then shares it", async () => {
  const page = await open("kf-settings");
  await page.getByRole("button", { name: "Export everything" }).click();
  await until(page, () => window.F2.calls.some((c) => c[0] === "share.shareFile"));
  const order = await calls(page);
  assert.ok(order.indexOf("share.buildExport") < order.indexOf("share.shareFile"));
  assert.deepEqual(page.errors, []);
});

test("settings: import confirms with counts, replaces, and offers Undo", async () => {
  const page = await open("kf-settings");
  await page.locator("kf-settings").getByLabel("Import from a file").waitFor({ state: "attached" });
  await page.setInputFiles('kf-settings input[type="file"]', { name: "farm.zip", mimeType: "application/zip", buffer: Buffer.from([80, 75, 3, 4, 0]) });
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  const text = await dialog.textContent();
  assert.match(text, /2 places, 2 things and 3 recordings/, "names what will be lost");
  assert.match(text, /1 place, 2 things and 7 recordings/, "names what the file has");
  await dialog.getByRole("button", { name: "Replace everything" }).click();
  await until(page, () => window.F2.calls.some((c) => c[0] === "share.importReplacing"));
  const undo = page.locator("kf-settings").getByRole("button", { name: "Undo import" });
  await undo.waitFor();
  await undo.click();
  await until(page, () => window.F2.calls.some((c) => c[0] === "share.undoImport"));
});

test("settings: a rejected import file shows a message and changes nothing", async () => {
  const page = await open("kf-settings", { opts: { share: { importError: "newer" } } });
  await page.setInputFiles('kf-settings input[type="file"]', { name: "farm.zip", mimeType: "application/zip", buffer: Buffer.from([1, 2, 3]) });
  await page.locator("kf-settings").getByText(/newer version/).waitFor();
  assert.ok(!(await calls(page)).includes("share.importReplacing"));
  assert.equal(await page.getByRole("alertdialog").count(), 0);
});

test("settings: delete all data confirms, wipes and reloads", async () => {
  const page = await open("kf-settings");
  await page.evaluate(() => { document.querySelector("kf-settings").reload = () => window.F2.log("reload"); });
  await page.getByRole("button", { name: "Delete all data" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Delete everything" }).click();
  await until(page, () => window.F2.calls.some((c) => c[0] === "reload"));
  const order = await calls(page);
  assert.ok(order.indexOf("storage.deleteAllData") < order.indexOf("reload"));
});

test("settings: persistence warning only when requestPersist() is false", async () => {
  const denied = await open("kf-settings", { opts: { storage: { persist: false } } });
  await denied.locator("kf-settings .kf-warning").getByText(/export/i).waitFor();
  const granted = await open("kf-settings", { opts: { storage: { persist: true } } });
  await granted.locator("kf-settings").getByText(/kept safely/i).waitFor();
  assert.equal(await granted.locator("kf-settings .kf-warning").count(), 0);
});

test("settings: Update ready only when services.updateReady", async () => {
  const plain = await open("kf-settings");
  await plain.locator("kf-settings").getByLabel("Sleep timer").waitFor();
  assert.equal(await plain.getByRole("button", { name: "Update now" }).count(), 0);
  const ready = await open("kf-settings", { opts: { updateReady: true } });
  await ready.getByRole("button", { name: "Update now" }).click();
  await until(ready, () => window.F2.calls.some((c) => c[0] === "storage.applyUpdate"));
});

test("settings: privacy statement and Guided Access guide are there", async () => {
  const page = await open("kf-settings");
  const s = page.locator("kf-settings");
  await s.getByText("Privacy", { exact: true }).click();
  await s.getByText(/stays on this iPad/).waitFor();
  await s.getByText(/Guided Access/).first().click();
  await s.getByText(/triple-click/i).first().waitFor();
});

// ---------------------------------------------------------------- kf-welcome

test("welcome: hold-to-edit tip, persistence request on dismiss, welcomed set, no microphone", async () => {
  const snapshot = farmAndSea();
  snapshot.settings.welcomed = false;
  const page = await open(null, { snapshot });
  await page.evaluate(() => {
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = async () => { window.F2.log("getUserMedia"); throw new Error("no"); };
  });
  await page.evaluate(() => window.F2.mount("kf-welcome"));
  const card = page.locator("kf-welcome");
  await card.getByText(/hold/i).first().waitFor();
  assert.match(await card.textContent(), /1\.5 s/);
  assert.match(await card.textContent(), /together/i);
  await assertAccessible(page, "kf-welcome");
  assert.ok(!(await calls(page)).includes("storage.requestPersist"), "asks only on dismiss");

  await card.getByRole("button", { name: "Start playing" }).click();
  await until(page, () => window.services.store.settings.welcomed === true);
  await until(page, () => window.F2.calls.some((c) => c[0] === "kf-close"));
  const all = await calls(page);
  assert.ok(all.includes("storage.requestPersist"));
  assert.ok(!all.includes("getUserMedia"));
  assert.deepEqual(page.errors, []);
});
