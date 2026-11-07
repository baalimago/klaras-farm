// <kf-scene-tools> use cases, the element mounted alone over a stub board (tests/browser/stubs/f2-stubs.js)
// with a real FarmStore and the real confirm dialog. After each interaction the screen is checked
// against the state: the active tool, the selection outline, the open sheet, the store.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup } from "./harness.js";
import { aSnapshot, aPlace, aThing, square } from "../builders.js";

const STUBS = join(import.meta.dirname, "stubs/f2-stubs.js");
let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

// Board stub rect: where the real stage puts the board in scene mode at 1180 × 820 (main.css
// .stage[data-mode="scene"]: room for the rail on the left and the options column on the right).
const B = { left: 112, top: 102, width: 820, height: 615 };
const BOARD = B;
// And at 820 × 1180 (portrait: the rail on top, the options band below).
const PORTRAIT = { left: 16, top: 191, width: 788, height: 591 };
const toClient = ([x, y]) => [B.left + x * B.width, B.top + y * B.height];

function farm() {
  return aSnapshot()
    .withPlace(
      aPlace({ id: "farm", name: "Farm" })
        .withPiece({ id: "barn", kind: "shape", color: "red", stroke: square(0.2, 0.5, 0.05) })
        .withPiece({ id: "sun", kind: "shape", color: "yellow", stroke: square(0.8, 0.2, 0.05) })
        .withThing(aThing({ id: "pig" })),
    )
    .build();
}

async function open({ snapshot = farm(), drawPad = true, viewport = { width: 1180, height: 820 }, B = BOARD } = {}) {
  const page = await h.modulePage('<div id="parent-layer" class="parent-layer"></div>');
  await page.setViewportSize(viewport);
  await page.addScriptTag({ path: STUBS });
  await page.evaluate(async ({ snapshot, drawPad, B }) => { await window.F2.boot(snapshot, { mode: "scene", drawPad, boardRect: B }); }, { snapshot, drawPad, B });
  await page.evaluate(async () => { await window.F2.mount("kf-scene-tools", {}); });
  await page.locator("kf-scene-tools").getByRole("button", { name: "Shape" }).waitFor();
  return page;
}

const tools = (page) => page.locator("kf-scene-tools");
const place = (page) => page.evaluate(() => structuredClone(window.services.store.currentPlace));
const pieceById = async (page, id) => (await place(page)).pieces.find((p) => p.id === id);
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 });
const chimes = (page) => page.evaluate(() => window.F2.calls.filter((c) => c[0] === "audio.chime").map((c) => c[1]));
const pressed = (page) => tools(page).locator('.kf-st-tool[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.dataset.tool));
const selectedShown = (page) => page.evaluate(() => document.querySelectorAll("kf-scene-tools .kf-st-selected").length === 1);

async function assertAccessible(page) {
  const bad = await page.evaluate(() => window.F2.unnamed(document.querySelector("kf-scene-tools")));
  assert.deepEqual(bad, [], "controls without an accessible name");
  const small = await page.evaluate(() => window.F2.smallTargets(document.querySelector("kf-scene-tools")));
  assert.deepEqual(small, [], "targets under 44 px");
}

async function drag(page, from, to, steps = 8) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.mouse.up();
}

test("tool bar: one tool is active at a time, shapes and lines are drawn with their felt colour, Done leaves", async () => {
  const page = await open();
  await assertAccessible(page);
  assert.deepEqual(await pressed(page), ["shape"]);
  for (const name of ["Shape", "Line", "Move", "Colour", "Sky", "Ground", "Delete", "Start", "Undo"]) {
    assert.equal(await tools(page).getByRole("button", { name, exact: true }).count(), 1, name);
  }
  await tools(page).locator('kf-draw-pad[mode="shape"]').waitFor();
  await page.evaluate(() => document.querySelector("kf-draw-pad").stroke([[0.4, 0.6], [0.5, 0.6], [0.5, 0.7], [0.4, 0.7]]));
  await until(page, () => window.services.store.currentPlace.pieces.length === 3);
  assert.equal((await place(page)).pieces[2].color, "yellow");

  await tools(page).getByRole("button", { name: "Line", exact: true }).click();
  assert.deepEqual(await pressed(page), ["line"]);
  await tools(page).locator('kf-draw-pad[mode="yarn"]').waitFor();
  await page.evaluate(() => document.querySelector("kf-draw-pad").stroke([[0.1, 0.8], [0.4, 0.8], [0.7, 0.75]]));
  await until(page, () => window.services.store.currentPlace.pieces.length === 4);
  const line = (await place(page)).pieces[3];
  assert.equal(line.kind, "yarn");
  assert.equal(line.color, "brown");

  await tools(page).getByRole("button", { name: "Done", exact: true }).click();
  const calls = await page.evaluate(() => window.F2.calls.map((c) => c[0]));
  assert.ok(calls.includes("session.sceneDone"));
  assert.deepEqual(await chimes(page), ["add", "tool", "add", "save"]);
  assert.deepEqual(page.errors, []);
});

