// Package A in Chromium: felt board rendering, idle loop, pointer rules, letterboxing, draw pad.
// The full app can't boot until integration, so the board is mounted with a real FarmStore (MemoryRepo,
// starter content) and a fake engine, session and audio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

const STAGE = '<main id="stage" class="stage" data-mode="play"><kf-board id="board"></kf-board></main><div id="parent-layer" class="parent-layer"></div>';

/** Mounts <kf-board> with starter content and fakes. Exposes window.__t = {store, engine, session, audio, board, calls}. */
async function boardPage(viewport) {
  const page = await h.modulePage("", viewport ? { viewport } : {});
  await page.evaluate(async (html) => {
    // count frame requests before anything can ask for one
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return raf(cb); };

    const [{ FarmStore }, { MemoryRepo }, { loadStarter }, { centroid }] = await Promise.all([
      import("./js/farm-store.js"), import("./js/io/memory-repo.js"), import("./js/io/starter.js"), import("./js/geometry/stroke.js"),
    ]);
    await import("./js/components/kf-board/define.js");
    // Elements parsed by modulePage's setContent don't upgrade in Chromium; mount after defining instead.
    const mount = (x) => { const d = document.createElement("div"); d.innerHTML = x; document.body.replaceChildren(...d.childNodes); };
    mount(html);
    let n = 0;
    const env = { now: () => new Date().toISOString(), rng: Math.random, newId: () => `id-${++n}`, deviceId: "test" };
    const store = new FarmStore(new MemoryRepo(), env, "test");
    await store.hydrate();
    await store.replaceAll(await loadStarter(env, "en-GB"), []);

    const calls = [];
    class FakeEngine extends EventTarget {
      constructor() { super(); this.mode = "play"; this.idle = true; this.steps = 0; this.actors = []; this.rebuild(); }
      rebuild() {
        this.actors = store.thingsIn(store.currentPlace.id).map((t) => {
          const [x, y] = centroid(t.outline);
          const walk = t.motion.preset === "walk";
          return { thingId: t.id, x, y, facing: 1, t: 0, state: "idle", stateTime: 0,
            pose: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, legs: walk ? [0.3, -0.3, -0.3, 0.3] : [], eyeOpen: 1 } };
        });
      }
      step(dt) { this.steps++; for (const a of this.actors) a.pose.dx = this.idle ? a.pose.dx : a.pose.dx + dt * 0.001; }
      isIdle() { return this.idle; }
      nextWakeMs() { return Infinity; }
      fingerDown(v) { calls.push(["fingerDown", v]); }
      tap(x, y) { calls.push(["tap", x, y]); return null; }
      pick(x, y) { calls.push(["pick", x, y]); return this.actors[0]?.thingId ?? null; }
      setMode(m) { this.mode = m; }
    }
    const engine = new FakeEngine();
    const session = Object.assign(new EventTarget(), {
      state: { mode: "play", panel: null },
      holdStart: (e) => calls.push(["holdStart", e.pointerId]),
      playTap: () => calls.push(["playTap"]),
    });
    const audio = { unlock: () => calls.push(["unlock"]) };
    const board = document.getElementById("board");
    board.connect({ store, engine, session, audio });
    window.__t = { store, engine, session, audio, board, calls };
  }, STAGE);
  // let the first frame paint
  await page.waitForFunction(() => window.__t.board.renderer.frames > 0);
  return page;
}

test("the board paints felt: non-blank, thing sprites where the things are", async () => {
  const page = await boardPage();
  const result = await page.evaluate(async () => {
    const { board, store } = window.__t;
    const { centroid } = await import("./js/geometry/stroke.js");
    const canvas = board.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const colours = new Set();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      colours.add((data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3));
      if (data[i + 3] === 255) opaque++;
    }
    const pig = store.thingsIn(store.currentPlace.id).find((t) => t.names.en === "Pig");
    const [x, y] = centroid(pig.outline);
    const px = ctx.getImageData(Math.round(x * width), Math.round(y * height), 1, 1).data;
    return { width, height, colours: colours.size, opaque, samples: Math.floor(data.length / (4 * 97)), pig: [...px] };
  });
  assert.ok(result.width > 0 && Math.abs(result.width / result.height - 4 / 3) < 0.01);
  assert.ok(result.colours > 20, `only ${result.colours} colours`);
  assert.ok(result.opaque > result.samples * 0.95, "background not fully painted");
  // felt pink (#ff8fb8) with texture: red high, green lower, blue in between
  const [r, g, b] = result.pig;
  assert.ok(r > 200 && g > 100 && g < 180 && b > 140 && b < 220, `pig pixel ${result.pig}`);
  assert.deepEqual(page.errors, []);
});

