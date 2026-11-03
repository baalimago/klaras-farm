// Package C in Chromium: hold ring, adult check, edit layer, Session timers.
// Module page with fake services: a fake board (actorRect, toBoard, calls session.holdStart like kf-board),
// fake audio, a real FarmStore on MemoryRepo with a couple of things, and the real Shell with
// confirm/toast replaced by fakes. Time is Playwright's fake clock; nothing waits in real time.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as h from "./harness.js";

let env;
before(async () => { env = await h.setup(); });
after(async () => { await env?.teardown(); });

const HTML = `
  <main id="stage" class="stage" data-mode="play"><div id="board" style="width:1000px;height:750px;background:#7ccc4f"></div></main>
  <div id="parent-layer" class="parent-layer"></div>`;

/** Fake rects: thing i sits at left 200 + 240 i, top 300, 160 × 120. */
async function open({ things = 2 } = {}) {
  const page = await env.modulePage(HTML);
  await page.clock.install({ time: new Date("2026-11-03T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-03T12:00:01Z")); // time moves only with runFor
  await page.evaluate(async (things) => {
    const [{ FarmStore }, { MemoryRepo }, { Session }, { Shell }] = await Promise.all([
      import("./js/farm-store.js"), import("./js/io/memory-repo.js"), import("./js/session.js"), import("./js/shell.js"),
    ]);
    let n = 0;
    let seed = 42;
    const fenv = {
      now: () => new Date(Date.now()).toISOString(),
      rng: () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32),
      newId: () => `id-${++n}`,
      deviceId: "test",
    };
    const store = new FarmStore(new MemoryRepo(), fenv);
    await store.hydrate();
    await store.createPlace({ name: "Farm" });
    const sq = (cx) => [[cx - 0.05, 0.5], [cx + 0.05, 0.5], [cx + 0.05, 0.6], [cx - 0.05, 0.6]];
    const clip = (kind) => ({ language: "en", kind, take: 1, blobSha256: "a".repeat(64), mime: "audio/mp4", durationMs: 800, trimStartMs: 0, trimEndMs: 800, gainDb: 0 });
    const names = ["Pig", "Cow", "Hen", "Cat"];
    for (let i = 0; i < things; i++) {
      await store.addThing({ placeId: store.currentPlace.id, names: { en: names[i] }, outline: sq(0.2 + i * 0.2), color: "pink", clips: i === 0 ? [clip("name"), clip("sound")] : [] });
    }

    const calls = [];
    const board = document.getElementById("board");
    const rectFor = (id) => {
      const i = store.thingsIn(store.currentPlace.id).findIndex((t) => t.id === id);
      if (i < 0) return null;
      return { left: 200 + 240 * i, top: 300, width: 160, height: 120, right: 360 + 240 * i, bottom: 420 };
    };
    board.actorRect = (id) => rectFor(id);
    board.toBoard = (x, y) => ({ x: x / 1180, y: y / 820 });
    board.boardRect = () => board.getBoundingClientRect();
    const audio = { holdTone: (on) => calls.push(`holdTone:${on}`), chime: (k) => calls.push(`chime:${k}`), unlock() {} };
    const engine = { setMode: (m) => calls.push(`mode:${m}`), pick: () => null };
    const session = new Session({ now: () => Date.now(), holdMs: 1500 });
    const services = { store, session, audio, engine, board, env: fenv, flags: { gateKind: "keypad" }, updateReady: false };
    board.services = services;
    board.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary) return;
      services.audio.unlock();
      session.holdStart(e, board);
    });
    const shell = new Shell(document.getElementById("parent-layer"), services);
    shell.confirmAnswer = true;
    shell.confirm = async (opts) => { calls.push({ confirm: opts }); return shell.confirmAnswer; };
    shell.toast = async (msg, opts = {}) => { calls.push({ toast: msg }); shell.lastUndo = opts.undo; };
    services.shell = shell;
    window.t = { services, session, store, shell, calls };
  }, things);
  return page;
}

const mode = (page) => page.evaluate(() => window.t.session.state.mode);
const pointer = (page, target, type, fields = {}) =>
  page.evaluate(([target, type, fields]) => {
    const el = target === "window" ? window : document.querySelector(target);
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "touch", clientX: 500, clientY: 400, width: 20, height: 20, ...fields }));
  }, [target, type, fields]);

