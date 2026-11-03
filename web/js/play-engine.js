// PlayEngine: owns the ephemeral play world for the current place (ARCHITECTURE §4).
// Reads the FarmStore, never writes it. The Renderer calls step(dt) each frame and reads
// `actors`; the board calls tap / pick / fingerDown; guided add calls dropIn.
//
// Events:
//   'reaction' {thingId, x, y}   a tap reaction started (confetti), board coordinates
//   'wake'     {}                something started moving without a frame being requested
//                                (tap, drop, mode change, store change, finger lifted):
//                                the renderer should wake() its loop.
//
// Time: step(dt) takes the frame delta. While the world is idle the renderer may stop calling
// step; the engine then counts the idle gap with its own clock (`now`), so a wake-up step can pass
// any dt (even 0). Pass the frame delta, not the time since the last frame before the loop stopped.
import { createWorld, syncWorld, step, setMode, react, dropActor, sleepAll, isIdle, nextWakeMs, hitTargets, actorFor } from "./play/world.js";
import { hitTest } from "./play/hit.js";
import { decideTap, idleMash, startPlaying, stopPlaying } from "./play/mash.js";
import { createSleep, tickSleep, sleepRemainingS } from "./play/sleep.js";
import { tapClips, playLanguageFor } from "./farm/intents.js";

const MODES = ["play", "edit", "scene"];

export class PlayEngine extends EventTarget {
  /**
   * @param {{store: import('./farm-store.js').FarmStore, audio: any, presets?: Object, rng?: () => number, flags?: Object, now?: () => number}} deps
   *   now: milliseconds, monotonic (defaults to performance.now)
   */
  constructor({ store, audio, presets = {}, rng = Math.random, flags = {}, now = () => globalThis.performance.now() }) {
    super();
    this.store = store;
    this.audio = audio;
    this.presets = presets;
    this.rng = rng;
    this.flags = flags;
    this.now = now;
    /** Minimum hit radius in board widths (US-5.1: ≥ 120 CSS px across). The board sets it from its size: 60 / boardWidthPx. */
    this.hitMinRadius = 0.055;
    this._mode = "play";
    this._finger = false;
    this._mash = idleMash();
    this._tapCount = 0;
    this._pendingDrops = new Set();
    this._input = { fingerDown: false };
    this._lastStepAt = null;
    this._idleAtLastStep = true;
    const settings = store.settings ?? {};
    this._sleepMinutes = settings.sleepMinutes ?? 0;
    this._sleep = createSleep(this._sleepMinutes);
    this._placeId = store.currentPlace?.id ?? null;
    this.world = createWorld(this._things(), { rng, presets, reduceMotion: !!settings.reduceMotion });
    this._onChange = (e) => this._storeChanged(e.detail ?? {});
    store.addEventListener("change", this._onChange);
  }

  /** @returns {import('./types.js').Actor[]} the same array, mutated in place */
  get actors() { return this.world.actors; }
  get mode() { return this._mode; }

  /** @param {'play'|'edit'|'scene'} mode */
  setMode(mode) {
    if (!MODES.includes(mode) || mode === this._mode) return;
    this._catchUp();
    this._mode = mode;
    setMode(this.world, mode, this.rng);
    if (mode === "play") this._sleep = createSleep(this._sleepMinutes);
    this._sleep.paused = mode !== "play";
    this._wake();
  }

  /** Advances by dt seconds (the frame delta). Fixed timestep inside. */
  step(dt) {
    const t = this.now();
    let s = dt > 0 ? dt : 0;
    if (this._idleAtLastStep && this._lastStepAt !== null) s = Math.max(s, (t - this._lastStepAt) / 1000);
    this._lastStepAt = t;
    this._advance(s);
    this._idleAtLastStep = isIdle(this.world);
  }

