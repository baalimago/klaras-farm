// AudioEngine playback with a fake AudioContext: the editing-sound mash guard (chime) and the
// colour game's gapless sequence (playSequence). Every node is a permissive fake; a buffer source
// "ends" on the next macrotask after start(), so sequences run in order without real audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../../web/js/io/audio.js";

function fakeParam() {
  return { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} };
}

/** A node that answers any method and has AudioParams on demand. */
function fakeNode(log, kind) {
  const node = {
    kind,
    connect: (n) => n ?? node,
    disconnect() {},
    start(...a) {
      log.push(["start", kind, node.buffer?.id ?? null, ...a]);
      if (kind === "source") setTimeout(() => node.onended?.(), 0);
    },
    stop() {},
  };
  return new Proxy(node, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "string" && /^(gain|frequency|detune|Q|threshold|knee|ratio|attack|release|delayTime|pan)$/.test(k)) return (t[k] = fakeParam());
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function fakeAudioContextClass(log) {
  return class {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = fakeNode(log, "destination");
    }
    resume() { this.state = "running"; return Promise.resolve(); }
    createBuffer() { return { duration: 0 }; }
    createBufferSource() { return fakeNode(log, "source"); }
    createGain() { return fakeNode(log, "gain"); }
    createOscillator() { return fakeNode(log, "osc"); }
    createDynamicsCompressor() { return fakeNode(log, "comp"); }
    createBiquadFilter() { return fakeNode(log, "filter"); }
    createStereoPanner() { return fakeNode(log, "pan"); }
    createDelay() { return fakeNode(log, "delay"); }
    createWaveShaper() { return fakeNode(log, "shaper"); }
    decodeAudioData(raw) {
      const id = new TextDecoder().decode(raw);
      return id === "bad" ? Promise.reject(new Error("cannot decode")) : Promise.resolve({ duration: 0.4, id });
    }
  };
}

const clip = (id, sha = id) => ({ id, blobSha256: sha, trimStartMs: 0, trimEndMs: 0, gainDb: 0 });
const blobs = { q: "q", word: "word", bad: "bad" };

function makeEngine() {
  const log = [];
  const engine = new AudioEngine({
    AudioContextClass: fakeAudioContextClass(log),
    getBlob: async (sha) => (blobs[sha] ? { bytes: new TextEncoder().encode(blobs[sha]).buffer } : null),
  });
  return { engine, log };
}

test("playSequence plays the colour question then the word, in order, as one utterance", async () => {
  const { engine, log } = makeEngine();
  const events = [];
  engine.addEventListener("clip-start", (e) => events.push(e.detail.clipId));
  assert.equal(await engine.playSequence([clip("q"), clip("word")]), true);
  assert.deepEqual(events, ["q", "word"]);
  const started = log.filter((l) => l[0] === "start" && l[1] === "source" && l[2]).map((l) => l[2]);
  assert.deepEqual(started, ["q", "word"]);
});

test("playSequence skips a clip that cannot play, reports it, and does not chime", async () => {
  const { engine } = makeEngine();
  const failed = [];
  const chimes = [];
  engine.addEventListener("decode-failed", (e) => failed.push(e.detail.clipId));
  engine.addEventListener("chime", (e) => chimes.push(e.detail.kind));
  assert.equal(await engine.playSequence([clip("bad"), clip("word")]), false, "not everything played");
  assert.deepEqual(failed, ["bad"]);
  assert.equal(await engine.playSequence([clip("missing")]), false);
  assert.deepEqual(chimes, [], "the colour game falls back on its own; no failure chime here");
  assert.equal(await engine.playThing([clip("missing")]), false);
  assert.deepEqual(chimes, ["tap"], "playThing chimes when nothing could play");
});

test("stop() during a sequence ends it: the word never starts", async () => {
  const { engine } = makeEngine();
  const events = [];
  engine.addEventListener("clip-start", (e) => {
    events.push(e.detail.clipId);
    engine.stop();
  });
  assert.equal(await engine.playSequence([clip("q"), clip("word")]), false);
  assert.deepEqual(events, ["q"]);
});

test("an editing sound mashed within CHIME_REPEAT_S plays once; the child's chimes are never skipped", () => {
  const { engine } = makeEngine();
  const real = globalThis.performance.now;
  let t = 1000;
  globalThis.performance.now = () => t;
  try {
    const first = engine.chime("pick");
    assert.ok(first > 0, "the first pick plays");
    t += 10;
    assert.equal(engine.chime("pick"), 0, "a second pick 10 ms later is the same sound");
    assert.ok(engine.chime("drop") > 0, "another editing kind plays");
    t += 100;
    assert.ok(engine.chime("pick") > 0, "after the repeat window it plays again");
    assert.ok(engine.chime("tap") > 0 && engine.chime("tap") > 0, "the child's tap is not throttled here");
    assert.equal(engine.chime("no-such-sound"), 0);
  } finally {
    globalThis.performance.now = real;
  }
});
