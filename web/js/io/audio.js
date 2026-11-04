// AudioEngine: one AudioContext for voices and chimes (ARCHITECTURE §8, US-1.3, US-4.5, US-5.1, US-5.2).
//
// Graph:  clip source → clip gain (trim fades, gainDb) ┐
//                                     chime bus (−8 dB) ┼→ limiter (DynamicsCompressor) → output → speakers
//          music bus (io/music.js) → duck (dips while talking) ┘
//
// unlock() and resume() must be called synchronously inside gesture handlers (iPad).
// Decoded buffers are cached by sha256 with a byte budget (LRU); decodeAudioData gets a copy.
// Events: 'clip-start' {clipId, offsetS, durationS, gainDb}, 'clip-end' {clipId}, 'chime' {kind},
//         'decode-failed' {clipId, sha256, reason}, 'statechange' {state}.
import { CHIMES, CHIME_BUS_DB, HOLD_TONE, SILENT, chimeDuration } from "../dsp/chimes.js";
import { fromDb } from "../dsp/level.js";
import { MUSIC_DUCK_DB } from "../dsp/music.js";

const FADE_S = 0.005; // click-free clip edges
const DEFAULT_BUDGET = 24 * 1024 * 1024; // ~2 min of decoded stereo at 48 kHz
const SPEECH_START_MS = 2500; // the device voice must start by then, or the question falls back to a clip
const SPEECH_RETRY_MS = 120; // an utterance that ended without starting is tried once more after this

export class AudioEngine extends EventTarget {
  /**
   * @param {{getBlob: (sha:string) => Promise<import('../types.js').BlobRecord|null>, budgetBytes?: number, AudioContextClass?: any, speechStartMs?: number}} opts
   */
  constructor({ getBlob, budgetBytes = DEFAULT_BUDGET, AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext, speechStartMs = SPEECH_START_MS } = {}) {
    super();
    this._getBlob = getBlob ?? (async () => null);
    this._budget = budgetBytes;
    this._AC = AudioContextClass;
    this._ctx = null;
    /** @type {Map<string, {buffer: AudioBuffer, bytes: number}>} insertion order = LRU order */
    this._cache = new Map();
    this._cacheBytes = 0;
    this._inflight = new Map();
    this._broken = new Set();
    this._token = 0;
    this._current = null; // {src, gain, finish}
    this._hold = null;
    this._primed = false;
    this.sessionType = "playback";
    this._talking = 0;
    this._speechStartMs = speechStartMs;
    this._speakToken = 0; // stopSpeaking() bumps it: an older utterance ending is "not heard"
    this._speechPrimed = false;
    this._voices = null;
    this._voicesWatched = false;
  }

  // ---- context and unlocking ----

  /** The AudioContext, created on first use (it starts suspended until a gesture resumes it). */
  get context() {
    return this._ensure();
  }

  /** Master output after the limiter (tests connect analysers here). */
  get output() {
    this._ensure();
    return this._out;
  }

  /** 'locked' before the context exists, then the context's state ('running', 'suspended', 'interrupted', 'closed'). */
  get state() {
    if (!this._AC) return "unsupported";
    return this._ctx?.state ?? "locked";
  }

