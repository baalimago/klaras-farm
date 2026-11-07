// The wrapping paper (web/js/gift/), mounted alone on a page, and once through the real app:
// it covers the page, a poke makes a hole, a pull tears along its direction, enough pulls open it
// and the page underneath is free; Enter opens it; a rotation keeps the tears; it fails open.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, ROOT } from "./harness.js";

const SHOTS = join(ROOT, "tests/browser/.shots");
let h;

before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

/** A page with a button under the paper, and the paper on it. */
async function wrapped(options = {}) {
  const page = await h.modulePage('<button id="under" style="position:fixed;left:40px;top:40px;width:120px;height:80px">under</button>');
  await page.evaluate(async (opts) => {
    const { wrap } = await import("./js/gift/wrapper.js");
    window.__clicks = 0;
    document.getElementById("under").addEventListener("click", () => window.__clicks++);
    window.__opened = 0;
    window.__w = wrap({ seed: 7, sound: false, ...opts, onOpen: () => window.__opened++ });
  }, options);
  return page;
}

/** Is the paper still there (not torn away) at this point? Reads the paper canvas's alpha. */
const paperAt = (page, x, y) => page.evaluate(([x, y]) => {
  const c = document.querySelector(".gift-wrap canvas");
  const d = c.width / innerWidth;
  return c.getContext("2d").getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data[3] > 0;
}, [x, y]);

async function pull(page, from, to, steps = 20) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  await page.mouse.up();
}

test("the paper covers the whole page and takes its taps", async () => {
  const page = await wrapped();
  const box = await page.locator(".gift-wrap").boundingBox();
  assert.deepEqual(box, { x: 0, y: 0, width: 1180, height: 820 });
  assert.equal(await page.evaluate(() => document.elementFromPoint(60, 60).closest(".gift-wrap") !== null), true);
  assert.equal(await page.getAttribute(".gift-wrap", "role"), "button");
  assert.match(await page.getAttribute(".gift-wrap", "aria-label"), /Drag to tear/);
  assert.equal(await paperAt(page, 300, 300), true);
  await page.screenshot({ path: join(SHOTS, "gift-wrapped.png") }).catch(() => {});
  assert.deepEqual(page.errors, []);
});

test("a poke makes a hole under the finger at once", async () => {
  const page = await wrapped();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  assert.equal(await paperAt(page, 300, 300), false, "a hole before the finger moves or lifts");
  assert.equal(await paperAt(page, 300, 450), true);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__w.phase), "wrapped");
});

test("the paper tears along the pull, in any direction", async () => {
  for (const [from, to, beside] of [
    [[150, 200], [900, 200], [500, 400]], // right
    [[1000, 650], [250, 650], [600, 450]], // left
    [[900, 100], [900, 750], [700, 400]], // down
    [[200, 750], [700, 150], [700, 650]], // up and right
  ]) {
    const page = await wrapped({ openAt: 1, openAfterTears: 99 });
    await pull(page, from, to);
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    assert.equal(await paperAt(page, ...mid), false, `torn along ${from} → ${to}`);
    assert.equal(await paperAt(page, to[0] - Math.sign(to[0] - from[0]) * 30, to[1] - Math.sign(to[1] - from[1]) * 30), false, "up to the finger");
    assert.equal(await paperAt(page, ...beside), true, "the paper beside the pull is still there");
    assert.deepEqual(page.errors, []);
  }
});

test("enough pulls open it: it falls away, the page underneath works, onOpen runs once", async () => {
  const page = await wrapped({ openAt: 0.35 });
  await pull(page, [100, 150], [1100, 180]);
  await pull(page, [1100, 420], [80, 400]);
  assert.equal(await page.evaluate(() => window.__w.phase), "wrapped", "two pulls are not enough");
  await page.screenshot({ path: join(SHOTS, "gift-torn.png") }).catch(() => {});
  await pull(page, [100, 650], [1100, 680]);
  assert.equal(await page.evaluate(() => window.__w.phase), "opening");
  // While it falls away, the page already takes taps.
  await page.mouse.click(100, 80);
  assert.equal(await page.evaluate(() => window.__clicks), 1);
  await page.evaluate(() => window.__w.opened);
  assert.equal(await page.locator(".gift-wrap").count(), 0);
  assert.equal(await page.evaluate(() => window.__opened), 1);
  assert.equal(await page.evaluate(() => window.__w.phase), "open");
  assert.deepEqual(page.errors, []);
});