test("colour picker: on top of the drawing canvas, which is paused while it is open", async () => {
  const page = await open({ drawPad: false }); // the real kf-draw-pad, a fixed overlay over the board
  const pad = tools(page).locator('kf-draw-pad[mode="shape"]');
  await pad.waitFor();
  await tools(page).getByRole("button", { name: /Felt colour: Yellow/ }).click();
  const sheet = page.getByRole("dialog", { name: "Shape colour" });
  await sheet.waitFor();
  // Every swatch is the topmost element at its centre: nothing of the canvas is above the picker.
  const covered = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll(".kf-st-sheet .kf-swatch")) {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top !== b) out.push(`${b.dataset.color} under ${top?.tagName}`);
    }
    return out;
  });
  assert.deepEqual(covered, []);
  assert.ok(await page.evaluate((B) => {
    const r = document.querySelector(".kf-st-sheet").getBoundingClientRect();
    return r.left >= B.left + B.width && r.right <= innerWidth && r.top >= B.top - 1;
  }, B), "the sheet sits in the options column, right of the board");
  assert.equal(await page.evaluate(() => document.querySelector(".kf-st-stage").inert), true, "the canvas takes no input");
  // A stroke attempted on the board while picking draws nothing.
  await drag(page, toClient([0.45, 0.3]), toClient([0.6, 0.35]), 12);
  assert.equal((await place(page)).pieces.length, 2);

  await sheet.getByRole("button", { name: "Red" }).click();
  await sheet.waitFor({ state: "hidden" });
  assert.equal(await pad.getAttribute("color"), "red");
  assert.equal(await page.evaluate(() => document.querySelector(".kf-st-stage").inert), false, "drawing again after picking");
  // A closed loop drawn with the finger becomes a red felt shape.
  const c = toClient([0.5, 0.35]);
  await page.mouse.move(c[0] + 60, c[1]);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    await page.mouse.move(c[0] + 60 * Math.cos(a), c[1] + 60 * Math.sin(a));
  }
  await page.mouse.up();
  await until(page, () => window.services.store.currentPlace.pieces.length === 3);
  assert.equal((await place(page)).pieces[2].color, "red");
  assert.ok((await chimes(page)).includes("colour"));
  assert.deepEqual(page.errors, []);
});