  /** Call synchronously in pointerdown/pointerup. Creates and resumes the context and primes output on iOS. */
  unlock() {
    const ctx = this._ensure();
    if (!ctx) return;
    if (ctx.state !== "running") this._resume(ctx);
    if (!this._primed) {
      // iOS only opens the output once something has been started inside a gesture.
      this._primed = true;
      this.setSessionType(this.sessionType);
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start();
      } catch {}
    }
  }

  /** After visibility changes, interruptions or a tap. Harmless when already running. */
  resume() {
    if (this._ctx && this._ctx.state !== "running" && this._ctx.state !== "closed") this._resume(this._ctx);
  }

  /** 'playback' while playing (ignores the mute switch); 'play-and-record' only while recording. */
  setSessionType(type) {
    this.sessionType = type;
    try {
      if (globalThis.navigator?.audioSession) globalThis.navigator.audioSession.type = type;
    } catch {}
  }

  // ---- clips ----

  /** Decodes clips ahead of time (current place) so taps start within the latency budget. */
  async preload(clips) {
    await Promise.all(clips.map((c) => this._buffer(c).catch((e) => this._failed(c, e))));
  }

  /** Name then sound. Stops anything playing. Resolves true when all played, false when interrupted or none could play. */
  playThing(clips) {
    return this._sequence(clips, { chimeOnFail: true });
  }

  /** Clips one after another as one utterance (the colour game: question, then colour word). Stops anything playing. */
  playSequence(clips) {
    return this._sequence(clips, { chimeOnFail: false });
  }

  /** One clip (parent previews). `opts.bytes` plays a take that isn't stored yet. */
  playClip(clip, opts = {}) {
    return this._sequence([clip], { chimeOnFail: false, bytes: opts.bytes });
  }

  /** Stops the playing clip (with a short fade) and any built-in speech. */
  stop() {
    this._token++;
    this._stopCurrent();
    this.stopSpeaking();
  }

  // ---- built-in voice (until a parent records) ----

  /** True when the device has a speech synthesiser. */
  get canSpeak() {
    return typeof globalThis.speechSynthesis !== "undefined" && typeof globalThis.SpeechSynthesisUtterance !== "undefined";
  }

  /**
   * Says `text` with the device's voice in `lang` (BCP 47), while a thing has no recording of its
   * own. Call it synchronously inside a gesture: iOS refuses the first utterance of a page outside
   * one (silently, with no events). Resolves true once the voice has started and finished, false
   * when it was not heard (never started, an error, or stopped); never rejects.
   * iOS quirks handled here (playtest round 3, the silent "Where is…?"): an idle synthesiser is
   * never cancelled (cancel() then speak() in one tick drops the new utterance on WebKit); an
   * utterance that ends or errors without starting is tried once more; and one that has not
   * started after SPEECH_START_MS counts as not heard, so the caller can fall back.
   */
  speak(text, lang = "en", { rate = 0.85, pitch = 1.15 } = {}) {
    if (!this.canSpeak || !text) return Promise.resolve(false);
    const synth = globalThis.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();
    this._speechPrimed = true;
    const token = ++this._speakToken;
    const voice = pickVoice(this._voiceList(), lang);
    const make = () => {
      const u = new globalThis.SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.pitch = pitch;
      if (voice) u.voice = voice;
      return u;
    };
    this.dispatchEvent(new CustomEvent("speak", { detail: { text, lang } }));
    this._talk(1);
    return new Promise((ok) => {
      let settled = false;
      let started = false;
      let retried = false;
      let endTimer = 0;
      let startTimer = 0;
      const done = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        clearTimeout(endTimer);
        this._talk(-1);
        ok(v);
      };
      const notStarted = () => {
        if (token !== this._speakToken || retried) return done(false);
        retried = true;
        clearTimeout(startTimer); // the retry gets its own start timeout
        setTimeout(() => { if (!settled && token === this._speakToken) say(); }, SPEECH_RETRY_MS);
      };
      const say = () => {
        const u = make();
        u.onstart = () => {
          started = true;
          clearTimeout(startTimer);
          endTimer = setTimeout(() => done(true), 4000 + text.length * 120);
        };
        u.onend = () => (started ? done(token === this._speakToken) : notStarted());
        u.onerror = () => (started ? done(false) : notStarted());
        clearTimeout(startTimer);
        startTimer = setTimeout(() => {
          if (started || settled) return;
          done(false);
          if (token === this._speakToken) synth.cancel(); // a late start would talk over what comes next
        }, this._speechStartMs);
        synth.speak(u);
      };
      say();
    });
  }

  /** Stops the device voice. Pending speak() calls resolve false (not heard). */
  stopSpeaking() {
    if (!this.canSpeak) return;
    this._speakToken++;
    const synth = globalThis.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();
  }

  /**
   * iOS lets a page speak only after one utterance was started inside a gesture. Call it in an
   * activation event (pointerup, click): it starts a silent utterance once, unless something
   * already spoke, so later questions started from any handler are heard.
   */
  primeSpeech() {
    if (!this.canSpeak || this._speechPrimed) return;
    this._speechPrimed = true;
    const synth = globalThis.speechSynthesis;
    if (synth.speaking || synth.pending) return;
    try {
      const u = new globalThis.SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    } catch {}
  }

  /** Voices load late on iOS (getVoices() is empty until 'voiceschanged'); the list is kept fresh. */
  _voiceList() {
    const synth = globalThis.speechSynthesis;
    if (!this._voicesWatched && synth?.addEventListener) {
      this._voicesWatched = true;
      synth.addEventListener("voiceschanged", () => { this._voices = synth.getVoices?.() ?? []; });
    }
    if (!this._voices?.length) this._voices = synth?.getVoices?.() ?? [];
    return this._voices;
  }

  // ---- background music ----

  /** The music bus (created with the context); null before the first gesture. */
  get musicBus() {
    return this._ensure() ? this._musicBus : null;
  }

  /** True while a recording or the built-in voice is playing. */
  get talking() {
    return this._talking > 0;
  }

  _talk(delta) {
    const was = this._talking > 0;
    this._talking = Math.max(0, this._talking + delta);
    const now = this._talking > 0;
    if (was === now || !this._musicDuck) return;
    const g = this._musicDuck.gain, t = this._ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    // Dip fast before the voice; come back slowly after it.
    g.linearRampToValueAtTime(now ? fromDb(MUSIC_DUCK_DB) : 1, t + (now ? 0.12 : 0.9));
  }

  /** True when this clip's blob failed to decode on this device (US-4.5: flag "re-record"). */
  isBroken(clip) {
    return this._broken.has(clip?.blobSha256);
  }

  /** Decodes bytes (a copy; the input stays usable). Used by the Recorder for analysis. */
  decode(arrayBuffer) {
    const ctx = this._ensure();
    if (!ctx) return Promise.reject(new Error("audio unsupported"));
    const copy = arrayBuffer.slice(0);
    return new Promise((ok, fail) => {
      const p = ctx.decodeAudioData(copy, ok, (e) => fail(e ?? new Error("decode failed")));
      p?.then?.(ok, fail); // modern engines return a promise; old WebKit only calls back
    });
  }

  cachedShas() {
    return [...this._cache.keys()];
  }

  get cacheBytes() {
    return this._cacheBytes;
  }

  // ---- chimes ----

  /** Plays a soft synthesised chime ('tap','enter','leave','start','stop','plink','poof','hold-done'). Returns its length in s. */
  chime(kind) {
    const ctx = this._ensure();
    if (!ctx || !CHIMES[kind]) return 0;
    this.resume();
    synthChime(ctx, this._chimeBus, kind, ctx.currentTime + 0.005);
    this.dispatchEvent(new CustomEvent("chime", { detail: { kind } }));
    return chimeDuration(kind);
  }

  /** The soft tone that rises with the hold ring. */
  holdTone(on) {
    const ctx = this._ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (on) {
      if (this._hold) return;
      this.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = HOLD_TONE.wave;
      osc.frequency.setValueAtTime(HOLD_TONE.freq, t);
      osc.frequency.exponentialRampToValueAtTime(HOLD_TONE.toFreq, t + HOLD_TONE.rise);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(HOLD_TONE.gain, t + HOLD_TONE.attack);
      osc.connect(g).connect(this._chimeBus);
      osc.start(t);
      this._hold = { osc, g };
    } else if (this._hold) {
      const { osc, g } = this._hold;
      this._hold = null;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + HOLD_TONE.release);
      osc.stop(t + HOLD_TONE.release + 0.02);
    }
  }

  // ---- internals ----

  _ensure() {
    if (this._ctx || !this._AC) return this._ctx;
    let ctx;
    try {
      ctx = new this._AC({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    this._ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    this._out = ctx.createGain();
    limiter.connect(this._out).connect(ctx.destination);
    this._limiter = limiter;
    this._voice = ctx.createGain();
    this._voice.connect(limiter);
    this._chimeBus = ctx.createGain();
    this._chimeBus.gain.value = fromDb(CHIME_BUS_DB);
    this._chimeBus.connect(limiter);
    // Background music: its own bus, faded by io/music.js and ducked while a voice plays.
    this._musicBus = ctx.createGain();
    this._musicBus.gain.value = 0;
    this._musicDuck = ctx.createGain();
    this._musicBus.connect(this._musicDuck).connect(limiter);
    ctx.addEventListener?.("statechange", () => {
      this.dispatchEvent(new CustomEvent("statechange", { detail: { state: ctx.state } }));
      // WebKit 'interrupted' (calls, Siri) and unexpected suspends: try to come back; if iOS
      // insists on a gesture, the next tap's unlock() resumes and plays (US-1.3).
      if ((ctx.state === "interrupted" || ctx.state === "suspended") && globalThis.document?.visibilityState === "visible") this._resume(ctx);
    });
    return ctx;
  }

  _resume(ctx) {
    try {
      ctx.resume()?.catch?.(() => {});
    } catch {}
  }

  async _sequence(clips, { chimeOnFail, bytes }) {
    const token = ++this._token;
    this._stopCurrent();
    const ctx = this._ensure();
    if (!ctx) return false;
    this.resume();
    this._talk(1);
    try {
      return await this._sequenceInner(clips, { chimeOnFail, bytes, token });
    } finally {
      this._talk(-1);
    }
  }

  async _sequenceInner(clips, { chimeOnFail, bytes, token }) {
    let played = 0;
    // Decode every clip up front, so the second starts the moment the first ends (no decode gap).
    const buffers = clips.map((clip) => (clip ? this._buffer(clip, bytes) : null));
    for (const b of buffers) b?.catch(() => {});
    for (const [i, clip] of clips.entries()) {
      if (!clip) continue;
      let buffer;
      try {
        buffer = await buffers[i];
      } catch (e) {
        if (token === this._token) this._failed(clip, e);
        continue;
      }
      if (token !== this._token) return false;
      if (!(await this._play(buffer, clip, token))) return false;
      played++;
    }
    if (token !== this._token) return false;
    if (chimeOnFail && clips.length && !played) this.chime("tap");
    return played > 0 && played === clips.filter(Boolean).length;
  }

  _play(buffer, clip, token) {
    const ctx = this._ctx;
    const dur = buffer.duration;
    let offset = Math.min(Math.max(0, (clip.trimStartMs || 0) / 1000), dur);
    let end = clip.trimEndMs > clip.trimStartMs ? Math.min(dur, clip.trimEndMs / 1000) : dur;
    if (end - offset < 0.02) { offset = 0; end = dur; }
    const length = end - offset;
    const level = fromDb(Number.isFinite(clip.gainDb) ? clip.gainDb : 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    const t = ctx.currentTime + 0.002;
    const fade = Math.min(FADE_S, length / 4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + fade);
    g.gain.setValueAtTime(level, t + length - fade);
    g.gain.linearRampToValueAtTime(0, t + length);
    src.connect(g).connect(this._voice);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (completed) => {
        if (settled) return;
        settled = true;
        if (this._current?.src === src) this._current = null;
        try { g.disconnect(); } catch {}
        if (completed) this.dispatchEvent(new CustomEvent("clip-end", { detail: { clipId: clip.id } }));
        resolve(completed && token === this._token);
      };
      src.onended = () => finish(true);
      this._current = { src, gain: g, finish };
      src.start(t, offset, length);
      this.dispatchEvent(new CustomEvent("clip-start", { detail: { clipId: clip.id, offsetS: offset, durationS: length, gainDb: clip.gainDb ?? 0 } }));
    });
  }

  _stopCurrent() {
    const cur = this._current;
    if (!cur) return;
    this._current = null;
    const t = this._ctx.currentTime;
    try {
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
      cur.src.onended = null;
      cur.src.stop(t + FADE_S + 0.005);
    } catch {}
    cur.finish(false);
  }

  async _buffer(clip, bytes) {
    const sha = clip.blobSha256;
    const hit = this._cache.get(sha);
    if (hit) {
      this._cache.delete(sha);
      this._cache.set(sha, hit);
      return hit.buffer;
    }
    if (this._broken.has(sha)) throw Object.assign(new Error("broken"), { reason: "decode" });
    let pending = this._inflight.get(sha);
    if (!pending) {
      pending = (async () => {
        const raw = bytes ?? (await this._getBlob(sha))?.bytes;
        if (!raw) throw Object.assign(new Error("missing blob"), { reason: "missing" });
        let buffer;
        try {
          buffer = await this.decode(raw);
        } catch (e) {
          this._broken.add(sha);
          throw Object.assign(new Error(e?.message ?? "decode failed"), { reason: "decode" });
        }
        this._remember(sha, buffer);
        return buffer;
      })().finally(() => this._inflight.delete(sha));
      this._inflight.set(sha, pending);
    }
    return pending;
  }

  _remember(sha, buffer) {
    const bytes = buffer.length * buffer.numberOfChannels * 4;
    this._cache.set(sha, { buffer, bytes });
    this._cacheBytes += bytes;
    for (const [k, v] of this._cache) {
      if (this._cacheBytes <= this._budget || k === sha) break;
      this._cache.delete(k);
      this._cacheBytes -= v.bytes;
    }
  }

  _failed(clip, e) {
    this.dispatchEvent(new CustomEvent("decode-failed", { detail: { clipId: clip.id, sha256: clip.blobSha256, reason: e?.reason ?? "decode" } }));
  }
}

// ---- chime synthesis (works on any BaseAudioContext) ----

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

/** Schedules one chime from dsp/chimes.js into `dest` at `when`. */
/** The best voice for a language: exact tag, then same base language, local voices first. */
export function pickVoice(voices, lang) {
  const base = String(lang).toLowerCase().split("-")[0];
  const norm = (v) => String(v.lang || "").toLowerCase().replace("_", "-");
  const ranked = voices
    .filter((v) => norm(v).split("-")[0] === base)
    .sort((a, b) => (norm(b) === lang.toLowerCase()) - (norm(a) === lang.toLowerCase()) || (b.localService === true) - (a.localService === true));
  return ranked[0] ?? null;
}

export function synthChime(ctx, dest, kind, when) {
  synthNotes(ctx, dest, CHIMES[kind] ?? [], when);
}

/** Schedules notes in the chime note shape (dsp/chimes.js) into `dest`, starting at `when`. */
export function synthNotes(ctx, dest, notes, when) {
  for (const n of notes) {
    const t0 = when + n.at;
    const end = t0 + n.attack + n.decay;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(n.gain, t0 + n.attack);
    env.gain.exponentialRampToValueAtTime(SILENT, end);
    let out = env;
    if (n.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 0;
      f.frequency.setValueAtTime(n.filter, t0);
      if (n.toFilter) f.frequency.exponentialRampToValueAtTime(n.toFilter, end);
      env.connect(f);
      out = f;
    }
    out.connect(dest);
    const sources = [];
    if (n.wave === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      src.connect(env);
      sources.push(src);
    } else {
      for (const [ratio, rel] of [[1, 1], ...(n.partials ?? [])]) {
        const osc = ctx.createOscillator();
        osc.type = ratio === 1 ? n.wave : "sine";
        osc.frequency.setValueAtTime(n.freq * ratio, t0);
        if (n.toFreq) osc.frequency.exponentialRampToValueAtTime(n.toFreq * ratio, t0 + (n.slide ?? n.decay));
        if (rel === 1) osc.connect(env);
        else {
          const pg = ctx.createGain();
          pg.gain.value = rel;
          osc.connect(pg).connect(env);
        }
        sources.push(osc);
      }
    }
    for (const s of sources) {
      s.start(t0);
      s.stop(end + 0.02);
    }
  }
}

/** Renders a chime through the same chime bus and limiter offline; returns mono samples. */
export async function renderChime(kind, sampleRate = 44100) {
  const OAC = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  const ctx = new OAC(1, Math.ceil((chimeDuration(kind) + 0.1) * sampleRate), sampleRate);
  const bus = ctx.createGain();
  bus.gain.value = fromDb(CHIME_BUS_DB);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  bus.connect(limiter).connect(ctx.destination);
  synthChime(ctx, bus, kind, 0);
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}