async function holdToGate(page) {
  await pointer(page, "#board", "pointerdown");
  await page.clock.runFor(1500);
  await pointer(page, "window", "pointerup");
  await page.waitForSelector("kf-adult-check .kf-key");
}

async function enterCode(page) {
  const code = await page.evaluate(() => document.querySelector("kf-adult-check").challenge.code);
  for (const d of code) await page.click(`kf-adult-check .kf-key[data-key="${d}"]`);
}

async function toEdit(page) {
  // Let the Shell mount the gate first: its async render keeps a stale element if the mode flips mid-import.
  await page.evaluate(() => window.t.session.holdArmed());
  await page.waitForSelector("kf-adult-check .kf-key");
  await page.evaluate(() => window.t.session.gatePassed());
  await page.waitForSelector("kf-edit-layer .kf-edit-bar");
  await page.waitForFunction(() => !document.querySelector("kf-adult-check"));
}

test("hold ring: nothing before 0.5 s, fills, full at 1.5 s, then the adult check", async () => {
  const page = await open();
  await pointer(page, "#board", "pointerdown");
  await page.clock.runFor(450);
  assert.equal(await page.locator("kf-hold-ring").isVisible(), false);
  assert.equal(await mode(page), "play");
  await page.clock.runFor(550); // 1.0 s
  assert.equal(await page.locator("kf-hold-ring").isVisible(), true);
  const mid = Number(await page.locator("kf-hold-ring").getAttribute("progress"));
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  await page.clock.runFor(500); // 1.5 s
  assert.equal(await page.locator("kf-hold-ring").getAttribute("progress"), "1.000");
  assert.equal(await page.locator("kf-hold-ring").isVisible(), true);
  assert.equal(await mode(page), "gate");
  const calls = await page.evaluate(() => window.t.calls);
  assert.deepEqual(calls.filter((c) => typeof c === "string" && c.startsWith("holdTone")), ["holdTone:true", "holdTone:false"]);
  assert.ok(!calls.includes("chime:enter"), "the rising chime waits for the check");
  await pointer(page, "window", "pointerup");
  assert.equal(await page.locator("kf-hold-ring").count(), 0);
  await page.waitForSelector("kf-adult-check .kf-key");
  assert.deepEqual(page.errors, []);
});

test("hold cancels silently on moving more than 10 px", async () => {
  const page = await open();
  await pointer(page, "#board", "pointerdown");
  await page.clock.runFor(800);
  await pointer(page, "window", "pointermove", { clientX: 515 });
  await page.clock.runFor(2000);
  assert.equal(await mode(page), "play");
  assert.equal(await page.locator("kf-hold-ring").count(), 0);
});

test("adult check: the right code enters edit mode with the rising chime; Done returns to play", async () => {
  const page = await open();
  await holdToGate(page);
  const prompt = await page.textContent("kf-adult-check .kf-gate__prompt");
  assert.match(prompt, /^Tap [1-9] [1-9] [1-9]$/);
  const keys = await page.locator("kf-adult-check .kf-key").all();
  assert.equal(keys.length, 9);
  for (const k of keys) {
    const box = await k.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
  }
  await enterCode(page);
  assert.equal(await mode(page), "edit");
  await page.waitForSelector("kf-edit-layer .kf-edit-bar");
  assert.equal(await page.locator("kf-adult-check").count(), 0);
  assert.ok((await page.evaluate(() => window.t.calls)).includes("chime:enter"));
  await page.click('kf-edit-layer [data-action="done"]');
  assert.equal(await mode(page), "play");
  await page.waitForFunction(() => !document.querySelector("kf-edit-layer"));
  assert.ok((await page.evaluate(() => window.t.calls)).includes("chime:leave"));
  // Done ends the session: the next hold needs the check again
  await holdToGate(page);
  assert.equal(await mode(page), "gate");
});

test("adult check fails silently on a wrong key", async () => {
  const page = await open();
  await holdToGate(page);
  const wrong = await page.evaluate(() => {
    const c = document.querySelector("kf-adult-check").challenge;
    return c.keys.find((k) => k !== c.code[0]);
  });
  await page.click(`kf-adult-check .kf-key[data-key="${wrong}"]`);
  assert.equal(await mode(page), "play");
  await page.waitForFunction(() => !document.querySelector("kf-adult-check"));
  assert.ok(!(await page.evaluate(() => window.t.calls)).some((c) => typeof c === "string" && c.startsWith("chime")));
});