/** Controls in either toolbar whose box reaches into the board (none may: they frame it). */
const overBoard = (page, board = B) => page.evaluate((B) => {
  const out = [];
  for (const el of document.querySelectorAll("kf-scene-tools .kf-st-left *, kf-scene-tools .kf-st-right *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > B.left && r.left < B.left + B.width && r.bottom > B.top && r.top < B.top + B.height) out.push(el.className || el.tagName);
  }
  return out;
}, board);

/** Points just inside the board's edges where a press lands on something other than the board. */
const edgeMisses = (page, board = B) => page.evaluate((B) => {
  const out = [];
  const pts = [];
  for (const f of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    pts.push([B.left + 2, B.top + f * B.height], [B.left + B.width - 2, B.top + f * B.height]);
    pts.push([B.left + f * B.width, B.top + 2], [B.left + f * B.width, B.top + B.height - 2]);
  }
  for (const [x, y] of pts) {
    const el = document.elementFromPoint(x, y);
    if (!el?.closest(".kf-st-stage")) out.push(`${Math.round(x)},${Math.round(y)}: ${el?.className || el?.tagName}`);
  }
  return out;
}, board);

test("toolbars frame the board: the rail left, the tool's options right, never over a piece", async () => {
  // A piece in the board's top-left corner, where the options used to pop out over the scene.
  const corner = aSnapshot()
    .withPlace(aPlace({ id: "farm", name: "Farm" }).withPiece({ id: "cloud", kind: "shape", color: "white", stroke: square(0.12, 0.2, 0.06) }))
    .build();
  const page = await open({ snapshot: corner });
  const rail = await tools(page).locator(".kf-st-rail").boundingBox();
  const right = await tools(page).locator(".kf-st-right").boundingBox();
  assert.ok(rail.x + rail.width <= B.left, "the rail is left of the board");
  assert.ok(right.x >= B.left + B.width - 16, "the options column is right of the board");
  const options = await tools(page).locator(".kf-st-options").boundingBox();
  assert.ok(options.x >= B.left + B.width, "the options sit right of the board");
  assert.deepEqual(await edgeMisses(page), [], "a press at the board's very edge lands on the board");
  assert.ok(Math.abs(right.y + 16 - B.top) <= 1, "the options start level with the board's top");
  assert.deepEqual(await overBoard(page), [], "Shape");
  for (const name of ["Line", "Move", "Colour", "Sky", "Ground", "Delete"]) {
    await tools(page).getByRole("button", { name, exact: true }).click();
    assert.deepEqual(await overBoard(page), [], name);
  }
  // Move: the piece in the corner is selected and dragged; its options show beside the board.
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  await drag(page, toClient([0.12, 0.2]), toClient([0.3, 0.3]));
  await until(page, () => window.services.store.currentPlace.pieces[0].stroke[0][0] > 0.2);
  await tools(page).getByRole("button", { name: "Change colour" }).waitFor();
  assert.deepEqual(await overBoard(page), [], "Move with a selection");
  const done = await tools(page).getByRole("button", { name: "Done" }).boundingBox();
  assert.ok(Math.abs(done.y + done.height - (B.top + B.height)) <= 2 && done.x >= B.left + B.width, "Done sits bottom right, level with the board's bottom");
  // Foreground rule: both toolbars stack above the drawing canvas (kf-draw-pad's overlay is z 5).
  const z = await page.evaluate(() => [".kf-st-left", ".kf-st-right"].map((q) => Number(getComputedStyle(document.querySelector(q)).zIndex)));
  assert.ok(z.every((n) => n > 5), `toolbars above the draw pad (${z})`);
  // A sheet takes the options' place in the column: no hint, no options behind it, still beside the board.
  await tools(page).getByRole("button", { name: "Change colour" }).click();
  await page.getByRole("dialog", { name: "Piece colour" }).waitFor();
  assert.equal(await tools(page).locator(".kf-st-hint").isHidden(), true);
  assert.equal(await tools(page).getByRole("button", { name: "Let go" }).count(), 0);
  assert.deepEqual(await overBoard(page), [], "the colour sheet");
  await tools(page).getByRole("button", { name: "Close" }).click();
  await tools(page).getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("dialog", { name: "Start from" }).waitFor();
  assert.deepEqual(await overBoard(page), [], "the Start sheet");
  await assertAccessible(page);
  assert.deepEqual(page.errors, []);
});

test("portrait: the rail runs along the top and the options fill a band below, never over the board", async () => {
  const page = await open({ viewport: { width: 820, height: 1180 }, B: PORTRAIT });
  assert.equal(await tools(page).locator(".kf-st-rail").getAttribute("aria-orientation"), "horizontal");
  const rail = await tools(page).locator(".kf-st-rail").boundingBox();
  assert.ok(rail.y + rail.height <= PORTRAIT.top && rail.y >= 0, "the rail is above the board");
  for (const name of ["Shape", "Line", "Move", "Colour", "Sky", "Ground", "Delete"]) {
    await tools(page).getByRole("button", { name, exact: true }).click();
    assert.deepEqual(await overBoard(page, PORTRAIT), [], name);
  }
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  const [x, y] = [PORTRAIT.left + 0.2 * PORTRAIT.width, PORTRAIT.top + 0.5 * PORTRAIT.height];
  await page.mouse.click(x, y);
  await tools(page).getByRole("button", { name: "Change colour" }).click();
  await page.getByRole("dialog", { name: "Piece colour" }).waitFor();
  assert.deepEqual(await overBoard(page, PORTRAIT), [], "the piece sheet");
  await tools(page).getByRole("button", { name: "Close" }).click();
  assert.deepEqual(await edgeMisses(page, PORTRAIT), [], "a press at the board's very edge lands on the board");
  await tools(page).getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("dialog", { name: "Start from" }).waitFor();
  assert.deepEqual(await overBoard(page, PORTRAIT), [], "the Start sheet");
  const done = await tools(page).getByRole("button", { name: "Done" }).boundingBox();
  assert.ok(done.y >= PORTRAIT.top + PORTRAIT.height && done.y + done.height <= 1180 && done.x + done.width <= 820, "Done is below the board, on screen");
  await assertAccessible(page);
  // Split View (a narrow portrait): the rail scrolls sideways inside the screen, Undo can be reached.
  await page.setViewportSize({ width: 590, height: 1180 });
  const narrow = await tools(page).locator(".kf-st-rail").boundingBox();
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 590, `the rail stays on screen (${narrow.x}, ${narrow.width})`);
  await tools(page).getByRole("button", { name: "Undo" }).scrollIntoViewIfNeeded();
  const undo = await tools(page).getByRole("button", { name: "Undo" }).boundingBox();
  assert.ok(undo.x >= 0 && undo.x + undo.width <= 590, "Undo scrolls into reach");
  assert.deepEqual(page.errors, []);
});

