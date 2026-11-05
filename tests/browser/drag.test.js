// Dragging in the real app at iPad size and pixel ratio (1180 × 820, dpr 2, touch): a thing in edit
// mode and a felt piece in the scene tools must stay exactly under the pointer, render each frame
// cheaply (no felt repaint while moving), write the store once on release, and keep their cached
// sprite when the store catches up ("exactly" means within 0.01 px: normalised coordinates carry
// float noise of about 1e-4 px). Frame cost is the Renderer's own draw time per frame.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function ipadPage() {
  const context = await h.browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(h.server.url + "/");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 });
  await page.locator("kf-welcome").waitFor();
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.locator("kf-welcome").waitFor({ state: "detached" });
  // The onboarding tour follows the welcome card; these tests are about other things.
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page.locator("kf-tour").waitFor({ state: "detached" });
  // Time every frame the Renderer draws (the work done per display refresh).
  await page.evaluate(() => {
    const r = window.__kf.board.renderer;
    const draw = r._draw.bind(r);
    window.__frameMs = [];
    r._draw = (dt) => {
      const t0 = performance.now();
      draw(dt);
      window.__frameMs.push(performance.now() - t0);
    };
  });
  return { page, context };
}

/** Moves the mouse in `n` steps of (sx, sy), one step per animation frame, like a finger at 60 Hz. */
async function stepDrag(page, from, n, sx, sy) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(from[0] + i * sx, from[1] + i * sy);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
}

