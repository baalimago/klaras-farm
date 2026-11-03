// PlayEngine: owns the ephemeral play world for the current place (ARCHITECTURE §4).
// Reads the FarmStore, never writes it. The Renderer calls step(dt) each frame and reads
// `actors`; the board calls tap / pick / fingerDown; guided add calls dropIn.
//
// Events:
//   'reaction' {thingId, x, y}   a tap reaction started (confetti), board coordinates
//   'ask'      {thingId, repeat}  Find it asked for a thing
//   'answer'   {thingId, outcome} Find it: 'correct' or 'wrong'
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
import { createFind, stepFind, answerFind, hintFor, findRemainingS } from "./play/find.js";
import { tapClips, playLanguageFor, clipsFor } from "./farm/intents.js";
import { cueLines } from "./farm/scripts.js";

const MODES = ["play", "edit", "scene"];

export class PlayEngine extends EventTarget {
  /**
   * @param {{store: import('./farm-store.js').FarmStore, audio: any, presets?: Object, rng?: () => number, flags?: Object, now?: () => number}} deps
   *   now: milliseconds, monotonic (defaults to performance.now)
   */
  constructor({ store, audio, presets = {}, scripts = {}, rng = Math.random, flags = {}, now = () => globalThis.performance.now() }) {
    super();
    this.store = store;
    this.audio = audio;
    this.presets = presets;
    this.scripts = scripts;
    this.rng = rng;
    this.flags = flags;
    this.now = now;
    /** Minimum hit radius in board widths (US-5.1: ≥ 120 CSS px across). The board sets it from its size: 60 / boardWidthPx. */
    this.hitMinRadius = 0.055;
    this._mode = "play";
    this._finger = false;
    this._mash = idleMash();
    this._pendingDrops = new Set();
    this._input = { fingerDown: false };
    this._lastStepAt = null;
    this._idleAtLastStep = true;
    this._find = createFind();
    this._prompting = false;
    this._askCount = 0;
    this._candidates = null; // cached Find it candidates, cleared on store change
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
    if (mode !== "play") this._find = createFind();
    this._wake();
  }

  /** Advances by dt seconds (the frame delta). Fixed timestep inside. */
  step(dt) {
    const t = this.now();
    let s = dt > 0 ? dt : 0;
    if (this._idleAtLastStep && this._lastStepAt !== null) s = Math.max(s, (t - this._lastStepAt) / 1000);
    this._lastStepAt = t;
    this._advance(s);
    this._idleAtLastStep = this.isIdle();
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
    const outcome = answerFind(this._find, id);
    if (outcome !== "none") this.dispatchEvent(new CustomEvent("answer", { detail: { thingId: id, outcome } }));
    if (outcome === "correct") return this._celebrate(id);
    const nowMs = this.now();
    const decision = decideTap(this._mash, id, nowMs);
    if (decision.action === "ignore") return id;
    const a = react(this.world, id);
    this.dispatchEvent(new CustomEvent("reaction", { detail: { thingId: id, x: a.x, y: a.y } }));
    if (decision.stopCurrent || this._prompting) this._call("stop");
    this._prompting = false;
    const snap = this.store.snapshot;
    const lang = this._langFor(snap, id, "name");
    const clips = tapClips(snap, id, lang);
    this._mash = startPlaying(this._mash, id, nowMs);
    const token = this._mash.token;
    // Called synchronously inside the tap so iOS treats it as user-initiated.
    const done = () => {
      this._mash = stopPlaying(this._mash, token);
      // Find it, wrong thing: after it says its own name, the question comes again (US-6.2).
      if (outcome === "wrong" && this._find.phase === "asking" && this._mash.playingId === null) this._ask(this._find.target, true);
    };
    let playing;
    if (clips.length) {
      playing = this._call("playThing", clips);
    } else {
      // No recording yet: a chime, then the device's voice says the name until a parent records it.
      this._call("chime", "tap");
      const name = this._nameFor(id, lang);
      playing = name ? this._call("speak", name.text, name.lang) : null;
    }
    Promise.resolve(playing).then(done, done);
    this._wake();
    return id;
  }