test("colour one piece after another: the sheet beside the board follows the next tapped piece", async () => {
  const page = await open();
  await tools(page).getByRole("button", { name: "Colour", exact: true }).click();
  await page.mouse.click(...toClient([0.8, 0.2])); // the sun
  const sheet = page.getByRole("dialog", { name: "Piece colour" });
  await sheet.waitFor();
  assert.equal(await page.evaluate(() => document.querySelector(".kf-st-stage").inert), false, "the board stays live");
  assert.equal(await tools(page).getByRole("button", { name: "Done" }).isVisible(), true, "Done stays in reach");
  await sheet.getByRole("button", { name: "Blue" }).click();
  await until(page, () => window.services.store.currentPlace.pieces.find((p) => p.id === "sun").color === "blue");
  await page.mouse.click(...toClient([0.2, 0.5])); // the barn, while the sheet is open
  await until(page, () => document.querySelector(".kf-st-sheet [aria-pressed=true]")?.dataset.color === "red");
  assert.equal(await selectedShown(page), true);
  await sheet.getByRole("button", { name: "Pink" }).click();
  await until(page, () => window.services.store.currentPlace.pieces.find((p) => p.id === "barn").color === "pink");
  assert.equal((await pieceById(page, "sun")).color, "blue", "the first piece keeps its colour");
  // Sky: the sheet leaves the board clear, so the new sky shows as it lands.
  await tools(page).getByRole("button", { name: "Sky", exact: true }).click();
  await page.getByRole("dialog", { name: "Sky colour" }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector(".kf-st-stage").classList.contains("paused")), false);
  // The felt colour sheet of Shape still pauses the board, under a wash.
  await tools(page).getByRole("button", { name: "Shape", exact: true }).click();
  await tools(page).getByRole("button", { name: /Felt colour/ }).click();
  await page.getByRole("dialog", { name: "Shape colour" }).waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".kf-st-stage"), "::after").content), '""', "a wash over the paused board");
  assert.deepEqual(page.errors, []);
});