test("a child who only pokes gets it open too", async () => {
  const page = await wrapped({ openAfterTears: 4 });
  for (const [x, y] of [[200, 200], [400, 600], [800, 300], [1000, 700]]) await page.mouse.click(x, y);
  await page.evaluate(() => window.__w.opened);
  assert.equal(await page.locator(".gift-wrap").count(), 0);
});

test("only the primary pointer tears: a second finger does nothing", async () => {
  const page = await wrapped();
  await page.evaluate(() => {
    const root = document.querySelector(".gift-wrap");
    const at = (type, id, primary, x, y) => root.dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: primary, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }));
    at("pointerdown", 5, false, 500, 500);
    at("pointermove", 5, false, 800, 500);
    at("pointerup", 5, false, 800, 500);
  });
  assert.equal(await paperAt(page, 500, 500), true);
  assert.equal(await page.evaluate(() => window.__w.state.tears), 0);
});

test("Enter opens it from a keyboard", async () => {
  const page = await wrapped();
  await page.focus(".gift-wrap");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__w.opened);
  assert.equal(await page.locator(".gift-wrap").count(), 0);
});

test("a rotation keeps the tears where they were", async () => {
  const page = await wrapped({ openAt: 1, openAfterTears: 99 });
  await pull(page, [100, 410], [1080, 410]);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForFunction(() => window.__w.w === 820);
  assert.equal(await paperAt(page, 410, 590), false, "the tear moved with the screen");
  assert.equal(await paperAt(page, 410, 150), true);
});

test("wrapOn wraps only on its day; destroy removes it at once", async () => {
  const page = await h.modulePage();
  const r = await page.evaluate(async () => {
    const { wrapOn } = await import("./js/gift/wrapper.js");
    const off = wrapOn("11-07", { today: new Date(2026, 10, 8), sound: false });
    const on = wrapOn("11-07", { today: new Date(2030, 10, 7), sound: false });
    const count = document.querySelectorAll(".gift-wrap").length;
    on.destroy();
    await on.opened;
    return { off, on: !!on, count, after: document.querySelectorAll(".gift-wrap").length };
  });
  assert.deepEqual(r, { off: null, on: true, count: 1, after: 0 });
});

test("it fails open: with no canvas, the page is never covered", async () => {
  const page = await h.modulePage();
  const r = await page.evaluate(async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const { wrap } = await import("./js/gift/wrapper.js");
    const w = wrap({ sound: false });
    await w.opened;
    return { phase: w.phase, count: document.querySelectorAll(".gift-wrap").length };
  });
  assert.deepEqual(r, { phase: "open", count: 0 });
});

// ---------------------------------------------------------------- the real app

test("Klara's Farm: ?flag=wrap:always wraps the farm, and tearing it open reveals the board", async () => {
  const page = await h.newPage();
  assert.equal(await page.locator(".gift-wrap").count(), 0, "automated browsers get no paper by default");
  await page.goto(h.server.url + "/?flag=wrap:always");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const paper = page.locator(".gift-wrap");
  assert.equal(await paper.count(), 1);
  assert.match(await paper.getAttribute("aria-label"), /birthday/i);
  await page.screenshot({ path: join(SHOTS, "gift-farm.png") }).catch(() => {});
  for (const y of [150, 410, 680]) await pull(page, [80, y], [1100, y + 20]);
  await page.waitForFunction(() => !document.querySelector(".gift-wrap"));
  assert.equal(await page.evaluate(() => document.elementFromPoint(590, 410)?.closest("kf-board, .parent-layer *") !== null), true);
  assert.deepEqual(page.errors, []);
});