  /** Find it: what the farm is asking for right now (for tests and the hint glow), or null. */
  get asking() {
    return this._find.phase === "asking" ? this._find.target : null;
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

  /** True when nothing moves: the renderer can stop requesting frames. A hint glow pulses. */
  isIdle() {
    return isIdle(this.world) && hintFor(this._find) === null;
  }

  /** Milliseconds until something starts moving by itself (wander, blink, sleep); Infinity if never. */
  nextWakeMs() {
    const sleepS = sleepRemainingS(this._sleep);
    const findS = findRemainingS(this._find, this._findEnabled());
    const soonest = Math.min(sleepS, findS);
    return Math.min(nextWakeMs(this.world), soonest === Infinity ? Infinity : Math.ceil(soonest * 1000));
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
    // Things freeze while a question plays (DESIGN decision 7), like while a finger is down.
    this._input.fingerDown = this._finger || this._prompting;
    step(this.world, s, this._input, this.rng);
    if (this._mode === "play" && tickSleep(this._sleep, s)) sleepAll(this.world);
    if (this._mode === "play") {
      const calm = !this._finger && !this.world.asleep && !this._prompting && this._mash.playingId === null;
      const ev = stepFind(this._find, s, { enabled: this._findEnabled(), candidates: this._findCandidates(), calm }, this.rng);
      if (ev?.type === "ask") this._ask(ev.thingId, ev.repeat);
    }
    const hint = hintFor(this._find);
    for (const a of this.world.actors) a.glow = a.thingId === hint ? 1 : 0;
  }

  // ---- Find it ----

  _findEnabled() {
    return this._mode === "play" && this.store.currentPlace?.findIt === true;
  }

  /** Things Find it can ask for: a recorded question, or (until then) a name the device can say. */
  _findCandidates() {
    if (this._candidates) return this._candidates;
    const snap = this.store.snapshot;
    const canSpeak = !!this.audio?.canSpeak;
    this._candidates = this._things()
      .filter((t) => clipsFor(snap, t.id, { kind: "prompt" }).length > 0 || (canSpeak && Object.values(t.names ?? {}).some(Boolean)))
      .map((t) => t.id);
    return this._candidates;
  }

  /** The language for this play: fixed, or random among the languages recorded for the thing. */
  _langFor(snap, thingId, kind) {
    const available = [...new Set(clipsFor(snap, thingId, { kind }).map((c) => c.language))];
    return playLanguageFor(snap.settings, { available, rng: this.rng });
  }

  /** Plays the question for a thing: a recorded take (rotating), or the scripted cue in the device's voice. */
  _ask(thingId, repeat = false) {
    const snap = this.store.snapshot;
    const thing = snap.things.find((t) => t.id === thingId);
    if (!thing) return;
    const lang = this._langFor(snap, thingId, "prompt");
    const prompts = clipsFor(snap, thingId, { kind: "prompt" });
    const own = prompts.filter((c) => c.language === lang);
    const pool = own.length ? own : prompts;
    const n = this._askCount++;
    this._prompting = true;
    this.dispatchEvent(new CustomEvent("ask", { detail: { thingId, repeat } }));
    let playing;
    if (pool.length) {
      playing = this._call("playClip", pool[n % pool.length]);
    } else {
      const { lines, fallback } = cueLines(this.scripts, thing, lang);
      const line = lines.length ? lines[n % lines.length] : null;
      playing = line ? this._call("speak", line, fallback ? "en" : lang) : null;
    }
    const done = () => { this._prompting = false; this._wake(); };
    Promise.resolve(playing).then(done, done);
    this._wake();
  }

  /** Find it, right thing: a happy jump, confetti, a bright chime, then its name. */
  _celebrate(id) {
    this._call("stop");
    this._prompting = false;
    const a = react(this.world, id);
    this.dispatchEvent(new CustomEvent("reaction", { detail: { thingId: id, x: a.x, y: a.y, celebrate: true } }));
    this._call("chime", "yay");
    const snap = this.store.snapshot;
    const lang = this._langFor(snap, id, "name");
    const clips = tapClips(snap, id, lang).filter((c) => c.kind === "name");
    const nowMs = this.now();
    this._mash = startPlaying(this._mash, id, nowMs);
    const token = this._mash.token;
    const done = () => { this._mash = stopPlaying(this._mash, token); };
    const name = clips.length ? null : this._nameFor(id, lang);
    const playing = clips.length ? this._call("playThing", clips) : name ? this._call("speak", name.text, name.lang) : null;
    Promise.resolve(playing).then(done, done);
    this._wake();
    return id;
  }

  /** The typed name to say for a thing: in the play language if typed, else any typed name. */
  _nameFor(thingId, lang) {
    const thing = this.store.snapshot.things.find((t) => t.id === thingId);
    if (!thing?.names) return null;
    const base = lang.split("-")[0];
    if (thing.names[lang]) return { text: thing.names[lang], lang };
    if (thing.names[base]) return { text: thing.names[base], lang: base };
    const [l, text] = Object.entries(thing.names).find(([, v]) => v) ?? [];
    return text ? { text, lang: l } : null;
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
    this._idleAtLastStep = this.isIdle();
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
    this._candidates = null;
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
