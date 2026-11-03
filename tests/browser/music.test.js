// Background music in Chromium: level, fade in/out with shouldPlay, ducking under voices, the off switch.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let h;
before(async () => { h = await setup(); });
after(async () => { await h?.teardown(); });

test("the lullaby renders quietly: well under the chimes, but audible", async () => {
  const page = await h.modulePage();
  const r = await page.evaluate(async () => {
    const { renderMusic } = await import("./js/io/music.js");
    const { peak, dbfs, rms } = await import("./js/dsp/level.js");
    const s = await renderMusic(16, 3);
    return { peak: dbfs(peak(s)), rms: dbfs(rms(s)) };
  });
  assert.ok(r.peak <= -18, `peak ${r.peak.toFixed(1)} dBFS`);
  assert.ok(r.rms > -45, `audible (rms ${r.rms.toFixed(1)} dBFS)`);
  assert.deepEqual(page.errors, []);
});

test("music fades in when allowed, ducks while a voice talks, and stops when not allowed or switched off", async () => {
  const page = await h.modulePage();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("./js/io/audio.js");
    const { MusicPlayer } = await import("./js/io/music.js");
    const audio = new AudioEngine({ getBlob: async () => null });
    audio.unlock();
    for (let i = 0; i < 50 && audio.state !== "running"; i++) await new Promise((r) => setTimeout(r, 20));
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    let allowed = true;
    const music = new MusicPlayer({ audio, shouldPlay: () => allowed, storage, seed: 4 });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    music.update();
    out.playing = music.playing;
    await wait(300);
    out.busRising = audio.musicBus.gain.value > 0;
    audio._talk(1);
    out.talking = audio.talking;
    await wait(250);
    out.ducked = audio._musicDuck.gain.value;
    audio._talk(-1);
    await wait(1100);
    out.restored = audio._musicDuck.gain.value;
    allowed = false;
    music.update();
    out.stoppedWhenNotAllowed = !music.playing;
    allowed = true;
    music.update();
    music.enabled = false;
    out.stoppedWhenOff = !music.playing && store.get("kf.music") === "off";
    music.enabled = true;
    out.backOn = music.playing;
    music.dispose();
    return out;
  });
  assert.equal(r.playing, true);
  assert.equal(r.busRising, true);
  assert.equal(r.talking, true);
  assert.ok(r.ducked < 0.3, `ducked to ${r.ducked}`);
  assert.ok(r.restored > 0.95, `restored to ${r.restored}`);
  assert.equal(r.stoppedWhenNotAllowed, true);
  assert.equal(r.stoppedWhenOff, true);
  assert.equal(r.backOn, true);
  assert.deepEqual(page.errors, []);
});