test("an idle engine stops the frame loop; a busy one keeps it going; wake() draws once more", async () => {
  const page = await boardPage();
  const counts = await page.evaluate(async () => {
    const { engine, board } = window.__t;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(200);
    const idle0 = window.__raf;
    await wait(400);
    const idle1 = window.__raf;
    engine.idle = false;
    board.renderer.wake();
    await wait(400);
    const busy = window.__raf - idle1;
    const steps = engine.steps;
    engine.idle = true;
    await wait(150);
    const stopped0 = window.__raf;
    await wait(400);
    const stopped1 = window.__raf;
    const frames0 = board.renderer.frames;
    board.renderer.invalidate("background");
    await wait(150);
    return { idle0, idle1, busy, steps, stopped0, stopped1, running: board.renderer.running, extra: board.renderer.frames - frames0, rafAfterWake: window.__raf - stopped1 };
  });
  assert.equal(counts.idle1, counts.idle0, "idle board requested frames");
  assert.ok(counts.busy > 5, `busy engine got ${counts.busy} frames`);
  assert.ok(counts.steps > 5);
  assert.equal(counts.stopped1, counts.stopped0, "loop kept running after the engine went idle");
  assert.equal(counts.running, false);
  assert.equal(counts.extra, 1, "invalidate draws exactly one frame when idle");
  assert.equal(counts.rafAfterWake, 1);
  assert.deepEqual(page.errors, []);
});

test("reaction confetti runs at most about a second, then the loop stops", async () => {
  const page = await boardPage();
  const r = await page.evaluate(async () => {
    const { engine, board } = window.__t;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const f0 = board.renderer.frames;
    engine.dispatchEvent(new CustomEvent("reaction", { detail: { thingId: "x", x: 0.5, y: 0.5 } }));
    await wait(300);
    const mid = board.renderer.running;
    await wait(1100);
    return { mid, after: board.renderer.running, frames: board.renderer.frames - f0 };
  });
  assert.equal(r.mid, true);
  assert.equal(r.after, false);
  assert.ok(r.frames > 5);
});

test("pointer rules: tap in play unlocks audio, taps the engine in board coords and starts the hold; palms are ignored", async () => {
  const page = await boardPage();
  const pig = await page.evaluate(async () => {
    const { board, store } = window.__t;
    const { centroid } = await import("./js/geometry/stroke.js");
    const t = store.thingsIn(store.currentPlace.id).find((x) => x.names.en === "Pig");
    const [x, y] = centroid(t.outline);
    const [cx, cy] = board.toClient(x, y);
    return { x, y, cx, cy };
  });
  await page.mouse.click(pig.cx, pig.cy);
  let calls = await page.evaluate(() => window.__t.calls.splice(0));
  const names = calls.map((c) => c[0]);
  assert.deepEqual(names, ["unlock", "fingerDown", "holdStart", "tap", "playTap", "fingerDown"]);
  const tap = calls.find((c) => c[0] === "tap");
  assert.ok(Math.abs(tap[1] - pig.x) < 0.002 && Math.abs(tap[2] - pig.y) < 0.002, `tap at ${tap}`);
  assert.deepEqual(calls.at(-1), ["fingerDown", false]);

  // palm and non-primary pointers do nothing
  calls = await page.evaluate(({ cx, cy }) => {
    const frame = window.__t.board.querySelector(".kf-board-frame");
    const ev = (o) => new PointerEvent("pointerdown", { bubbles: true, clientX: cx, clientY: cy, pointerId: 7, pointerType: "touch", ...o });
    frame.dispatchEvent(ev({ isPrimary: true, width: 200, height: 180 }));
    frame.dispatchEvent(ev({ isPrimary: false, width: 10, height: 10 }));
    const ctx = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    frame.dispatchEvent(ctx);
    return { calls: window.__t.calls.splice(0), prevented: ctx.defaultPrevented, touchAction: getComputedStyle(frame).touchAction };
  }, pig);
  assert.deepEqual(calls.calls, []);
  assert.equal(calls.prevented, true);
  assert.equal(calls.touchAction, "none");
});

