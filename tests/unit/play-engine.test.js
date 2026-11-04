import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlayEngine } from "../../web/js/play-engine.js";
import { FarmStore } from "../../web/js/farm-store.js";
import { MemoryRepo } from "../../web/js/io/memory-repo.js";
import { fixedEnv, square, aSnapshot, aPlace, aThing, aClip } from "../builders.js";
import { movedThingPatch } from "../../web/js/geometry/transform.js";

const preset = (id) => JSON.parse(readFileSync(new URL(`../../web/data/motions/${id}.json`, import.meta.url), "utf8"));
const presets = { walk: preset("walk"), float: preset("float") };
const TICK = 1 / 60;

class FakeAudio {
  constructor() { this.calls = []; this.pending = []; }
  playThing(clips) {
    this.calls.push(["playThing", clips.map((c) => `${c.language}:${c.kind}`)]);
    return new Promise((resolve) => this.pending.push(resolve));
  }
  chime(kind) { this.calls.push(["chime", kind]); }
  stop() { this.calls.push(["stop"]); }
  finishAll() { for (const r of this.pending.splice(0)) r(); }
  names() { return this.calls.map((c) => c[0]); }
}

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Farm: pig (en+sv name, en sound) at (0.3, 0.7), cow (no clips) at (0.7, 0.7). Sea: fish. */
async function setup({ settings = {}, now: start = 0 } = {}) {
  const snap = aSnapshot()
    .withPlace(
      aPlace({ id: "farm", name: "Farm" })
        .withThing(
          aThing({ id: "pig", outline: square(0.3, 0.7, 0.08) })
            .withClip(aClip({ id: "c1", language: "en", kind: "name" }))
            .withClip(aClip({ id: "c2", language: "sv", kind: "name" }))
            .withClip(aClip({ id: "c3", language: "en", kind: "sound" })),
        )
        .withThing(aThing({ id: "cow", outline: square(0.7, 0.7, 0.08) })),
    )
    .withPlace(aPlace({ id: "sea", name: "Sea", backdrop: "sea" }).withThing(aThing({ id: "fish", outline: square(0.5, 0.5, 0.06), motion: { kind: "preset", preset: "float", params: {} } })))
    .build();
  Object.assign(snap.settings, settings);
  const store = new FarmStore(new MemoryRepo(), fixedEnv());
  await store.hydrate();
  await store.replaceAll(snap, []);
  const audio = new FakeAudio();
  const clock = { t: start };
  const engine = new PlayEngine({ store, audio, presets, rng: seeded(), flags: {}, now: () => clock.t });
  const events = [];
  for (const kind of ["reaction", "wake"]) engine.addEventListener(kind, (e) => events.push([kind, e.detail]));
  const advance = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) { clock.t += 1000 / fps; engine.step(1 / fps); }
  };
  return { store, audio, engine, clock, events, advance };
}

const flush = () => new Promise((r) => setImmediate(r));
const actor = (engine, id) => engine.actors.find((a) => a.thingId === id);

test("actors are built for the current place at their outline centroids", async () => {
  const { engine } = await setup();
  assert.deepEqual(engine.actors.map((a) => a.thingId), ["pig", "cow"]);
  assert.ok(Math.abs(actor(engine, "pig").x - 0.3) < 1e-9);
  assert.equal(engine.mode, "play");
  assert.ok(engine.isIdle());
});

test("tap: the thing jumps, says its name then its sound, and confetti is asked for", async () => {
  const { engine, audio, events, advance } = await setup();
  assert.equal(engine.tap(0.31, 0.69), "pig");
  assert.deepEqual(audio.calls, [["playThing", ["en:name", "en:sound"]]]);
  const reaction = events.find((e) => e[0] === "reaction");
  assert.equal(reaction[1].thingId, "pig");
  assert.ok(Math.abs(reaction[1].x - 0.3) < 1e-9 && Math.abs(reaction[1].y - 0.7) < 1e-9);
  assert.ok(events.some((e) => e[0] === "wake"), "the renderer is woken");
  assert.equal(actor(engine, "pig").state, "react");
  assert.ok(!engine.isIdle());
  advance(3);
  assert.notEqual(actor(engine, "pig").state, "react", "back to idle play within 3 s");
});

test("the hit target is 1.3× the drawing", async () => {
  const { engine } = await setup();
  assert.equal(engine.tap(0.3 + 0.08 * 1.25, 0.7), "pig");
});

test("a tap on nothing does nothing and makes no sound", async () => {
  const { engine, audio, events } = await setup();
  assert.equal(engine.tap(0.5, 0.2), null);
  assert.deepEqual(audio.calls, []);
  assert.equal(events.filter((e) => e[0] === "reaction").length, 0);
});

test("a thing without recordings chimes", async () => {
  const { engine, audio } = await setup();
  assert.equal(engine.tap(0.7, 0.7), "cow");
  assert.deepEqual(audio.calls, [["chime", "tap"]]);
});

