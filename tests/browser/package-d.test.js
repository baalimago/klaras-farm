// Package D in Chromium: AudioEngine, Recorder (fake mic: a beep every 500 ms), <kf-recorder>.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, IPAD_UA } from "./harness.js";

let h;
before(async () => { h = await setup({ fakeMedia: true }); });
after(async () => { await h?.teardown(); });

/** A page with helpers on window: a WAV clip generator and a stub blob store. */
async function audioPage(html = "", { userAgent } = {}) {
  const page = await h.modulePage(html, { userAgent });
  await page.evaluate(async () => {
    const { encodeWav } = await import("./js/dsp/wav.js");
    const blobs = new Map();
    window.__blobs = blobs;
    window.__getBlob = async (sha) => blobs.get(sha) ?? null;
    /** 1 s at 16 kHz: silence, a 440 Hz tone (amp 0.25) from 300 to 700 ms, silence. */
    window.__wavClip = (id, { bytes } = {}) => {
      const sr = 16000;
      const s = new Float32Array(sr);
      for (let i = 0.3 * sr; i < 0.7 * sr; i++) s[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / sr);
      const b = bytes ?? encodeWav(s, sr);
      const sha = id.padEnd(64, "0");
      blobs.set(sha, { sha256: sha, mime: "audio/wav", size: b.byteLength, createdAt: "2026-11-03T12:00:00.000Z", bytes: b });
      return { id, thingId: "t1", language: "en", kind: "name", take: 1, blobSha256: sha, mime: "audio/wav", durationMs: 1000, trimStartMs: 250, trimEndMs: 850, gainDb: 6, createdAt: "2026-11-03T12:00:00.000Z" };
    };
    window.__events = (target, names) => {
      const log = [];
      for (const n of names) target.addEventListener(n, (e) => log.push({ type: n, ...e.detail }));
      return log;
    };
  });
  return page;
}

test("AudioEngine unlocks and plays a WAV clip with its trim and gain", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("./js/io/audio.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    const before = audio.state;
    audio.unlock();
    const clip = window.__wavClip("a1");
    const log = window.__events(audio, ["clip-start", "clip-end", "decode-failed", "chime"]);
    const an = audio.context.createAnalyser();
    an.fftSize = 2048;
    audio.output.connect(an);
    const buf = new Float32Array(an.fftSize);
    let loudest = 0;
    const poll = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      for (const x of buf) loudest = Math.max(loudest, Math.abs(x));
    }, 20);
    await audio.preload([clip]);
    const t0 = performance.now();
    const done = await audio.playThing([clip]);
    clearInterval(poll);
    return { before, after: audio.state, done, ms: performance.now() - t0, log, loudest };
  });
  assert.equal(r.before, "locked");
  assert.equal(r.after, "running");
  assert.equal(r.done, true);
  const start = r.log.find((e) => e.type === "clip-start");
  assert.equal(start.clipId, "a1");
  assert.ok(Math.abs(start.offsetS - 0.25) < 1e-6, `offset ${start.offsetS}`);
  assert.ok(Math.abs(start.durationS - 0.6) < 1e-6, `duration ${start.durationS}`);
  assert.equal(start.gainDb, 6);
  assert.ok(r.log.some((e) => e.type === "clip-end" && e.clipId === "a1"));
  assert.ok(r.ms >= 550 && r.ms < 2000, `played for ${r.ms} ms`);
  // 0.25 * 10^(6/20) ≈ 0.5 before the limiter; the limiter keeps it below full scale
  assert.ok(r.loudest > 0.3 && r.loudest < 1, `loudest ${r.loudest}`);
  assert.ok(!r.log.some((e) => e.type === "decode-failed" || e.type === "chime"));
  assert.deepEqual(page.errors, []);
});

test("playThing plays the name then the sound; a new tap stops the current clip", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("./js/io/audio.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    audio.unlock();
    const name = window.__wavClip("n1");
    const sound = { ...window.__wavClip("s1"), kind: "sound" };
    const log = window.__events(audio, ["clip-start", "clip-end"]);
    const both = await audio.playThing([name, sound]);
    const first = audio.playThing([name]);
    await new Promise((r) => setTimeout(r, 100));
    const second = audio.playThing([sound]);
    return { both, first: await first, second: await second, order: log.map((e) => `${e.type}:${e.clipId}`) };
  });
  assert.equal(r.both, true);
  assert.deepEqual(r.order.slice(0, 4), ["clip-start:n1", "clip-end:n1", "clip-start:s1", "clip-end:s1"]);
  assert.equal(r.first, false, "interrupted");
  assert.equal(r.second, true);
});