test("edit mode: a short tap picks a thing and dispatches kf-thing-tap", async () => {
  const page = await boardPage();
  await page.evaluate(() => {
    window.__t.session.state = { mode: "edit", panel: null };
    window.__t.engine.mode = "edit";
    window.__picked = [];
    document.addEventListener("kf-thing-tap", (e) => window.__picked.push(e.detail.thingId));
  });
  const { cx, cy } = await page.evaluate(() => { const [cx, cy] = window.__t.board.toClient(0.3, 0.7); return { cx, cy }; });
  await page.mouse.click(cx, cy);
  const r = await page.evaluate(() => ({ picked: window.__picked, calls: window.__t.calls.map((c) => c[0]), first: window.__t.engine.actors[0].thingId }));
  assert.deepEqual(r.picked, [r.first]);
  assert.ok(r.calls.includes("pick"));
  assert.ok(!r.calls.includes("tap"));
  // actorRect gives a client rect for badges
  const rect = await page.evaluate((id) => { const b = window.__t.board.actorRect(id); return b && { w: b.width, h: b.height, l: b.left }; }, r.first);
  assert.ok(rect.w > 50 && rect.h > 30);
});

for (const [name, viewport] of [["landscape", { width: 1180, height: 820 }], ["portrait", { width: 820, height: 1180 }]]) {
  test(`board is 4:3, letterboxed and never cropped in ${name}; toBoard/toClient round-trip`, async () => {
    const page = await boardPage(viewport);
    const r = await page.evaluate(() => {
      const { board } = window.__t;
      const rect = board.boardRect();
      const errs = [];
      for (const [x, y] of [[0, 0], [1, 1], [0.25, 0.8], [0.5, 0.5]]) {
        const [cx, cy] = board.toClient(x, y);
        const [bx, by] = board.toBoard(cx, cy);
        errs.push(Math.hypot(bx - x, by - y));
      }
      const canvas = board.querySelector("canvas");
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, w: rect.width, h: rect.height,
        vw: innerWidth, vh: innerHeight, maxErr: Math.max(...errs), cw: canvas.width, ch: canvas.height };
    });
    assert.ok(Math.abs(r.w / r.h - 4 / 3) < 0.01, `aspect ${r.w / r.h}`);
    assert.ok(r.left >= -0.5 && r.top >= -0.5 && r.right <= r.vw + 0.5 && r.bottom <= r.vh + 0.5, "board is cropped");
    if (name === "portrait") {
      assert.ok(Math.abs(r.w - r.vw) < 1, "portrait board should use the full width");
      assert.ok(r.top > 100, "portrait board should be letterboxed top and bottom");
    } else {
      assert.ok(Math.abs(r.h - r.vh) < 1, "landscape board should use the full height");
    }
    assert.ok(r.maxErr < 1e-9);
    assert.ok(Math.abs(r.cw / r.ch - 4 / 3) < 0.01);
  });
}

test("rotating the viewport resizes the board and canvas", async () => {
  const page = await boardPage({ width: 1180, height: 820 });
  const before = await page.evaluate(() => window.__t.board.querySelector("canvas").width);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForFunction((w) => window.__t.board.querySelector("canvas").width !== w, before);
  const after = await page.evaluate(() => ({ w: window.__t.board.querySelector("canvas").width, r: window.__t.board.boardRect().width }));
  assert.ok(Math.abs(after.r - 820) < 1);
});

async function drawPadPage() {
  const page = await h.modulePage("");
  await page.evaluate(async () => {
    await import("./js/components/kf-draw-pad/define.js");
    const mount = (x) => { const d = document.createElement("div"); d.innerHTML = x; document.body.replaceChildren(...d.childNodes); };
    mount('<div id="host" style="position:fixed;left:40px;top:30px;width:800px;height:600px"><kf-draw-pad mode="outline"></kf-draw-pad></div>');
    window.__events = [];
    for (const type of ["kf-stroke", "kf-stroke-open"]) document.addEventListener(type, (e) => window.__events.push({ type, detail: e.detail }));
  });
  return page;
}