  /** A child's tap in play, board coordinates. Returns the thing hit, or null. */
  tap(x, y) {
    if (this._mode !== "play") return null;
    this._catchUp();
    const id = this._hit(x, y);
    if (!id) return null;
    if (this.world.asleep) {
      react(this.world, id); // a sleepy stir, no sound: play has ended gently (US-5.4)
      this._wake();
      return id;
    }
    const nowMs = this.now();
    const decision = decideTap(this._mash, id, nowMs);
    if (decision.action === "ignore") return id;
    const a = react(this.world, id);
    this.dispatchEvent(new CustomEvent("reaction", { detail: { thingId: id, x: a.x, y: a.y } }));
    if (decision.stopCurrent) this._call("stop");
    const snap = this.store.snapshot;
    const clips = tapClips(snap, id, playLanguageFor(snap.settings, this._tapCount++));
    this._mash = startPlaying(this._mash, id, nowMs);
    const token = this._mash.token;
    if (clips.length) {
      // Called synchronously inside the tap so iOS treats it as user-initiated.
      const done = () => { this._mash = stopPlaying(this._mash, token); };
      Promise.resolve(this._call("playThing", clips)).then(done, done);
    } else {
      this._call("chime", "tap");
    }
    this._wake();
    return id;
  }

  /** Which thing is at (x, y), in any mode (edit mode taps). */
  pick(x, y) {
    return this._hit(x, y);
  }

  /** All things pause while a finger is down (US-5.3). */
  fingerDown(down) {
    down = !!down;
    if (down === this._finger) return;
    this._catchUp();
    this._finger = down;
    this._input.fingerDown = down;
    this.world.finger = down;
    if (!down) this._wake();
  }

  /** True when nothing moves: the renderer can stop requesting frames. */
  isIdle() {
    return isIdle(this.world);
  }

  /** Milliseconds until something starts moving by itself (wander, blink, sleep); Infinity if never. */
  nextWakeMs() {
    const sleepS = sleepRemainingS(this._sleep);
    return Math.min(nextWakeMs(this.world), sleepS === Infinity ? Infinity : Math.ceil(sleepS * 1000));
  }

  /** A newly added thing falls into place. Works before or after the store's change event. */
  dropIn(thingId) {
    this._catchUp();
    if (dropActor(this.world, thingId)) this._wake();
    else this._pendingDrops.add(thingId);
  }

  /** The live actor of a thing (for badges, confetti), or null. */
  actorFor(thingId) {
    return actorFor(this.world, thingId);
  }

  dispose() {
    this.store.removeEventListener("change", this._onChange);
  }

  // ---- internals ----

  _things() {
    const place = this.store.currentPlace;
    return place ? this.store.thingsIn(place.id) : [];
  }

  _hit(x, y) {
    return hitTest(hitTargets(this.world), [x, y], { minRadius: this.hitMinRadius });
  }

  _advance(s) {
    this._input.fingerDown = this._finger;
    step(this.world, s, this._input, this.rng);
    if (this._mode === "play" && tickSleep(this._sleep, s)) sleepAll(this.world);
  }

  /** Before an outside event changes the world, account for the idle time since the last step. */
  _catchUp() {
    const t = this.now();
    if (this._lastStepAt === null) { this._lastStepAt = t; return; }
    if (!this._idleAtLastStep) return; // the renderer is running and will step
    const gap = (t - this._lastStepAt) / 1000;
    this._lastStepAt = t;
    if (gap > 0) this._advance(gap);
  }

  _wake() {
    this._idleAtLastStep = isIdle(this.world);
    this.dispatchEvent(new CustomEvent("wake", { detail: {} }));
  }

  _call(method, ...args) {
    try {
      return this.audio?.[method]?.(...args);
    } catch {
      return undefined; // audio trouble never breaks play
    }
  }

  _storeChanged(detail) {
    this._catchUp();
    const settings = this.store.settings ?? {};
    const minutes = settings.sleepMinutes ?? 0;
    if (minutes !== this._sleepMinutes) {
      this._sleepMinutes = minutes;
      if (!this.world.asleep) {
        this._sleep = createSleep(minutes);
        this._sleep.paused = this._mode !== "play";
      }
    }
    this.world.speedFactor = settings.reduceMotion ? 0.5 : 1;
    const placeId = this.store.currentPlace?.id ?? null;
    const switched = placeId !== this._placeId && this._placeId !== null && detail.kind !== "replaced" && detail.kind !== "hydrated";
    this._placeId = placeId;
    syncWorld(this.world, this._things(), this.rng, { drop: switched });
    for (const id of this._pendingDrops) if (dropActor(this.world, id)) this._pendingDrops.delete(id);
    this._wake();
  }
}