test("chimes play live and render at least 6 dB below a normalised voice", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine, renderChime } = await import("./js/io/audio.js");
    const { peak, dbfs } = await import("./js/dsp/level.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    audio.unlock();
    const log = window.__events(audio, ["chime"]);
    const kinds = ["tap", "enter", "leave", "start", "stop", "plink", "poof", "hold-done"];
    const live = kinds.map((k) => audio.chime(k));
    audio.holdTone(true);
    await new Promise((r) => setTimeout(r, 150));
    audio.holdTone(false);
    const peaks = {};
    for (const k of kinds) peaks[k] = dbfs(peak(await renderChime(k)));
    return { live, peaks, chimed: log.map((e) => e.kind) };
  });
  assert.ok(r.live.every((d) => d > 0 && d < 1), `durations ${r.live}`);
  assert.deepEqual(r.chimed, ["tap", "enter", "leave", "start", "stop", "plink", "poof", "hold-done"]);
  for (const [k, p] of Object.entries(r.peaks)) {
    assert.ok(p <= -7, `${k} peaks at ${p.toFixed(1)} dBFS`);
    assert.ok(p > -35, `${k} is audible (${p.toFixed(1)} dBFS)`);
  }
  assert.deepEqual(page.errors, []);
});

test("editing sounds render quietly, and a mashed edit sound plays once", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine, renderChime } = await import("./js/io/audio.js");
    const { EDIT_CHIMES } = await import("./js/dsp/chimes.js");
    const { peak, dbfs } = await import("./js/dsp/level.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    audio.unlock();
    const mashed = [audio.chime("select"), audio.chime("select"), audio.chime("select")];
    const taps = [audio.chime("tap"), audio.chime("tap")];
    const peaks = {};
    for (const k of EDIT_CHIMES) peaks[k] = dbfs(peak(await renderChime(k)));
    return { mashed, taps, peaks };
  });
  assert.ok(r.mashed[0] > 0);
  assert.deepEqual(r.mashed.slice(1), [0, 0], "one sound for a burst");
  assert.ok(r.taps.every((d) => d > 0), "the child's chime is never throttled here");
  for (const [k, p] of Object.entries(r.peaks)) {
    assert.ok(p <= -9 && p > -40, `${k} peaks at ${p.toFixed(1)} dBFS`);
  }
});

test("a clip that fails to decode emits decode-failed and the thing still chimes", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("./js/io/audio.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    audio.unlock();
    const bad = window.__wavClip("bad", { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer });
    const log = window.__events(audio, ["decode-failed", "chime", "clip-start"]);
    const played = await audio.playThing([bad]);
    const again = await audio.playThing([bad]); // remembered as broken
    return { played, again, log, broken: audio.isBroken(bad), blobIntact: window.__blobs.get(bad.blobSha256).bytes.byteLength };
  });
  assert.equal(r.played, false);
  assert.equal(r.again, false);
  assert.deepEqual(r.log.filter((e) => e.type === "decode-failed").map((e) => e.clipId), ["bad", "bad"]);
  assert.deepEqual(r.log.filter((e) => e.type === "chime").map((e) => e.kind), ["tap", "tap"]);
  assert.ok(!r.log.some((e) => e.type === "clip-start"));
  assert.equal(r.broken, true);
  assert.equal(r.blobIntact, 8, "decodeAudioData got a copy");
});

test("the decode cache keeps to its byte budget (least recently used goes first)", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("./js/io/audio.js");
    // one decoded 1 s clip at the context rate is ~176 KB (44.1 kHz) or ~192 KB (48 kHz)
    const audio = new AudioEngine({ getBlob: window.__getBlob, budgetBytes: 450_000 });
    const clips = ["c1", "c2", "c3"].map((id) => window.__wavClip(id));
    await audio.preload(clips.slice(0, 2));
    await audio.preload([clips[0]]); // touch c1
    await audio.preload([clips[2]]);
    return { cached: audio.cachedShas().map((s) => s.slice(0, 2)), bytes: audio.cacheBytes };
  });
  assert.deepEqual(r.cached.sort(), ["c1", "c3"]);
  assert.ok(r.bytes <= 450_000);
});

