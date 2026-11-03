// MusicPlayer: plays the generated lullaby (dsp/music.js) quietly under play.
//
// Plays only while `shouldPlay()` says so (play mode, page visible, not asleep, switched on).
// One timer per bar schedules the next bar about a bar ahead on the AudioContext clock, so
// timing stays sample-exact while the main thread does nothing in between (the renderer can
// stay idle). Fades in and out on the music bus; AudioEngine ducks it under voices.
// The on/off choice is a device preference in localStorage (not part of the farm snapshot).
import { musicBar, BAR_S, MUSIC_BUS_DB, MUSIC_FADE_S } from "../dsp/music.js";
import { fromDb } from "../dsp/level.js";
import { synthNotes } from "./audio.js";

const PREF_KEY = "kf.music";
const LOOKAHEAD_S = 0.4;

export class MusicPlayer {
  /**
   * @param {{audio: import('./audio.js').AudioEngine, shouldPlay: () => boolean, storage?: Storage|null, seed?: number}} opts
   */
  constructor({ audio, shouldPlay, storage = safeStorage(), seed = (Date.now() % 9973) + 1 }) {
    this.audio = audio;
    this.shouldPlay = shouldPlay;
    this._storage = storage;
    this._seed = seed;
    this._bar = 0;
    this._nextBarAt = 0;
    this._timer = null;
    this._playing = false;
  }

  /** On unless a grown-up switched it off in Settings. */
  get enabled() {
    try { return this._storage?.getItem(PREF_KEY) !== "off"; } catch { return true; }
  }

  set enabled(on) {
    try { this._storage?.setItem(PREF_KEY, on ? "on" : "off"); } catch {}
    this.update();
  }

  get playing() {
    return this._playing;
  }

  /** Re-checks whether music should be playing. Call on mode, visibility and sleep changes and after a tap. */
  update() {
    const want = this.enabled && this.shouldPlay() && this.audio.state === "running";
    if (want && !this._playing) this._start();
    else if (!want && this._playing) this._stop();
  }

  _start() {
    const bus = this.audio.musicBus;
    if (!bus) return;
    const ctx = this.audio.context;
    this._playing = true;
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(fromDb(MUSIC_BUS_DB), t + MUSIC_FADE_S);
    this._nextBarAt = Math.max(this._nextBarAt, t + 0.1);
    this._tick();
  }

  _stop() {
    this._playing = false;
    clearTimeout(this._timer);
    this._timer = null;
    const ctx = this.audio.context;
    const bus = this.audio.musicBus;
    if (!ctx || !bus) return;
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_S / 2);
    // Notes already scheduled ring out under the fade; the next start begins a fresh bar.
    this._nextBarAt = t + MUSIC_FADE_S / 2;
  }

  _tick() {
    if (!this._playing) return;
    if (!(this.enabled && this.shouldPlay() && this.audio.state === "running")) return this._stop();
    const ctx = this.audio.context;
    // Schedule every bar that starts before the next wake-up plus the lookahead.
    while (this._nextBarAt < ctx.currentTime + BAR_S + LOOKAHEAD_S) {
      if (this._nextBarAt < ctx.currentTime) this._nextBarAt = ctx.currentTime + 0.05; // after a stall, don't cram
      synthNotes(ctx, this.audio.musicBus, musicBar(this._bar, this._seed), this._nextBarAt);
      this._bar++;
      this._nextBarAt += BAR_S;
    }
    const waitS = Math.max(0.1, this._nextBarAt - ctx.currentTime - LOOKAHEAD_S - BAR_S / 2);
    this._timer = setTimeout(() => this._tick(), waitS * 1000);
  }

  dispose() {
    this._stop();
  }
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Renders `bars` bars of music offline at full bus level (no fade, no duck); returns mono samples. */
export async function renderMusic(bars = 8, seed = 1, sampleRate = 44100) {
  const OAC = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  const ctx = new OAC(1, Math.ceil((bars * BAR_S + 4) * sampleRate), sampleRate);
  const bus = ctx.createGain();
  bus.gain.value = fromDb(MUSIC_BUS_DB);
  bus.connect(ctx.destination);
  for (let b = 0; b < bars; b++) synthNotes(ctx, bus, musicBar(b, seed), b * BAR_S);
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}
