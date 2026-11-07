// Edit-mode selection and resize, per component (QA round 3 review): <kf-edit-layer> alone with a
// fake board renders its ring, handle and badges from the selection machine (edit/selection.js) and
// tells the board how each resize ends; <kf-board> alone with a real FarmStore and PlayEngine shows
// the preview within the size limits and saves exactly what it showed (a lopsided thing grabbed off
// its home included), refuses to start under a panel, and reports a failed write.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

// ---------------------------------------------------------------- <kf-edit-layer> alone

/** Mounts the layer in edit mode with two things and a fake board. window.__t = {layer, board, session, store, calls}. */
async function layerPage() {
  const page = await h.modulePage('<div id="stage"></div>');
  await page.evaluate(async () => {
    await import("./js/components/kf-edit-layer/define.js");
    const calls = [];
    const rects = { pig: new DOMRect(300, 300, 160, 120), cow: new DOMRect(700, 320, 140, 140) };
    let things = [{ id: "pig", names: { en: "Pig" } }, { id: "cow", names: { en: "Cow" } }];
    const store = Object.assign(new EventTarget(), {
      currentPlace: { id: "p" }, maxThings: 8, settings: { languages: ["en"] },
      thingsIn: () => things, canAddThing: () => true, clipsFor: () => [{ id: "c" }],
      get snapshot() { return { things }; },
      remove(id) { things = things.filter((t) => t.id !== id); this.dispatchEvent(new Event("change")); },
    });
    const board = Object.assign(new EventTarget(), {
      actorRect: (id) => rects[id] ?? null,
      // The pivot (the thing's feet) in client px, like <kf-board>.
      resizeStart: (id, x, y) => { calls.push(["start", id]); return [rects[id].left + rects[id].width / 2, rects[id].bottom]; },
      resizeTo: (x, y) => { calls.push(["to"]); return board.k; },
      resizeEnd: (commit) => { calls.push(["end", commit]); return commit ? board.k : null; },
      k: 1.5,
    });
    const session = Object.assign(new EventTarget(), {
      state: { mode: "edit", panel: null },
      openPanel: (name, params) => calls.push(["panel", name, params?.thingId]),
    });
    const layer = document.createElement("kf-edit-layer");
    layer.services = { store, board, session, engine: { settling: false }, shell: {} };
    document.getElementById("stage").append(layer);
    const tap = (thingId) => board.dispatchEvent(new CustomEvent("kf-thing-tap", { detail: { thingId } }));
    const handle = () => layer.querySelector(".kf-resize-handle");
    const pointer = (type, x, y, pointerId = 1, extra = {}) => handle().dispatchEvent(new PointerEvent(type, { pointerId, isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra }));
    window.__t = { layer, board, session, store, calls, tap, handle, pointer };
  });
  return page;
}

/** What the layer shows: its selection state, the ring, the handle and the badges. */
const view = (page) => page.evaluate(() => {
  const { layer, calls } = window.__t;
  const h = layer.querySelector(".kf-resize-handle");
  return {
    phase: layer.selection.phase, selected: layer.selected, resizing: layer.classList.contains("resizing"),
    rings: [...layer.querySelectorAll(".kf-edit-ring")].map((r) => r.dataset.thingId),
    handle: h ? { id: h.dataset.thingId, transform: h.style.transform } : null,
    badges: layer.querySelectorAll(".kf-badge").length,
    calls: calls.splice(0),
  };
});

test("layer: the first tap selects (ring and handle), a second opens the card, the pencil selects and opens it", async () => {
  const page = await layerPage();
  let v = await view(page);
  assert.equal(v.phase, "none");
  assert.deepEqual(v.rings, []);
  assert.equal(v.handle, null);
  assert.equal(v.badges, 4, "a pencil and a cross per thing");

  await page.evaluate(() => window.__t.tap("pig"));
  v = await view(page);
  assert.deepEqual([v.phase, v.selected, v.rings, v.handle?.id], ["selected", "pig", ["pig"], "pig"]);
  assert.deepEqual(v.calls, [], "no card on the first tap");

  await page.evaluate(() => window.__t.tap("pig"));
  v = await view(page);
  assert.deepEqual(v.calls, [["panel", "card", "pig"]]);

  await page.evaluate(() => window.__t.layer.querySelector('.kf-badge.pencil[data-thing-id="cow"]').click());
  v = await view(page);
  assert.deepEqual(v.calls, [["panel", "card", "cow"]]);
  assert.deepEqual([v.selected, v.rings], ["cow", ["cow"]], "the pencil's thing is selected");
  assert.deepEqual(page.errors, []);
});