test("move: a drawn felt shape follows the pointer exactly and is saved once, on release", async () => {
  const page = await open();
  await page.evaluate(() => document.querySelector("kf-draw-pad").stroke([[0.45, 0.6], [0.55, 0.6], [0.55, 0.7], [0.45, 0.7]]));
  await until(page, () => window.services.store.currentPlace.pieces.length === 3);
  const id = (await place(page)).pieces[2].id;
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  await page.evaluate(() => {
    window.__writes = 0;
    window.services.store.addEventListener("change", () => window.__writes++);
  });
  const from = toClient([0.5, 0.65]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from[0] + i * 9, from[1] - i * 6);
    const lift = await page.evaluate(() => window.services.board.lifts.at(-1));
    assert.ok(Math.abs(lift.dx - (i * 9) / B.width) < 1e-9 && Math.abs(lift.dy + (i * 6) / B.height) < 1e-9, `lift ${i} is exactly the pointer delta`);
  }
  assert.equal(await page.evaluate(() => window.__writes), 0, "nothing is written while dragging");
  await page.mouse.up();
  await until(page, () => window.__writes === 1);
  const moved = await pieceById(page, id);
  assert.ok(Math.abs(moved.stroke[0][0] - (0.45 + 90 / B.width)) < 0.0011);
  assert.ok(Math.abs(moved.stroke[0][1] - (0.6 - 60 / B.height)) < 0.0011);
  await until(page, () => window.services.board.lifts.at(-1) === null);
  assert.equal(await selectedShown(page), true, "the moved piece stays selected");
  assert.deepEqual((await chimes(page)).slice(-3), ["tool", "select", "drop"]);
  assert.deepEqual(page.errors, []);
});

test("selection: tapping empty board keeps it; another piece or Let go changes it", async () => {
  const page = await open();
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  const [bx, by] = toClient([0.2, 0.5]);
  await page.mouse.click(bx, by);
  assert.equal(await selectedShown(page), true);
  await tools(page).getByText("This piece:").waitFor();
  const [ex, ey] = toClient([0.55, 0.85]);
  await page.mouse.click(ex, ey); // tap-away
  await page.mouse.click(ex - 100, ey - 80);
  assert.equal(await selectedShown(page), true, "still selected after tapping empty board");
  // Switching tool keeps it: Colour opens its colour sheet at once.
  await tools(page).getByRole("button", { name: "Colour", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Piece colour" });
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "Blue" }).click();
  await until(page, () => window.services.store.currentPlace.pieces[0].color === "blue");
  assert.equal(await sheet.getByRole("button", { name: "Blue" }).getAttribute("aria-pressed"), "true", "the sheet shows the new colour");
  await sheet.getByRole("button", { name: "Close" }).click();
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  const [sx, sy] = toClient([0.8, 0.2]);
  await page.mouse.click(sx, sy);
  const outline = await page.evaluate(() => document.querySelector(".kf-st-selected").getAttribute("d"));
  assert.match(outline, /^M0\.75/, "the sun is selected now");
  await tools(page).getByRole("button", { name: "Let go" }).click();
  assert.equal(await selectedShown(page), false);
  assert.deepEqual(page.errors, []);
});