test("Recorder records the fake mic and returns the processed take", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("./js/io/audio.js");
    const { Recorder } = await import("./js/io/mic.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    audio.unlock();
    const rec = new Recorder({ audio });
    const chimes = window.__events(audio, ["chime"]);
    const levels = [];
    const handle = await rec.start({ onLevel: (v) => levels.push(v) });
    await new Promise((r) => setTimeout(r, 1700));
    const res = await handle.stop();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", res.bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { ...res, bytes: res.bytes?.byteLength, isBuffer: res.bytes instanceof ArrayBuffer, digest, levels: levels.length, maxLevel: Math.max(...levels), chimes: chimes.map((e) => e.kind) };
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const k of ["ok", "bytes", "mime", "sha256", "durationMs", "trimStartMs", "trimEndMs", "gainDb", "cappedAt5s"]) assert.ok(k in r, k);
  assert.ok(r.isBuffer && r.bytes > 1000);
  assert.match(r.mime, /^audio\/(webm|mp4|ogg)/);
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.sha256, r.digest);
  assert.ok(r.durationMs > 1200 && r.durationMs < 2500, `duration ${r.durationMs}`);
  assert.ok(r.trimStartMs >= 0 && r.trimStartMs < r.trimEndMs && r.trimEndMs <= r.durationMs, `trim ${r.trimStartMs}..${r.trimEndMs}`);
  assert.ok(r.trimStartMs > 100, "the silence before the first beep is trimmed");
  assert.equal(typeof r.gainDb, "number");
  assert.equal(r.cappedAt5s, false);
  assert.ok(r.levels > 10 && r.maxLevel > 0.5, `levels ${r.levels} max ${r.maxLevel}`);
  assert.deepEqual(r.chimes, ["start", "stop"]);
  assert.deepEqual(page.errors, []);
});