test("adult check fails on a tap between keys, even after a right key", async () => {
  const page = await open();
  await holdToGate(page);
  const first = await page.evaluate(() => document.querySelector("kf-adult-check").challenge.code[0]);
  await page.click(`kf-adult-check .kf-key[data-key="${first}"]`);
  assert.equal(await mode(page), "gate");
  const keys = page.locator("kf-adult-check .kf-key");
  const a = await keys.nth(0).boundingBox();
  const b = await keys.nth(1).boundingBox();
  await page.mouse.click((a.x + a.width + b.x) / 2, a.y + a.height / 2);
  assert.equal(await mode(page), "play");
});

test("adult check fails after 10 s idle", async () => {
  const page = await open();
  await holdToGate(page);
  await page.clock.runFor(9000);
  assert.equal(await mode(page), "gate");
  await page.clock.runFor(1500);
  assert.equal(await mode(page), "play");
  await page.waitForFunction(() => !document.querySelector("kf-adult-check"));
});

test("edit layer: bar, badges at the things, + Add disabled with a reason at 4 things", async () => {
  const page = await open({ things: 2 });
  await toEdit(page);
  const labels = await page.locator("kf-edit-layer .kf-edit-bar button").allInnerTexts();
  assert.deepEqual(labels.map((l) => l.trim()), ["Scenes", "Change scene", "+ Add", "Settings", "Done"]);
  assert.equal(await page.locator('kf-edit-layer [data-action="add"]').isDisabled(), false);
  assert.equal(await page.locator("kf-edit-layer .kf-edit-reason").isVisible(), false);

  const badges = await page.locator("kf-edit-layer .kf-badge").all();
  assert.equal(badges.length, 4);
  const ids = await page.evaluate(() => window.t.store.thingsIn(window.t.store.currentPlace.id).map((t) => t.id));
  for (const [i, id] of ids.entries()) {
    for (const kind of ["pencil", "cross"]) {
      const box = await page.locator(`kf-edit-layer .kf-badge.${kind}[data-thing-id="${id}"]`).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `${kind} ${box.width}`);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      assert.ok(cx >= 200 + 240 * i - 30 && cx <= 360 + 240 * i + 30, `${kind} x ${cx}`);
      assert.ok(Math.abs(cy - 300) <= 2, `${kind} y ${cy}`);
    }
  }
  const pencil = await page.locator(`.kf-badge.pencil[data-thing-id="${ids[0]}"]`).boundingBox();
  const cross = await page.locator(`.kf-badge.cross[data-thing-id="${ids[0]}"]`).boundingBox();
  assert.ok(cross.x >= pencil.x + pencil.width, "badges do not overlap");
  assert.equal(await page.locator(`.kf-badge.cross[data-thing-id="${ids[0]}"]`).getAttribute("aria-label"), "Delete Pig");

  await page.evaluate(async () => {
    const { store } = window.t;
    const sq = (cx) => [[cx - 0.05, 0.5], [cx + 0.05, 0.5], [cx + 0.05, 0.6], [cx - 0.05, 0.6]];
    await store.addThing({ placeId: store.currentPlace.id, names: { en: "Hen" }, outline: sq(0.6), color: "red" });
    await store.addThing({ placeId: store.currentPlace.id, names: { en: "Cat" }, outline: sq(0.8), color: "red" });
  });
  await page.waitForFunction(() => document.querySelector('kf-edit-layer [data-action="add"]').disabled);
  assert.equal(await page.locator("kf-edit-layer .kf-edit-reason").isVisible(), true);
  assert.match(await page.textContent("kf-edit-layer .kf-edit-reason"), /4 things/);
  assert.equal(await page.locator('kf-edit-layer [data-action="add"]').getAttribute("aria-describedby"), "kf-edit-reason");
  assert.equal(await page.locator("kf-edit-layer .kf-badge").count(), 8);
});

test("edit layer: pencil opens the card panel; + Add opens guided add", async () => {
  const page = await open();
  await toEdit(page);
  const id = await page.evaluate(() => window.t.store.thingsIn(window.t.store.currentPlace.id)[1].id);
  await page.click(`kf-edit-layer .kf-badge.pencil[data-thing-id="${id}"]`);
  assert.deepEqual(await page.evaluate(() => window.t.session.state.panel), { name: "card", params: { thingId: id } });
  await page.evaluate(() => window.t.session.closePanel());
  await page.waitForSelector("kf-edit-layer .kf-edit-bar");
  await page.click('kf-edit-layer [data-action="add"]');
  assert.deepEqual(await page.evaluate(() => window.t.session.state.panel), { name: "guided", params: {} });
});