async function drawArc(page, fraction, { cx = 440, cy = 330, r = 150, steps = 60 } = {}) {
  const pt = (i) => {
    const a = (i / steps) * Math.PI * 2 * fraction - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  await page.mouse.move(...pt(0));
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(...pt(i));
  await page.mouse.up();
}

test("draw pad: a near-closed circle emits a closed kf-stroke in board coords", async () => {
  const page = await drawPadPage();
  await drawArc(page, 0.96);
  const events = await page.evaluate(() => window.__events.splice(0));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "kf-stroke");
  const { points, closed } = events[0].detail;
  assert.equal(closed, true);
  assert.ok(points.length >= 8);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  // 300 px circle on an 800 px board centred at (0.5, 0.5)
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - 300 / 800) < 0.03);
  assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - 0.5) < 0.02);
  assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 0.5) < 0.02);
  assert.ok(points.every(([x, y]) => x === Math.round(x * 1000) / 1000 && y === Math.round(y * 1000) / 1000));
  assert.deepEqual(page.errors, []);
});

test("draw pad: a big gap emits kf-stroke-open with both ends and highlights them", async () => {
  const page = await drawPadPage();
  await drawArc(page, 0.75);
  const r = await page.evaluate(() => {
    const c = document.querySelector("kf-draw-pad canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    return { events: window.__events.splice(0), ink };
  });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, "kf-stroke-open");
  const { gap } = r.events[0].detail;
  // ends: top centre (0.5, 0.25) and left (0.3125, 0.5)
  assert.ok(Math.abs(gap.a[0] - 0.5) < 0.01 && Math.abs(gap.a[1] - 0.25) < 0.01, `a ${gap.a}`);
  assert.ok(Math.abs(gap.b[0] - 0.3125) < 0.01 && Math.abs(gap.b[1] - 0.5) < 0.01, `b ${gap.b}`);
  assert.ok(r.ink > 500, "open stroke and highlights should stay visible");
});

test("draw pad: yarn mode emits an open polyline; taps are ignored", async () => {
  const page = await drawPadPage();
  await page.evaluate(() => { document.querySelector("kf-draw-pad").mode = "yarn"; });
  await page.mouse.move(100, 300);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(100 + i * 20, 300 + Math.sin(i / 3) * 30);
  await page.mouse.up();
  await page.mouse.click(500, 500);
  const events = await page.evaluate(() => window.__events.splice(0));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "kf-stroke");
  assert.equal(events[0].detail.closed, false);
  assert.ok(events[0].detail.points.length >= 3);
});

test("felt: paintBackground paints every backdrop into a thumbnail; sprites have the anchor inside", async () => {
  const page = await h.modulePage("");
  const r = await page.evaluate(async () => {
    const felt = await import("./js/io/felt.js");
    const out = {};
    for (const backdrop of ["meadow", "sea", "room", "blank"]) {
      const c = document.createElement("canvas");
      c.width = 160; c.height = 120;
      const place = { id: "p", backdrop, skyColor: "sky", groundColor: backdrop === "sea" ? "water" : "grass",
        pieces: [{ id: "a", kind: "shape", color: "red", stroke: [[0.1, 0.5], [0.3, 0.5], [0.3, 0.3], [0.1, 0.3]] }, { id: "b", kind: "yarn", color: "wood", stroke: [[0.5, 0.6], [0.8, 0.62]] }] };
      felt.paintBackground(c.getContext("2d"), place, { w: 160, h: 120 }, { scene: backdrop === "blank" });
      const d = c.getContext("2d").getImageData(0, 0, 160, 120).data;
      const top = d.slice(0, 4).join(), bottom = d.slice((119 * 160 + 80) * 4, (119 * 160 + 81) * 4).join();
      out[backdrop] = { top, bottom, piece: [...c.getContext("2d").getImageData(32, 48, 1, 1).data] };
    }
    const sprite = felt.paintThingSprite({ outline: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]], color: "blue" }, 800, 2);
    const px = sprite.canvas.getContext("2d").getImageData(Math.round(sprite.ax), Math.round(sprite.ay), 1, 1).data;
    return { out, sprite: { w: sprite.canvas.width, h: sprite.canvas.height, ax: sprite.ax, ay: sprite.ay, px: [...px] } };
  });
  for (const [k, v] of Object.entries(r.out)) {
    assert.notEqual(v.top, v.bottom, `${k}: sky and ground look the same`);
    assert.ok(v.piece[0] > 180 && v.piece[1] < 140, `${k}: red piece missing (${v.piece})`);
  }
  assert.ok(r.sprite.w > 320 && r.sprite.h > 240);
  assert.ok(Math.abs(r.sprite.ax - r.sprite.w / 2) < 2 && Math.abs(r.sprite.ay - r.sprite.h / 2) < 2);
  assert.ok(r.sprite.px[2] > 180 && r.sprite.px[0] < 120, `sprite centre ${r.sprite.px}`);
});