test("layer: dragging the handle resizes; the handle rides the state's corner; lifting commits and the ring comes back", async () => {
  const page = await layerPage();
  await page.evaluate(() => window.__t.tap("pig"));
  const corner = await page.evaluate(() => [parseFloat(window.__t.handle().style.left), parseFloat(window.__t.handle().style.top)]);
  await view(page);
  await page.evaluate(([x, y]) => window.__t.pointer("pointerdown", x, y), corner);
  let v = await view(page);
  assert.deepEqual(v.calls, [["start", "pig"]]);
  assert.equal(v.phase, "resizing");
  assert.equal(v.resizing, true, "ring and badges hide");
  assert.equal(v.handle.transform, "");

  await page.evaluate(([x, y]) => window.__t.pointer("pointermove", x + 40, y + 20), corner);
  v = await view(page);
  assert.deepEqual(v.calls, [["to"]]);
  const pivot = [380, 420]; // the fake board's feet of pig
  const want = [(corner[0] - pivot[0]) * 0.5, (corner[1] - pivot[1]) * 0.5];
  assert.equal(v.handle.transform, `translate(${want[0]}px, ${want[1]}px)`, "the corner scaled by k about the feet");
  assert.equal(await page.evaluate(() => window.__t.layer.selection.k), 1.5);

  // Another finger changes nothing.
  await page.evaluate(([x, y]) => { window.__t.pointer("pointermove", x, y, 2); window.__t.pointer("pointerup", x, y, 2); }, corner);
  v = await view(page);
  assert.deepEqual([v.calls, v.phase], [[], "resizing"]);

  await page.evaluate(([x, y]) => window.__t.pointer("pointerup", x + 40, y + 20), corner);
  v = await view(page);
  assert.deepEqual(v.calls, [["to"], ["end", true]], "the last position counts, then one commit");
  assert.deepEqual([v.phase, v.selected, v.resizing, v.rings], ["selected", "pig", false, ["pig"]]);
  assert.equal(v.handle.transform, "", "a fresh handle at the new corner");
  // The lost capture that follows a pointerup does nothing more.
  await page.evaluate(() => window.__t.pointer("lostpointercapture", 0, 0));
  assert.deepEqual((await view(page)).calls, []);
  assert.deepEqual(page.errors, []);
});

for (const [type, label] of [["pointercancel", "a pointercancel"], ["lostpointercapture", "a lost pointer capture"]]) {
  test(`layer: ${label} puts the old size back (resizeEnd(false)) and keeps the thing selected`, async () => {
    const page = await layerPage();
    await page.evaluate(() => window.__t.tap("cow"));
    await page.evaluate(() => { window.__t.pointer("pointerdown", 860, 480); window.__t.pointer("pointermove", 900, 520); });
    await view(page);
    await page.evaluate((type) => window.__t.pointer(type, 900, 520), type);
    const v = await view(page);
    assert.deepEqual(v.calls, [["end", false]]);
    assert.deepEqual([v.phase, v.selected, v.resizing, v.rings, v.handle.transform], ["selected", "cow", false, ["cow"], ""]);
    assert.equal(v.badges, 4, "the badges are back");
    assert.deepEqual(page.errors, []);
  });
}

test("layer: deleting the resized thing, or leaving edit mode, cancels the resize", async () => {
  const page = await layerPage();
  await page.evaluate(() => { window.__t.tap("cow"); window.__t.pointer("pointerdown", 860, 480); });
  await view(page);
  await page.evaluate(() => window.__t.store.remove("cow"));
  let v = await view(page);
  assert.deepEqual(v.calls, [["end", false]]);
  assert.deepEqual([v.phase, v.rings, v.handle, v.resizing], ["none", [], null, false]);

  await page.evaluate(() => { window.__t.tap("pig"); window.__t.pointer("pointerdown", 480, 440); });
  await view(page);
  await page.evaluate(() => window.__t.layer.remove());
  v = await view(page);
  assert.deepEqual(v.calls, [["end", false]]);
  assert.equal(v.phase, "none");
  assert.deepEqual(page.errors, []);
});

test("layer: a board that cannot start a resize leaves the thing selected and the handle still", async () => {
  const page = await layerPage();
  await page.evaluate(() => { window.__t.board.resizeStart = () => null; window.__t.tap("pig"); window.__t.pointer("pointerdown", 480, 440); window.__t.pointer("pointermove", 520, 470); });
  const v = await view(page);
  assert.deepEqual([v.phase, v.resizing, v.handle.transform, v.calls], ["selected", false, "", []]);
  assert.deepEqual(page.errors, []);
});

