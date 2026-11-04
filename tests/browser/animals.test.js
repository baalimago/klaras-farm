// The animals in Chromium (meeting 2): eight things walking on the real PlayEngine and Renderer stay
// smooth and the loop still drops to 0 fps when they settle; every walking style (walk, hop,
// scuttle) gets the contact shadow, floaters do not; the app loads every motion preset.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";
import { buildStarter } from "../../tools/make-starter.mjs";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

// The Farm as designed with room for eight (the snapshot cap may still be lower; the renderer and
// engine are fed directly, not through FarmStore validation). They never rest, so all eight walk.
const farm = buildStarter({ maxPerPlace: 8 });
const farmPlace = farm.places.find((p) => p.name === "Farm");
const restless = { "travel.restMin": 0.05, "travel.restMax": 0.1, "travel.distMin": 0.3, "travel.distMax": 0.4 };
const things = farm.things
  .filter((t) => t.placeId === farmPlace.id)
  .map((t) => ({ ...t, motion: { ...t.motion, params: restless } }));

/** Mounts a real PlayEngine and Renderer over a minimal store holding `things`, at an iPad-sized board. */
async function mount(page, input) {
  await page.evaluate(async ({ things, place }) => {
    const [{ PlayEngine }, { Renderer }, { PRESET_IDS }] = await Promise.all([
      import("./js/play-engine.js"), import("./js/io/renderer.js"), import("./js/motion/pose.js"),
    ]);
    const presets = Object.fromEntries(await Promise.all(PRESET_IDS.map(async (id) => [id, await (await fetch(`data/motions/${id}.json`)).json()])));
    const settings = { sleepMinutes: 0, reduceMotion: false, languages: ["en"] };
    const store = Object.assign(new EventTarget(), {
      snapshot: { things, places: [place], clips: [], settings },
      settings,
      currentPlace: place,
      thingsIn: (id) => things.filter((t) => t.placeId === id),
    });
    const audio = { unlock() {}, chime() {}, playClip() {}, stop() {}, speak() {} };
    const engine = new PlayEngine({ store, audio, presets, rng: Math.random });
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:1092px;height:819px";
    document.body.append(canvas);
    const renderer = new Renderer(canvas, { store, engine });
    // the iPad 11th gen landscape board size (the test raises the pixel ratio later)
    renderer.setSize(1092, 819, 1);
    // time each frame's work (engine step + draw) and count frame requests
    const work = [];
    const frame = renderer._frame;
    renderer._frame = (now) => { const t0 = performance.now(); frame(now); work.push(performance.now() - t0); };
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return raf(cb); };
    window.__a = { engine, renderer, work, presets };
  }, input);
}

test("eight walking animals: smooth frames on the real engine and renderer, then 0 fps when they settle", async () => {
  const page = await h.modulePage();
  await mount(page, { things, place: farmPlace });
  const r = await page.evaluate(async () => {
    const { engine, renderer, work } = window.__a;
    const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const walking = () => engine.actors.filter((a) => a.state === "moving" || a.move > 0).length;
    /** fps and frame work (engine step + draw, main thread) over `ms` of walking. */
    const measure = async (ms) => {
      work.length = 0;
      const f0 = renderer.frames, t0 = performance.now();
      await wait(ms);
      const sorted = [...work].sort((a, b) => a - b);
      return {
        fps: (renderer.frames - f0) / ((performance.now() - t0) / 1000), walking: walking(),
        median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)],
      };
    };
    renderer.wake();
    await wait(4500); // drop-in, first rests (1–4 s), then everyone walks
    const css = await measure(2000);
    // the iPad's device pixel ratio of 2: four times the pixels per frame
    renderer.setSize(1092, 819, 2);
    await wait(300);
    const retina = await measure(1500);
    // edit mode: the wiggle decays over 2 s, then nothing moves and the loop stops
    engine.setMode("edit");
    await wait(2600);
    const raf0 = window.__raf;
    await wait(600);
    return { actors: engine.actors.length, css, retina, idleRaf: window.__raf - raf0, running: renderer.running, idle: engine.isIdle() };
  });
  assert.equal(r.actors, 8);
  for (const m of [r.css, r.retina]) assert.ok(m.walking >= 6, `only ${m.walking} of 8 walking`);
  assert.ok(r.css.fps > 50, `${r.css.fps.toFixed(1)} fps with eight walking`);
  // The iPad budget is 2 ms of frame work. Headless Chromium paints in software (at 2x its raster,
  // not our code, caps the frame rate), so these gates are looser than the device's; a regression
  // such as per-frame allocation, shadowBlur or re-painting sprites blows well past them.
  for (const m of [r.css, r.retina]) {
    assert.ok(m.median < 4, `median frame work ${m.median.toFixed(2)} ms`);
    assert.ok(m.p95 < 12, `p95 frame work ${m.p95.toFixed(2)} ms`);
  }
  assert.equal(r.idle, true, "settled engine reports idle");
  assert.equal(r.running, false, "the loop stopped");
  assert.equal(r.idleRaf, 0, "no frames requested while idle (0 fps)");
  assert.deepEqual(page.errors, []);
});

test("every walking style gets a contact shadow; floaters do not", async () => {
  const page = await h.modulePage();
  const outline = (x) => [[x, 0.6], [x + 0.12, 0.6], [x + 0.12, 0.7], [x, 0.7]];
  const legs = (x) => [{ x: x + 0.03, y: 0.69 }, { x: x + 0.09, y: 0.69 }];
  const mk = (id, preset, x) => ({
    ...things[0], id, outline: outline(x), eyes: [{ x: x + 0.08, y: 0.63 }], legs: preset === "float" ? [] : legs(x),
    motion: { kind: "preset", preset, params: {} },
  });
  const four = [mk("w", "walk", 0.05), mk("h", "hop", 0.3), mk("s", "scuttle", 0.55), mk("f", "float", 0.8)];
  await mount(page, { things: four, place: farmPlace });
  const r = await page.evaluate(async () => {
    const { engine, renderer, presets } = window.__a;
    renderer.wake();
    await new Promise((ok) => setTimeout(ok, 200));
    const out = {};
    for (const a of engine.actors) out[a.thingId] = renderer.entries.get(a.thingId)?.walker;
    return { walker: out, loaded: Object.keys(presets).sort() };
  });
  assert.deepEqual(r.walker, { w: true, h: true, s: true, f: false });
  assert.deepEqual(r.loaded, ["float", "hop", "scuttle", "swim", "walk"]);
  assert.deepEqual(page.errors, []);
});

test("the app boots with every motion preset loaded", async () => {
  const page = await h.newPage();
  const ids = await page.evaluate(() => Object.keys(window.__kf.presets).sort());
  assert.deepEqual(ids, ["float", "hop", "scuttle", "swim", "walk"]);
  assert.deepEqual(page.errors, []);
});