test("edit layer: the cross confirms naming the recordings, deletes, and Undo restores", async () => {
  const page = await open();
  await toEdit(page);
  const id = await page.evaluate(() => window.t.store.thingsIn(window.t.store.currentPlace.id)[0].id);

  await page.evaluate(() => { window.t.shell.confirmAnswer = false; });
  await page.click(`kf-edit-layer .kf-badge.cross[data-thing-id="${id}"]`);
  await page.waitForFunction(() => window.t.calls.some((c) => c.confirm));
  assert.equal(await page.evaluate(() => window.t.store.snapshot.things.length), 2, "Keep it keeps it");

  await page.evaluate(() => { window.t.shell.confirmAnswer = true; });
  await page.click(`kf-edit-layer .kf-badge.cross[data-thing-id="${id}"]`);
  await page.waitForFunction(() => window.t.calls.some((c) => c.toast));
  const calls = await page.evaluate(() => window.t.calls);
  const confirm = calls.find((c) => c.confirm).confirm;
  assert.equal(confirm.title, "Delete Pig?");
  assert.match(confirm.body, /2 recordings/);
  assert.equal(confirm.danger, true);
  assert.equal(calls.find((c) => c.toast).toast, "Deleted");
  assert.ok(calls.includes("chime:poof"));
  assert.equal(await page.evaluate(() => window.t.store.snapshot.things.length), 1);
  await page.waitForFunction(() => document.querySelectorAll("kf-edit-layer .kf-badge").length === 2);

  await page.evaluate(() => window.t.shell.lastUndo());
  await page.waitForFunction(() => window.t.store.snapshot.things.length === 2 && window.t.store.snapshot.clips.length === 2);
  await page.waitForFunction(() => document.querySelectorAll("kf-edit-layer .kf-badge").length === 4);
});

test("edit layer: an empty place offers to add a thing", async () => {
  const page = await open({ things: 0 });
  await toEdit(page);
  assert.equal(await page.locator("kf-edit-layer .kf-edit-empty").isVisible(), true);
  assert.equal(await page.locator("kf-edit-layer .kf-badge").count(), 0);
  await page.click('kf-edit-layer [data-action="add-first"]');
  assert.equal(await page.evaluate(() => window.t.session.state.panel?.name), "guided");
});

test("edit mode closes by itself after 60 s idle; the hold alone reopens it within 5 minutes", async () => {
  const page = await open();
  await toEdit(page);
  await page.clock.runFor(45_000);
  await page.mouse.click(600, 150); // input on the page counts as activity
  await page.clock.runFor(59_000);
  assert.equal(await mode(page), "edit");
  await page.clock.runFor(2_000);
  assert.equal(await mode(page), "play");
  await page.waitForFunction(() => !document.querySelector("kf-edit-layer"));
  assert.equal((await page.evaluate(() => window.t.calls)).filter((c) => c === "chime:leave").length, 1);
  // grace: hold alone, no check
  await pointer(page, "#board", "pointerdown");
  await page.clock.runFor(1500);
  await pointer(page, "window", "pointerup");
  assert.equal(await mode(page), "edit");
  await page.waitForSelector("kf-edit-layer .kf-edit-bar");
});

test("holding an empty spot in edit mode starts + Add there", async () => {
  const page = await open();
  await toEdit(page);
  await pointer(page, "#board", "pointerdown", { clientX: 590, clientY: 410 });
  await page.clock.runFor(1500);
  await pointer(page, "window", "pointerup", { clientX: 590, clientY: 410 });
  assert.deepEqual(await page.evaluate(() => window.t.session.state.panel), { name: "guided", params: { at: [0.5, 0.5] } });
});

test("desktop 'e' key and the hidden VoiceOver button open the adult check", async () => {
  const page = await open();
  await page.keyboard.press("e");
  assert.equal(await mode(page), "gate");
  await page.waitForSelector("kf-adult-check .kf-key");
  await page.keyboard.press("Escape");
  assert.equal(await mode(page), "play");
  const btn = page.getByRole("button", { name: "Edit (grown-ups)" });
  assert.equal(await btn.count(), 1);
  await btn.evaluate((b) => b.click());
  assert.equal(await mode(page), "gate");
});