test("edit mode: a dragged thing tracks the pointer 1:1, frames stay cheap, one write on release", async () => {
  const { page, context } = await ipadPage();
  await page.evaluate(() => { window.__kf.session.holdArmed(); window.__kf.session.gatePassed(); });
  await page.locator("kf-edit-layer").waitFor();
  await page.waitForTimeout(800); // the edit wiggle settles
  const start = await page.evaluate(() => {
    const { store, board } = window.__kf;
    const thing = store.thingsIn(store.currentPlace.id)[0];
    const r = board.actorRect(thing.id);
    const a = window.__kf.engine.actorFor(thing.id);
    window.__writes = 0;
    store.addEventListener("change", () => window.__writes++);
    window.__sprite = board.renderer.entries.get(thing.id)?.sprite.canvas;
    window.__frameMs.length = 0;
    return { id: thing.id, cx: r.left + r.width / 2, cy: r.top + r.height / 2, ax: a.x, ay: a.y, rect: board.boardRect().toJSON() };
  });
  // Drag towards the middle so the drop never hits the board edge (a drop there is clamped on).
  const N = 60, SX = start.ax > 0.5 ? -4 : 4, SY = start.ay > 0.5 ? -2 : 2;
  await stepDrag(page, [start.cx, start.cy], N, SX, SY);
  const live = await page.evaluate((id) => {
    const a = window.__kf.engine.actorFor(id);
    return { x: a.x + a.pose.dx, y: a.y + a.pose.dy, writes: window.__writes, frames: window.__frameMs.slice() };
  }, start.id);
  const errX = (live.x - start.ax) * start.rect.width - N * SX;
  const errY = (live.y - start.ay) * start.rect.height - N * SY;
  assert.ok(Math.abs(errX) < 0.01 && Math.abs(errY) < 0.01, `position error before release: ${errX}, ${errY} px`);
  assert.equal(live.writes, 0, "no store writes while dragging");
  assert.ok(live.frames.length >= N * 0.8, `a frame per move (${live.frames.length})`);
  const med = median(live.frames);
  console.log(`# thing drag: ${live.frames.length} frames, median ${med.toFixed(3)} ms, max ${Math.max(...live.frames).toFixed(3)} ms`);
  assert.ok(med < 8, `median frame ${med} ms`);

  await page.mouse.up();
  await page.waitForFunction(() => window.__writes === 1);
  const after = await page.evaluate((id) => {
    const { board, engine } = window.__kf;
    const a = engine.actorFor(id);
    return { x: a.x, y: a.y, sameSprite: board.renderer.entries.get(id)?.sprite.canvas === window.__sprite, selected: document.querySelector("kf-edit-layer").selected, ring: !!document.querySelector(".kf-edit-ring") };
  }, start.id);
  const errUpX = (after.x - start.ax) * start.rect.width - N * SX;
  const errUpY = (after.y - start.ay) * start.rect.height - N * SY;
  assert.ok(Math.abs(errUpX) < 1 && Math.abs(errUpY) < 1, `position error after the store caught up: ${errUpX}, ${errUpY} px`);
  assert.equal(after.sameSprite, true, "the felt sprite is reused, not repainted, after a move");
  assert.equal(after.selected, start.id);
  assert.equal(after.ring, true);

  // Tap-away: tapping empty board keeps the dragged thing selected.
  const empty = [start.rect.left + start.rect.width * 0.5, start.rect.top + 30];
  await page.mouse.click(empty[0], empty[1]);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.querySelector("kf-edit-layer").selected), start.id);
  assert.equal(await page.locator(".kf-edit-ring").count(), 1);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test("scene tools: a dragged felt piece tracks the pointer 1:1 with cheap frames and no repaint on drop", async () => {
  const { page, context } = await ipadPage();
  await page.evaluate(() => { window.__kf.session.holdArmed(); window.__kf.session.gatePassed(); window.__kf.session.sceneTools(); });
  const tools = page.locator("kf-scene-tools");
  await tools.getByRole("button", { name: "Move", exact: true }).click();
  const start = await page.evaluate(async () => {
    const { store, board } = window.__kf;
    const place = store.currentPlace;
    await store.addPiece({ placeId: place.id, piece: { kind: "shape", color: "sun", stroke: [[0.45, 0.3], [0.55, 0.3], [0.55, 0.4], [0.45, 0.4]] } });
    const piece = store.currentPlace.pieces.at(-1);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__writes = 0;
    window.__repaints = 0;
    const r = board.renderer;
    const paint = r._paintBackground.bind(r);
    r._paintBackground = (scene) => { window.__repaints++; paint(scene); };
    store.addEventListener("change", () => window.__writes++);
    window.__sprite = r.pieceSprites.get(piece.id)?.sprite.canvas;
    window.__frameMs.length = 0;
    const rect = board.boardRect();
    return { id: piece.id, rect: rect.toJSON(), cx: rect.left + rect.width * 0.5, cy: rect.top + rect.height * 0.35, hasSprite: !!window.__sprite };
  });
  assert.equal(start.hasSprite, true, "scene pieces are cached sprites");
  const N = 50, SX = -3, SY = 4;
  await stepDrag(page, [start.cx, start.cy], N, SX, SY);
  const live = await page.evaluate(() => ({ lift: { ...window.__kf.board.renderer.lift }, writes: window.__writes, repaints: window.__repaints, frames: window.__frameMs.slice() }));
  assert.equal(live.lift.id, start.id);
  const errX = live.lift.dx * start.rect.width - N * SX;
  const errY = live.lift.dy * start.rect.height - N * SY;
  assert.ok(Math.abs(errX) < 0.01 && Math.abs(errY) < 0.01, `position error before release: ${errX}, ${errY} px`);
  assert.equal(live.writes, 0);
  assert.equal(live.repaints, 0, "no background repaint while dragging");
  const med = median(live.frames);
  console.log(`# piece drag: ${live.frames.length} frames, median ${med.toFixed(3)} ms, max ${Math.max(...live.frames).toFixed(3)} ms`);
  assert.ok(med < 8, `median frame ${med} ms`);

  await page.mouse.up();
  await page.waitForFunction(() => window.__writes === 1 && window.__kf.board.renderer.lift.id === null);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await page.evaluate((id) => {
    const { store, board } = window.__kf;
    const en = board.renderer.pieceSprites.get(id);
    return { stroke: store.currentPlace.pieces.find((p) => p.id === id).stroke, same: en?.sprite.canvas === window.__sprite, repaints: window.__repaints, x: en?.x, ox: en?.sprite.ox };
  }, start.id);
  assert.ok(Math.abs((after.stroke[0][0] - 0.45) * start.rect.width - N * SX) < 1, "saved where it was dropped");
  assert.ok(Math.abs((after.stroke[0][1] - 0.3) * start.rect.height - N * SY) < 1);
  assert.equal(after.same, true, "the piece keeps its sprite after a move");
  assert.equal(after.repaints, 0, "no background repaint on drop");
  assert.deepEqual(page.errors, []);
  await context.close();
});