test("resize with the handle, send to back, sky and ground, start from a template, undo each step", async () => {
  const page = await open();
  const t = tools(page);
  await t.getByRole("button", { name: "Move", exact: true }).click();
  const [sx, sy] = toClient([0.8, 0.2]);
  await page.mouse.click(sx, sy);
  const handle = t.getByRole("button", { name: /Resize/ });
  await handle.waitFor();
  const hb = await handle.boundingBox();
  const hc = [hb.x + hb.width / 2, hb.y + hb.height / 2];
  const centre = toClient([0.8, 0.2]);
  // Drag the handle to twice its distance from the centre: the sun doubles.
  await drag(page, hc, [centre[0] + (hc[0] - centre[0]) * 2, centre[1] + (hc[1] - centre[1]) * 2]);
  await until(page, () => {
    const s = window.services.store.currentPlace.pieces[1].stroke;
    return Math.abs(s[1][0] - s[0][0] - 0.2) < 0.003;
  });
  const lifts = await page.evaluate(() => window.services.board.lifts.filter(Boolean));
  assert.ok(Math.abs(lifts.at(-1).s - 2) < 0.02, `scale ${lifts.at(-1).s}`);

  await t.getByRole("button", { name: "To back" }).click();
  await until(page, () => window.services.store.currentPlace.pieces[0].id === "sun");
  assert.equal(await t.getByRole("button", { name: "To back" }).isDisabled(), true);

  await t.getByRole("button", { name: "Sky", exact: true }).click();
  await page.getByRole("dialog", { name: "Sky colour" }).getByRole("button", { name: "Lilac" }).click();
  await until(page, () => window.services.store.currentPlace.skyColor === "lilac");
  await t.getByRole("button", { name: "Ground", exact: true }).click();
  await page.getByRole("dialog", { name: "Ground colour" }).getByRole("button", { name: "Sand" }).click();
  await until(page, () => window.services.store.currentPlace.groundColor === "sand");

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await t.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("dialog", { name: "Start from" }).getByRole("button", { name: "Sea" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start over" }).click();
  await until(page, () => window.services.store.currentPlace.backdrop === "sea");
  const sea = await place(page);
  assert.deepEqual([sea.skyColor, sea.groundColor, sea.pieces.length], ["sky", "water", 0]);
  assert.equal(await selectedShown(page), false, "the selected piece went with the template");

  const undo = t.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await until(page, () => window.services.store.currentPlace.backdrop === "meadow" && window.services.store.currentPlace.pieces.length === 2);
  await undo.click();
  await until(page, () => window.services.store.currentPlace.groundColor === "grass");
  await undo.click();
  await until(page, () => window.services.store.currentPlace.skyColor === "sky");
  await undo.click();
  await until(page, () => window.services.store.currentPlace.pieces[0].id === "barn");
  await undo.click();
  await until(page, () => {
    const s = window.services.store.currentPlace.pieces[1].stroke;
    return Math.abs(s[1][0] - s[0][0] - 0.1) < 0.002;
  });
  assert.equal(await undo.isDisabled(), true);
  const sounds = await chimes(page);
  for (const k of ["tool", "select", "pick", "drop", "colour", "save", "undo"]) assert.ok(sounds.includes(k), `plays ${k}`);
  await assertAccessible(page);
  assert.deepEqual(page.errors, []);
});

test("delete: tap a piece and confirm; Keep it keeps it; a deleted selection is let go", async () => {
  const page = await open();
  const t = tools(page);
  await t.getByRole("button", { name: "Delete", exact: true }).click();
  const [bx, by] = toClient([0.2, 0.5]);
  await page.mouse.click(bx, by);
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep it" }).click();
  await page.locator("kf-dialog").waitFor({ state: "detached" });
  assert.equal((await place(page)).pieces.length, 2);
  assert.equal(await t.getByRole("button", { name: "Undo", exact: true }).isDisabled(), true);
  await page.mouse.click(bx, by);
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await until(page, () => window.services.store.currentPlace.pieces.length === 1);
  assert.equal(await selectedShown(page), false);
  assert.ok((await chimes(page)).includes("poof"));
});

/** Every repository write now takes `ms`, and fails while `window.__disk.fail` is set (a busy or full iPad). */
const slowDisk = (page, ms = 400) =>
  page.evaluate((ms) => {
    const repo = window.services.store.repo;
    const write = repo.write.bind(repo);
    window.__disk = { fail: false, done: 0 };
    repo.write = (w) =>
      new Promise((ok) => setTimeout(ok, ms)).then(() => {
        window.__disk.done++;
        if (window.__disk.fail) throw new Error("disk full");
        return write(w);
      });
  }, ms);

test("slow disk: quick edits and Undo show at once, without waiting for the writes", async () => {
  const page = await open();
  await slowDisk(page);
  // Three shapes in one go: each is in the store and Undo is on, in the same task as its stroke.
  const seen = await page.evaluate(() => {
    const pad = document.querySelector("kf-draw-pad");
    const undo = () => document.querySelector('kf-scene-tools [data-tool="undo"]');
    const out = [];
    for (let i = 0; i < 3; i++) {
      const x = 0.3 + i * 0.15;
      pad.stroke([[x, 0.6], [x + 0.1, 0.6], [x + 0.1, 0.7], [x, 0.7]]);
      out.push([window.services.store.currentPlace.pieces.length, undo().disabled]);
    }
    return out;
  });
  assert.deepEqual(seen, [[3, false], [4, false], [5, false]]);
  // Colour and Undo are just as quick, and the sheet shows the new colour at once.
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  const [sx, sy] = toClient([0.8, 0.2]);
  await page.mouse.click(sx, sy);
  await tools(page).getByRole("button", { name: "Colour", exact: true }).click();
  const shown = await page.evaluate(() => {
    const sun = () => window.services.store.currentPlace.pieces.find((p) => p.id === "sun");
    const undo = () => document.querySelector('kf-scene-tools [data-tool="undo"]');
    document.querySelector('.kf-st-sheet [data-color="blue"]').click();
    const out = { colour: sun().color, pressedNow: document.querySelector('.kf-st-sheet [data-color="blue"]').getAttribute("aria-pressed") };
    undo().click();
    out.undone = sun().color;
    undo().click();
    out.count = window.services.store.currentPlace.pieces.length;
    return out;
  });
  assert.deepEqual(shown, { colour: "blue", pressedNow: "true", undone: "yellow", count: 4 });
  // Every write still reaches the disk, one after another.
  await until(page, () => window.__disk.done === 6);
  assert.equal((await place(page)).pieces.length, 4);
  assert.deepEqual(page.errors, []);
});

test("slow disk: a write that fails takes its edit and its Undo step back, and says so", async () => {
  const page = await open();
  await slowDisk(page, 200);
  await page.evaluate(() => { window.__disk.fail = true; });
  const undo = tools(page).getByRole("button", { name: "Undo", exact: true });
  const shown = await page.evaluate(() => {
    document.querySelector("kf-draw-pad").stroke([[0.4, 0.6], [0.5, 0.6], [0.5, 0.7], [0.4, 0.7]]);
    return [window.services.store.currentPlace.pieces.length, document.querySelector('kf-scene-tools [data-tool="undo"]').disabled];
  });
  assert.deepEqual(shown, [3, false], "shown at once");
  await until(page, () => window.services.store.currentPlace.pieces.length === 2);
  await until(page, () => document.querySelector('kf-scene-tools [data-tool="undo"]').disabled);
  await page.locator("kf-dialog").first().waitFor();
  // The disk is back: the next edit saves and can be undone.
  await page.evaluate(() => { window.__disk.fail = false; });
  await page.evaluate(() => document.querySelector("kf-draw-pad").stroke([[0.4, 0.6], [0.5, 0.6], [0.5, 0.7], [0.4, 0.7]]));
  assert.equal(await undo.isDisabled(), false);
  await until(page, () => window.__disk.done === 2);
  assert.equal((await place(page)).pieces.length, 3);
  await undo.click();
  assert.equal((await place(page)).pieces.length, 2);
  assert.equal(await undo.isDisabled(), true);
});

test("slow disk: a dropped piece is where the finger left it at once, and its lift ends", async () => {
  const page = await open();
  await slowDisk(page);
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  const from = toClient([0.8, 0.2]);
  await drag(page, from, [from[0] - 90, from[1] + 60]);
  const sun = await pieceById(page, "sun");
  assert.ok(Math.abs(sun.stroke[0][0] - (0.75 - 90 / B.width)) < 0.0011, "moved in the store at once");
  assert.equal(await page.evaluate(() => window.services.board.lifts.at(-1)), null, "no lift left over");
  assert.equal(await tools(page).getByRole("button", { name: "Undo", exact: true }).isDisabled(), false);
  assert.deepEqual(page.errors, []);
});

test("pointer steps are guarded: a failing capture or board rect never eats the tap or the drag", async () => {
  const page = await open();
  await page.evaluate(() => {
    Element.prototype.setPointerCapture = () => { throw new DOMException("no active pointer", "NotFoundError"); };
  });
  await tools(page).getByRole("button", { name: "Move", exact: true }).click();
  const from = toClient([0.8, 0.2]);
  await drag(page, from, [from[0] - 90, from[1]]);
  const sun = await pieceById(page, "sun");
  assert.ok(Math.abs(sun.stroke[0][0] - (0.75 - 90 / B.width)) < 0.0011, "the drag still moved it");
  assert.equal(await selectedShown(page), true);
  // The board throws when asked for its rect: the stage falls back to a letterbox and taps still land.
  await page.evaluate(() => { window.services.board.boardRect = () => { throw new Error("detached"); }; });
  await tools(page).getByRole("button", { name: "Let go" }).click();
  assert.equal(await selectedShown(page), false);
  const [bx, by] = toClient([0.2, 0.5]);
  await page.mouse.click(bx, by);
  await tools(page).getByRole("button", { name: "Shape", exact: true }).click();
  assert.deepEqual(await pressed(page), ["shape"]);
  assert.deepEqual(page.errors, []);
});