test("Recorder: an immediate stop is too short; a denied mic says denied", async () => {
  const page = await audioPage();
  const r = await page.evaluate(async () => {
    const { AudioEngine } = await import("./js/io/audio.js");
    const { Recorder } = await import("./js/io/mic.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    audio.unlock();
    const rec = new Recorder({ audio });
    const short = await (await rec.start()).stop();
    const denied = new Recorder({ audio, mediaDevices: { getUserMedia: () => Promise.reject(new DOMException("no", "NotAllowedError")) } });
    const d = await (await denied.start()).done;
    const none = await new Recorder({ audio, mediaDevices: {} }).permission();
    return { short, d, none, session: audio.sessionType };
  });
  assert.deepEqual(r.short, { ok: false, error: "too-short" });
  assert.deepEqual(r.d, { ok: false, error: "denied" });
  assert.equal(r.none, "unsupported");
  assert.equal(r.session, "playback", "back to playback after recording");
});

// Custom elements parsed by modulePage's setContent are not upgraded in Chromium, so the
// recorder is created with createElement after define.js has run.
const RECORDER_PAGE = `<div class="kf-sheet center" id="host"></div>`;

async function mountRecorder(page, { fakeRecorder = null, denied = false } = {}) {
  await page.evaluate(async ({ fakeRecorder, denied }) => {
    await import("./js/components/kf-recorder/define.js");
    const { AudioEngine } = await import("./js/io/audio.js");
    const { Recorder } = await import("./js/io/mic.js");
    const audio = new AudioEngine({ getBlob: window.__getBlob });
    let recorder = new Recorder({ audio });
    if (denied) recorder = new Recorder({ audio, mediaDevices: { getUserMedia: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")) } });
    if (fakeRecorder) recorder = { permission: async () => "granted", start: async () => ({ stop: async () => fakeRecorder, cancel() {}, done: Promise.resolve(fakeRecorder) }) };
    let n = 0;
    const env = { newId: () => `clip-${++n}`, now: () => "2026-11-03T12:00:00.000Z" };
    const el = document.createElement("kf-recorder");
    el.id = "rec";
    window.__hops = [];
    el.services = { audio, recorder, env, engine: { hop: (id) => window.__hops.push(id) } };
    el.label = 'Say "pig"';
    el.clipRef = { thingId: "t1", language: "en", kind: "name", take: 1 };
    window.__recorded = [];
    el.addEventListener("kf-recorded", (e) => window.__recorded.push(e.detail));
    document.getElementById("host").append(el);
  }, { fakeRecorder, denied });
}

const state = (page) => page.locator("#rec").getAttribute("data-state");

test("<kf-recorder>: ready → recording → a finished take is saved without any extra tap", async () => {
  const page = await audioPage(RECORDER_PAGE);
  await mountRecorder(page);
  assert.equal(await state(page), "ready");
  assert.equal(await page.locator("#rec .kf-rec-label").textContent(), 'Say "pig"');
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForSelector('#rec[data-state="recording"]');
  assert.ok(await page.getByRole("button", { name: "Stop" }).isVisible(), "Stop is always visible while recording");
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: "Stop" }).click();
  await page.waitForSelector('#rec[data-state="saved"]', { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__recorded.length), 1, "kept as soon as the take finished");
  assert.match(await page.locator("#rec .kf-rec-saved").textContent(), /Saved ✓/);
  assert.equal(await page.locator("#rec").getByRole("button", { name: "Keep" }).count(), 0, "no Keep step");
  assert.ok(await page.getByRole("button", { name: "Re-record" }).isVisible());
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => window.__hops.length === 1);
  const d = await page.evaluate(() => {
    const { clip, blob } = window.__recorded[0];
    return { n: window.__recorded.length, clip, blob: { ...blob, bytes: blob.bytes.byteLength, isBuffer: blob.bytes instanceof ArrayBuffer } };
  });
  assert.equal(d.n, 1);
  assert.equal(d.clip.thingId, "t1");
  assert.equal(d.clip.language, "en");
  assert.equal(d.clip.kind, "name");
  assert.equal(d.clip.take, 1);
  assert.match(d.clip.blobSha256, /^[0-9a-f]{64}$/);
  assert.match(d.clip.mime, /^audio\//);
  for (const k of ["durationMs", "trimStartMs", "trimEndMs", "gainDb"]) assert.equal(typeof d.clip[k], "number", k);
  assert.equal(d.blob.sha256, d.clip.blobSha256);
  assert.equal(d.blob.mime, d.clip.mime);
  assert.equal(d.blob.size, d.blob.bytes);
  assert.ok(d.blob.isBuffer && d.blob.bytes > 1000);
  assert.equal(typeof d.blob.createdAt, "string");
  assert.deepEqual(page.errors, []);
});

// Swap the recorder's next result: a good take (wav bytes under `tag`) or a failure/cancel.
async function nextTake(page, next) {
  await page.evaluate((next) => {
    const el = document.getElementById("rec");
    let r = next;
    if (next.tag) {
      const clip = window.__wavClip(next.tag);
      r = { ok: true, bytes: window.__blobs.get(clip.blobSha256).bytes, mime: "audio/wav", sha256: clip.blobSha256, durationMs: 1000, trimStartMs: 250, trimEndMs: 850, gainDb: 6, cappedAt5s: !!next.capped };
    }
    el.services.recorder = { permission: async () => "granted", start: async () => ({ stop: async () => r, cancel() {}, done: Promise.resolve(r) }) };
  }, next);
}

const recordedShas = (page) => page.evaluate(() => window.__recorded.map((d) => d.clip.blobSha256));

async function watchStarts(page) {
  await page.evaluate(() => {
    window.__starts = [];
    document.getElementById("rec").services.audio.addEventListener("clip-start", (e) => window.__starts.push(e.detail.clipId));
  });
}

test("<kf-recorder>: a capped take is still saved, with a note; Re-record replaces it", async () => {
  const page = await audioPage(RECORDER_PAGE);
  await mountRecorder(page);
  await nextTake(page, { tag: "aa01", capped: true });
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForSelector('#rec[data-state="saved"]');
  assert.match(await page.locator("#rec").textContent(), /5 seconds/, "says the cap cut it off");
  const [first] = await recordedShas(page);
  await nextTake(page, { tag: "bb02" });
  await page.getByRole("button", { name: "Re-record" }).click();
  await page.waitForFunction(() => window.__recorded.length === 2);
  await page.waitForSelector('#rec[data-state="saved"]');
  const shas = await recordedShas(page);
  assert.notEqual(shas[1], first, "the new take replaces the old one");
  assert.doesNotMatch(await page.locator("#rec").textContent(), /5 seconds/);
  await watchStarts(page);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => window.__starts.length === 1);
  assert.equal(await page.evaluate(() => window.__starts[0]), await page.evaluate(() => window.__recorded[1].clip.id), "Play plays the newest take");
  assert.deepEqual(page.errors, []);
});

test("<kf-recorder>: a failed or cancelled re-record saves nothing and keeps the old clip", async () => {
  const page = await audioPage(RECORDER_PAGE);
  await mountRecorder(page);
  await nextTake(page, { tag: "cc03" });
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForSelector('#rec[data-state="saved"]');
  await nextTake(page, { ok: false, error: "silent" });
  await page.getByRole("button", { name: "Re-record" }).click();
  await page.waitForSelector('#rec[data-error="silent"]');
  assert.match(await page.locator("#rec").textContent(), /couldn.t hear/i);
  assert.match(await page.locator("#rec").textContent(), /still saved/);
  assert.equal(await page.evaluate(() => window.__recorded.length), 1, "nothing new is saved");
  await watchStarts(page);
  await page.getByRole("button", { name: "Play the saved recording" }).click();
  await page.waitForFunction(() => window.__starts.length === 1);
  assert.equal(await page.evaluate(() => window.__starts[0]), await page.evaluate(() => window.__recorded[0].clip.id), "the old take still plays");
  // A cancelled take goes back to the saved state.
  await nextTake(page, { ok: false, error: "cancelled" });
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForSelector('#rec[data-state="saved"]');
  assert.equal(await page.evaluate(() => window.__recorded.length), 1);
  assert.deepEqual(page.errors, []);
});

test("<kf-recorder>: a denied microphone on an iPad shows the iPad Settings steps", async () => {
  const page = await audioPage(RECORDER_PAGE, { userAgent: IPAD_UA });
  await mountRecorder(page, { denied: true });
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForSelector('#rec[data-state="denied"]');
  const text = await page.locator("#rec").textContent();
  assert.match(text, /Settings app on the iPad/);
  assert.match(text, /Safari/);
  assert.match(text, /Microphone/);
  assert.match(text, /Allow/);
  assert.ok(await page.locator("#rec ol li").count() >= 3, "numbered steps");
  assert.ok(await page.getByRole("button", { name: "Try again" }).isVisible());
  assert.equal(await page.evaluate(() => window.__recorded.length), 0);
});

test("<kf-recorder>: a denied microphone elsewhere points to the browser's site settings, not the iPad", async () => {
  const page = await audioPage(RECORDER_PAGE);
  await mountRecorder(page, { denied: true });
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForSelector('#rec[data-state="denied"]');
  const text = await page.locator("#rec").textContent();
  assert.match(text, /site's settings in your browser/);
  assert.match(text, /Microphone/);
  assert.doesNotMatch(text, /iPad|Safari/);
  assert.ok(await page.locator("#rec ol li").count() >= 3, "numbered steps");
  assert.ok(await page.getByRole("button", { name: "Try again" }).isVisible());
});

test("<kf-recorder>: too short and silent takes say Try again; nothing is saved", async () => {
  const page = await audioPage(RECORDER_PAGE);
  await mountRecorder(page, { fakeRecorder: { ok: false, error: "too-short" } });
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForSelector('#rec[data-state="error"]');
  assert.equal(await page.locator("#rec").getAttribute("data-error"), "too-short");
  assert.match(await page.locator("#rec").textContent(), /too short/i);
  assert.ok(await page.getByRole("button", { name: "Try again" }).isVisible());
  await page.evaluate(() => {
    const el = document.getElementById("rec");
    const r = { ok: false, error: "silent" };
    el.services.recorder = { permission: async () => "granted", start: async () => ({ stop: async () => r, cancel() {}, done: Promise.resolve(r) }) };
  });
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForSelector('#rec[data-error="silent"]');
  assert.match(await page.locator("#rec").textContent(), /couldn.t hear/i);
  assert.equal(await page.evaluate(() => window.__recorded.length), 0);
});

test("<kf-recorder>: a real take stopped at once is too short", async () => {
  const page = await audioPage(RECORDER_PAGE);
  await mountRecorder(page);
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForSelector('#rec[data-state="recording"]');
  await page.getByRole("button", { name: "Stop" }).click();
  await page.waitForSelector('#rec[data-state="error"]', { timeout: 5000 });
  assert.equal(await page.locator("#rec").getAttribute("data-error"), "too-short");
  assert.ok(await page.getByRole("button", { name: "Try again" }).isVisible());
});

test("<kf-recorder>: an existing clip can be played and stays until a new take is saved", async () => {
  const page = await audioPage(RECORDER_PAGE);
  await mountRecorder(page);
  await page.evaluate(() => {
    const el = document.getElementById("rec");
    el.existing = window.__wavClip("ex");
  });
  await page.evaluate(() => {
    const el = document.getElementById("rec");
    window.__starts = [];
    el.services.audio.addEventListener("clip-start", (e) => window.__starts.push(e.detail.clipId));
  });
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => window.__starts.includes("ex"));
  assert.ok(await page.getByRole("button", { name: "Re-record" }).isVisible());
  assert.equal(await state(page), "ready");
  assert.equal(await page.evaluate(() => window.__recorded.length), 0);
});