// ---------------------------------------------------------------- <kf-board> alone (real store and engine)

/** Mounts the board in edit mode on an empty scene. window.__t = {store, engine, session, board, shell}. */
async function boardPage() {
  const page = await h.modulePage('<main id="stage" class="stage" data-mode="edit"></main>');
  await page.evaluate(async () => {
    const [{ FarmStore }, { MemoryRepo }, { loadStarter }, { PlayEngine }] = await Promise.all([
      import("./js/farm-store.js"), import("./js/io/memory-repo.js"), import("./js/io/starter.js"), import("./js/play-engine.js"),
    ]);
    await import("./js/components/kf-board/define.js");
    let n = 0;
    const env = { now: () => new Date().toISOString(), rng: Math.random, newId: () => `id-${++n}`, deviceId: "test" };
    const store = new FarmStore(new MemoryRepo(), env, "test");
    await store.hydrate();
    await store.replaceAll(await loadStarter(env, "en-GB"), []);
    for (const t of store.thingsIn(store.currentPlace.id)) await store.deleteThing({ thingId: t.id });
    const engine = new PlayEngine({ store, audio: {}, presets: {} });
    engine.setMode("edit");
    const session = Object.assign(new EventTarget(), { state: { mode: "edit", panel: null }, holdStart() {} });
    const toasts = [];
    const shell = { toast: (m) => toasts.push(m) };
    const board = document.createElement("kf-board");
    document.getElementById("stage").append(board);
    board.connect({ store, engine, session, audio: { unlock() {} }, shell });
    const add = async (outline) => {
      await store.addThing({ placeId: store.currentPlace.id, outline, color: "pink", names: { en: "x" } });
      return store.thingsIn(store.currentPlace.id).at(-1).id;
    };
    const frames = (k) => new Promise((r) => { const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    window.__t = { store, engine, session, board, shell, toasts, add, frames };
  });
  return page;
}

const SQUARE = [[0.4, 0.5], [0.52, 0.5], [0.52, 0.66], [0.4, 0.66]];
// An L: its centroid (the actor's anchor) is far from its box's bottom centre (the feet).
const LOPSIDED = [[0.36, 0.42], [0.56, 0.42], [0.56, 0.47], [0.41, 0.47], [0.41, 0.62], [0.36, 0.62]];

test("board: no resize under a panel or outside edit mode; a cancel puts the old size back with no write", async () => {
  const page = await boardPage();
  const out = await page.evaluate(async (sq) => {
    const { add, board, session, engine, store } = window.__t;
    const id = await add(sq);
    const r = board.actorRect(id);
    session.state = { mode: "edit", panel: { name: "card" } };
    const underPanel = board.resizeStart(id, r.right, r.bottom);
    session.state = { mode: "play", panel: null };
    const inPlay = board.resizeStart(id, r.right, r.bottom);
    session.state = { mode: "edit", panel: null };
    const held = engine.held;
    let writes = 0;
    store.addEventListener("change", () => writes++);
    const pivot = board.resizeStart(id, r.right, r.bottom);
    const twice = board.resizeStart(id, r.right, r.bottom);
    board.resizeTo(r.right + 60, r.bottom);
    const k = engine.actorFor(id).scale;
    const end = board.resizeEnd(false);
    const back = board.actorRect(id);
    return { underPanel, inPlay, held, pivot: !!pivot, twice, k, end, writes, same: [back.left - r.left, back.width - r.width], scale: engine.actorFor(id).scale, resizing: board.resizing };
  }, SQUARE);
  assert.equal(out.underPanel, null, "a panel is open");
  assert.equal(out.inPlay, null, "play mode");
  assert.equal(out.held, null, "nothing picked up");
  assert.equal(out.pivot, true);
  assert.equal(out.twice, null, "one resize at a time");
  assert.ok(out.k > 1);
  assert.equal(out.end, null);
  assert.equal(out.writes, 0);
  assert.equal(out.scale, 1);
  assert.ok(Math.abs(out.same[0]) < 1e-6 && Math.abs(out.same[1]) < 1e-6, "drawn at its old size");
  assert.equal(out.resizing, null);
  assert.deepEqual(page.errors, []);
});

test("board: mid-drag the preview never passes the size limits", async () => {
  const page = await boardPage();
  const out = await page.evaluate(async (sq) => {
    const { add, board, engine, store } = window.__t;
    const { thingSize, THING_SCALE_MIN, THING_SCALE_MAX } = await import("./js/geometry/transform.js");
    const id = await add(sq);
    const size = thingSize(store.snapshot.things.find((t) => t.id === id).outline);
    const r = board.actorRect(id);
    const [px, py] = board.resizeStart(id, r.right, r.top);
    const seen = [];
    for (const f of [3, 10, 0.5, 0.01]) {
      board.resizeTo(px + (r.right - px) * f, py + (r.top - py) * f);
      seen.push(engine.actorFor(id).scale * size);
    }
    board.resizeEnd(false);
    return { seen, min: THING_SCALE_MIN, max: THING_SCALE_MAX };
  }, SQUARE);
  for (const s of out.seen) assert.ok(s >= out.min - 1e-9 && s <= out.max + 1e-9, `shown at ${s} of the standard box`);
  assert.ok(Math.abs(Math.max(...out.seen) - out.max) < 1e-9, "the largest size is reachable");
  assert.ok(Math.abs(Math.min(...out.seen) - out.min) < 1e-9, "the smallest size is reachable");
  assert.deepEqual(page.errors, []);
});

test("board: a lopsided thing grabbed while it glides off its home is saved exactly where its preview was (no jump)", async () => {
  const page = await boardPage();
  const out = await page.evaluate(async ([sq, lop]) => {
    const { add, board, engine, store, frames } = window.__t;
    await add(sq);
    await frames(30); // settled
    const id = await add(lop); // lands on the square: the two glide apart
    await frames(3);
    const a = engine.actorFor(id);
    const gliding = a.glideT >= 0;
    const rect = board.boardRect();
    const off = Math.hypot((a.x - a.homeX) * rect.width, (a.y - a.homeY) * rect.height);
    const r0 = board.actorRect(id);
    const pivot = board.resizeStart(id, r0.right, r0.bottom);
    // The feet: the outline's box bottom centre, where it is drawn now.
    const feet = [r0.left + r0.width / 2, r0.bottom];
    board.resizeTo(pivot[0] + (r0.right - pivot[0]) * 1.4, pivot[1]);
    const shown = board.actorRect(id);
    let first = null;
    store.addEventListener("change", (e) => {
      if (first || !(e.detail?.ids ?? []).includes(id)) return;
      const q = board.actorRect(id);
      first = { l: q.left, t: q.top, w: q.width, h: q.height, scale: engine.actorFor(id).scale };
    });
    const s = board.resizeEnd(true);
    return { gliding, off, pivot, feet, s, shown: { l: shown.left, t: shown.top, w: shown.width, h: shown.height, b: shown.bottom, cx: shown.left + shown.width / 2 }, first, w0: r0.width };
  }, [SQUARE, LOPSIDED]);
  assert.ok(out.gliding, "grabbed mid-glide");
  assert.ok(out.off > 3, `off its home by ${out.off} px`);
  assert.ok(Math.abs(out.pivot[0] - out.feet[0]) < 0.01 && Math.abs(out.pivot[1] - out.feet[1]) < 0.01, `the pivot is its feet: ${out.pivot} vs ${out.feet}`);
  assert.ok(Math.abs(out.shown.cx - out.feet[0]) < 0.01 && Math.abs(out.shown.b - out.feet[1]) < 0.01, "the preview stands on its feet");
  assert.ok(Math.abs(out.s - 1.4) < 1e-9);
  assert.ok(Math.abs(out.shown.w - out.w0 * 1.4) < 0.01);
  assert.ok(out.first, "one write of the resized thing");
  assert.equal(out.first.scale, 1, "drawn from the saved outline");
  // The store rounds points to 3 decimals: about a pixel on a 1094 px board.
  for (const k of ["l", "t", "w", "h"]) assert.ok(Math.abs(out.first[k] - out.shown[k]) < 1.5, `${k}: saved ${out.first[k]} vs shown ${out.shown[k]}`);
  assert.deepEqual(page.errors, []);
});

test("board: a resize whose write fails says so on screen, like any other edit", async () => {
  const page = await boardPage();
  const toasts = await page.evaluate(async (sq) => {
    const { add, board, store, toasts } = window.__t;
    const id = await add(sq);
    store.updateThing = () => Promise.reject(Object.assign(new Error("full"), { code: "quota" }));
    const r = board.actorRect(id);
    const [px, py] = board.resizeStart(id, r.right, r.bottom);
    board.resizeTo(px + (r.right - px) * 1.3, py);
    board.resizeEnd(true);
    await new Promise((res) => setTimeout(res, 0));
    return toasts;
  }, SQUARE);
  assert.deepEqual(toasts, ["This device is out of space. Nothing was changed."]);
});