test("mash policy: same thing restarts only after 300 ms; another thing stops the current clip", async () => {
  const { engine, audio, clock } = await setup({ now: 1000 });
  engine.tap(0.3, 0.7);
  clock.t = 1200;
  engine.tap(0.3, 0.7);
  assert.deepEqual(audio.names(), ["playThing"], "ignored within 300 ms");
  clock.t = 1300;
  engine.tap(0.3, 0.7);
  assert.deepEqual(audio.names(), ["playThing", "stop", "playThing"], "restarted");
  clock.t = 1310;
  engine.tap(0.7, 0.7);
  assert.deepEqual(audio.names(), ["playThing", "stop", "playThing", "stop", "chime"]);
});

test("once the clip has ended, the same thing plays again at once", async () => {
  const { engine, audio, clock } = await setup({ now: 1000 });
  engine.tap(0.3, 0.7);
  audio.finishAll();
  await flush();
  clock.t = 1100;
  engine.tap(0.3, 0.7);
  assert.deepEqual(audio.names(), ["playThing", "playThing"], "no stop: nothing was playing");
});

test("mixed play language picks a random recorded language on each tap", async () => {
  const { engine, audio, clock } = await setup({ settings: { languages: ["en", "sv"], playLanguage: "alternate" } });
  for (let i = 0; i < 40; i++) { clock.t += 1000; engine.tap(0.3, 0.7); }
  const names = audio.calls.filter((c) => c[0] === "playThing").map((c) => c[1][0]);
  assert.equal(names.length, 40);
  const en = names.filter((n) => n === "en:name").length;
  assert.ok(en > 5 && en < 35, `both languages come up (${en} en of 40)`);
  assert.ok(names.every((n) => n === "en:name" || n === "sv:name"));
  assert.notDeepEqual(names.slice(0, 10), names.slice(0, 10).map((_, i) => (i % 2 ? "sv:name" : "en:name")), "not a fixed rotation");
});

test("edit mode: taps do not play, pick finds things, things wiggle and settle", async () => {
  const { engine, audio, advance } = await setup();
  engine.setMode("edit");
  assert.equal(engine.mode, "edit");
  assert.equal(engine.tap(0.3, 0.7), null);
  assert.deepEqual(audio.calls, []);
  assert.equal(engine.pick(0.3, 0.7), "pig");
  assert.equal(engine.pick(0.5, 0.1), null);
  assert.equal(actor(engine, "pig").state, "wiggle");
  advance(2.5);
  assert.ok(engine.isIdle());
  assert.equal(engine.nextWakeMs(), Infinity);
  engine.setMode("play");
  assert.ok(engine.nextWakeMs() < 5000);
});

test("store changes: deleted things go, survivors keep their place, added things drop in", async () => {
  const { engine, store, advance } = await setup();
  actor(engine, "pig").x = 0.35;
  const arr = engine.actors;
  await store.deleteThing({ thingId: "cow" });
  assert.deepEqual(engine.actors.map((a) => a.thingId), ["pig"]);
  assert.equal(engine.actors, arr, "same array");
  assert.equal(actor(engine, "pig").x, 0.35);
  const change = await store.addThing({ placeId: "farm", outline: square(0.6, 0.75, 0.05), color: "red", motion: { kind: "preset", preset: "float", params: {} } });
  const id = change.ids[0];
  engine.dropIn(id);
  assert.equal(actor(engine, id).state, "drop");
  assert.deepEqual(actor(engine, id).pose.legs, []);
  advance(1);
  assert.equal(actor(engine, id).state, "idle");
});

test("dropIn before the store's change event still drops the thing", async () => {
  const { engine, store } = await setup();
  engine.dropIn("id-0001");
  await store.addThing({ placeId: "farm", outline: square(0.6, 0.75, 0.05), color: "red" });
  const added = engine.actors.at(-1);
  assert.equal(added.thingId, "id-0001");
  assert.equal(added.state, "drop");
});

test("switching places replaces the actors and they drop in", async () => {
  const { engine, store } = await setup();
  await store.setCurrentPlace({ placeId: "sea" });
  assert.deepEqual(engine.actors.map((a) => a.thingId), ["fish"]);
  assert.equal(engine.actors[0].state, "drop");
});

test("the sleep timer puts everyone to sleep; taps then only stir, silently; edit mode wakes them", async () => {
  const { engine, audio, clock, advance } = await setup({ settings: { sleepMinutes: 1 } });
  assert.ok(engine.nextWakeMs() <= 60000);
  for (let i = 0; i < 200 && !engine.actors.every((a) => a.state === "sleep"); i++) {
    const ms = Math.min(engine.nextWakeMs(), 60000);
    clock.t += ms;
    engine.step(ms / 1000);
    advance(engine.isIdle() ? 0 : 10);
  }
  assert.ok(engine.actors.every((a) => a.state === "sleep"), "asleep");
  advance(3);
  assert.ok(engine.isIdle());
  assert.equal(engine.nextWakeMs(), Infinity, "nothing to wake for");
  audio.calls.length = 0;
  const pig = actor(engine, "pig");
  assert.equal(engine.tap(pig.x, pig.y), "pig");
  assert.deepEqual(audio.calls, [], "no sound while asleep");
  engine.setMode("edit");
  engine.setMode("play");
  assert.ok(engine.actors.every((a) => a.state !== "sleep"));
});

test("sleep timer off: no wake for sleep, and changing the setting restarts the timer", async () => {
  const { engine, store } = await setup({ settings: { sleepMinutes: 0 } });
  engine.setMode("scene");
  assert.equal(engine.nextWakeMs(), Infinity);
  engine.setMode("play");
  await store.updateSettings({ patch: { sleepMinutes: 5 } });
  engine.setMode("scene");
  engine.setMode("play");
  assert.ok(engine.nextWakeMs() <= 5000, "wanders soon");
});

test("idle gaps count by the clock even when the renderer passes a tiny dt after a wake", async () => {
  const { engine, clock } = await setup();
  engine.step(TICK);
  assert.ok(engine.isIdle());
  const ms = engine.nextWakeMs();
  assert.ok(Number.isFinite(ms) && ms > 0);
  clock.t += ms;
  engine.step(0);
  assert.ok(!engine.isIdle(), "the wander or blink began on time");
});

test("a tap after a long idle gap catches up without fast-forwarding the reaction", async () => {
  const { engine, clock } = await setup();
  engine.step(TICK);
  clock.t += 60000;
  engine.tap(0.3, 0.7);
  clock.t += 1000 / 60;
  engine.step(1 / 60);
  const a = actor(engine, "pig");
  assert.equal(a.state, "react");
  assert.ok(a.stateTime < 0.05, `reaction starts from the beginning (${a.stateTime})`);
});

test("finger down pauses everything; lifting it wakes the renderer", async () => {
  const { engine, events, advance } = await setup({ settings: { sleepMinutes: 0 } });
  engine.fingerDown(true);
  advance(30);
  assert.ok(Math.abs(actor(engine, "pig").x - 0.3) < 1e-9, "nothing wandered");
  assert.equal(engine.nextWakeMs(), Infinity);
  events.length = 0;
  engine.fingerDown(false);
  assert.ok(events.some((e) => e[0] === "wake"));
  assert.ok(Number.isFinite(engine.nextWakeMs()));
});

test("edit mode drag: grab holds still, dragTo follows exactly, release settles the new home", async () => {
  const { engine, store, events, advance } = await setup();
  assert.equal(engine.grab("pig"), null, "no dragging in play");
  engine.setMode("edit");
  assert.equal(engine.grab("nobody"), null);
  const start = engine.grab("pig");
  assert.ok(Math.abs(start.x - 0.3) < 1e-9 && Math.abs(start.y - 0.7) < 1e-9);
  assert.equal(engine.held, "pig");
  events.length = 0;
  engine.dragTo(0.5, 0.4);
  assert.ok(events.some((e) => e[0] === "wake"), "each move asks for a frame");
  advance(0.5);
  const a = actor(engine, "pig");
  assert.equal(a.x + a.pose.dx, 0.5, "drawn exactly at the finger, no lag or smoothing");
  assert.equal(a.y + a.pose.dy, 0.4);
  assert.equal(a.pose.rot, 0);
  const d = engine.release();
  assert.equal(engine.held, null);
  assert.ok(Math.abs(d.dx - 0.2) < 1e-9 && Math.abs(d.dy + 0.3) < 1e-9);
  assert.equal(engine.pick(0.5, 0.4), "pig", "taps find it where it was put, before the store catches up");
  const thing = store.snapshot.things.find((t) => t.id === "pig");
  await store.updateThing({ thingId: "pig", patch: movedThingPatch(thing, d.dx, d.dy) });
  const b = actor(engine, "pig");
  assert.ok(Math.abs(b.x - 0.5) < 1e-3 && Math.abs(b.y - 0.4) < 1e-3, "no jump when the store has the moved outline");
  assert.ok(Math.abs(b.homeX - b.x) < 1e-12, "the drop point is home");
  engine.dragTo(0.9, 0.9);
  assert.ok(Math.abs(actor(engine, "pig").x - 0.5) < 1e-3, "dragTo without a held thing does nothing");
  assert.equal(engine.release(), null);
});

test("edit mode drag: release without commit puts the thing back; leaving edit mode drops the hold", async () => {
  const { engine } = await setup();
  engine.setMode("edit");
  engine.grab("cow");
  engine.dragTo(0.1, 0.1);
  assert.equal(engine.release(false), null);
  assert.ok(Math.abs(actor(engine, "cow").x - 0.7) < 1e-9);
  assert.equal(actor(engine, "cow").homeX, actor(engine, "cow").x);
  engine.grab("cow");
  engine.setMode("play");
  assert.equal(engine.held, null);
});

test("dispose stops listening to the store", async () => {
  const { engine, store } = await setup();
  engine.dispose();
  await store.deleteThing({ thingId: "cow" });
  assert.equal(engine.actors.length, 2);
});
