// PlayEngine: owns the ephemeral play world for the current place (ARCHITECTURE §4).
// Reads the FarmStore, never writes it. The Renderer calls step(dt) each frame and reads
// `actors`; the board calls tap / pick / fingerDown; guided add calls dropIn; the find buttons
// call startFind.
//
// Events:
//   'reaction' {thingId, x, y}   a tap reaction started (confetti), board coordinates
//   'ask'      {kind, thingId, color, repeat}  a find game asked ('animal': thingId; 'color': color)
//   'answer'   {thingId, outcome} a find game: 'correct' or 'wrong'
//   'find'     {round, available} the find game state changed (a round started or ended, or the
//                                buttons should show or hide): <kf-find-buttons> listens
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
import { createFind, startRound, endRound, stepFind, answerFind, isAnswer, hinting, reconcileFind, findRemainingS } from "./play/find.js";
import { tapClips, playLanguageFor, clipsFor, gameClips } from "./farm/intents.js";
import { planAnimalAsk, planColorAsk, colorAskLanguage, recordedColorLangs } from "./play/ask.js";
import { cueLines, colorLine } from "./farm/scripts.js";

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
    this._lastAskClipId = null; // the last recorded question played, so the next one differs
    this._askToken = 0;   // the latest question; an older one finishing doesn't unfreeze things
    this._roundToken = 0; // the latest find round; callbacks of an older round do nothing
    this._glowIds = new Set(); // find hint: the right thing(s) glow after 2 misses
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
    if (mode !== "play") this._endFind();
    this._wake();
    this._emitFind();
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
    const round = this._roundToken;
    const outcome = answerFind(this._find, id, this._colorOf(id));
    if (outcome !== "none") this.dispatchEvent(new CustomEvent("answer", { detail: { thingId: id, outcome } }));
    if (outcome === "correct") {
      this._endFind();
      this._emitFind();
      return this._celebrate(id);
    }
    if (outcome === "wrong" && hinting(this._find)) this._glowIds = new Set(this._answerIds());
    const nowMs = this.now();
    const decision = decideTap(this._mash, id, nowMs);
    if (decision.action === "ignore") return id;
    const a = react(this.world, id);
    this.dispatchEvent(new CustomEvent("reaction", { detail: { thingId: id, x: a.x, y: a.y } }));
    if (decision.stopCurrent || this._prompting) this._call("stop");
    this._prompting = false;
    this._askToken++;
    const snap = this.store.snapshot;
    const lang = this._langFor(snap, id, "name");
    const clips = tapClips(snap, id, lang);
    this._mash = startPlaying(this._mash, id, nowMs);
    const token = this._mash.token;
    // Called synchronously inside the tap so iOS treats it as user-initiated.
    const done = () => {
      this._mash = stopPlaying(this._mash, token);
      // Find game, wrong thing: after it says its own name, the question comes again (US-6.2);
      // after 2 misses the right thing(s) also hop (and glow, set above).
      if (outcome === "wrong" && round === this._roundToken && this._find.phase === "asking" && this._mash.playingId === null) {
        if (hinting(this._find)) this._hop();
        this._ask(true);
      }
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

  /** Find the animal: the thing asked for right now, or null (also null in a colour round). */
  get asking() {
    return this._find.phase === "asking" ? this._find.target : null;
  }

  /** The find round in progress: {kind:'animal'|'color', thingId, color}, or null. */
  get findRound() {
    const f = this._find;
    return f.phase === "asking" ? { kind: f.kind, thingId: f.target, color: f.color } : null;
  }

  /** True when the find buttons should show: play, awake, a scene with things, games not switched off. */
  get findAvailable() {
    const place = this.store.currentPlace;
    return this._mode === "play" && !this.world.asleep && !!place && place.findIt !== false && this.world.actors.length > 0;
  }

  /**
   * The child pressed a find button: start a round of that game ('animal' or 'color').
   * Pressing it again during its own round repeats the question. Call it inside the press:
   * the question starts synchronously (iOS speech needs the gesture). Returns true if asking.
   */
  startFind(kind) {
    if (!this.findAvailable || (kind !== "animal" && kind !== "color")) return false;
    this._catchUp();
    this._call("stop");
    this._mash = idleMash();
    if (this._find.phase === "asking" && this._find.kind === kind) {
      this._ask(true);
      return true;
    }
    this._endFind();
    const ev = startRound(this._find, kind, this._findThings(), this.rng);
    if (ev) this._ask(false);
    this._emitFind();
    return !!ev;
  }

  /** Ends any find round quietly (no sound). */
  stopFind() {
    if (this._find.phase !== "asking") return;
    this._endFind();
    this._emitFind();
    this._wake();
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
    return isIdle(this.world) && this._glowIds.size === 0;
  }

  /** Milliseconds until something happens by itself (wander, blink, sleep, a find nudge or timeout); Infinity if never. */
  nextWakeMs() {
    const sleepS = sleepRemainingS(this._sleep);
    const findS = this._mode === "play" ? findRemainingS(this._find) : Infinity;
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
    if (this._mode === "play" && tickSleep(this._sleep, s)) {
      sleepAll(this.world);
      this._endFind();
      this._emitFind(); // the buttons hide while the things sleep
    }
    if (this._mode === "play" && this._find.phase === "asking") {
      const calm = !this._prompting && this._mash.playingId === null;
      const ev = stepFind(this._find, s, { calm });
      if (ev?.type === "nudge") { this._hop(); this._ask(true); }
      else if (ev?.type === "timeout") { this._endFind(); this._emitFind(); }
    }
    const glow = this._glowIds;
    for (const a of this.world.actors) a.glow = glow.has(a.thingId) ? 1 : 0;
  }

  // ---- find games ----

  /** Things of this place for a find round: id, felt colour, and whether it can be asked for by name. */
  _findThings() {
    const snap = this.store.snapshot;
    const canSpeak = !!this.audio?.canSpeak;
    return this._things().map((t) => ({
      id: t.id,
      color: t.color,
      askable:
        clipsFor(snap, t.id, { kind: "prompt" }).length > 0 ||
        clipsFor(snap, t.id, { kind: "name" }).length > 0 ||
        (canSpeak && Object.values(t.names ?? {}).some(Boolean)),
    }));
  }

  _colorOf(thingId) {
    return this.store.snapshot.things.find((t) => t.id === thingId)?.color ?? null;
  }

  /** Things that answer the current round. */
  _answerIds() {
    return this._things().filter((t) => isAnswer(this._find, t.id, t.color)).map((t) => t.id);
  }

  /** The cue: the right thing(s) do a little hop. */
  _hop() {
    for (const id of this._answerIds()) react(this.world, id);
    this._wake();
  }

  /** Ends the round quietly; callbacks of the old round become no-ops. */
  _endFind() {
    endRound(this._find);
    this._roundToken++;
    if (this._glowIds.size) this._glowIds = new Set();
    for (const a of this.world.actors) a.glow = 0;
  }

  _emitFind() {
    this.dispatchEvent(new CustomEvent("find", { detail: { round: this.findRound, available: this.findAvailable } }));
  }

  /** The language for this play: fixed, or random among the languages recorded for the thing. */
  _langFor(snap, thingId, kind) {
    const available = [...new Set(clipsFor(snap, thingId, { kind }).map((c) => c.language))];
    return playLanguageFor(snap.settings, { available, rng: this.rng });
  }

  /** The plan for the current round's question (play/ask.js), or null when there is nothing to ask. */
  _askPlan() {
    const f = this._find;
    const snap = this.store.snapshot;
    const canSpeak = !!this.audio?.canSpeak;
    if (f.kind === "color") {
      const questions = gameClips(snap, { kind: "color-question" });
      const words = gameClips(snap, { kind: "color-word", color: f.color });
      const lang = colorAskLanguage(snap.settings, recordedColorLangs(questions, words), this.rng);
      const line = colorLine(this.scripts, f.color, lang, Math.floor(this.rng() * 3));
      return planColorAsk({ questions, words, lang, line, canSpeak, rng: this.rng, lastId: this._lastAskClipId });
    }
    const thing = snap.things.find((t) => t.id === f.target);
    if (!thing) return null;
    const lang = this._langFor(snap, thing.id, "prompt");
    const { lines, fallback } = cueLines(this.scripts, thing, lang);
    const sounds = clipsFor(snap, thing.id, { kind: "sound" });
    return planAnimalAsk({
      prompts: clipsFor(snap, thing.id, { kind: "prompt" }),
      lang,
      lines,
      linesLang: fallback ? "en" : lang,
      name: tapClips(snap, thing.id, lang).find((c) => c.kind === "name") ?? null,
      sound: sounds.find((c) => c.language === lang) ?? sounds[0] ?? null,
      canSpeak,
      rng: this.rng,
      lastId: this._lastAskClipId,
    });
  }

  /** Starts one plan step synchronously (iOS: inside the press). Resolves true when it was heard. */
  _playStep(step) {
    if (step.kind === "clip") return this._call("playClip", step.clip);
    if (step.kind === "clips") return this._call("playSequence", step.clips);
    if (step.kind === "speak") return this._call("speak", step.text, step.lang);
    this._call("chime", "tap");
    return true;
  }

  /**
   * Asks the current round's question (play/ask.js). Animal: the parent's recorded question (a
   * random take), else a cue line in the device's voice, else the recorded name; only after the
   * question has finished, the thing's own sound as a clue. Colour: the recorded colour question
   * and colour word as one sequence, else the whole line in the device's voice.
   * The first step starts synchronously, inside the press; a step that is not heard (the device
   * voice never started, a clip would not decode) falls through to the next one.
   */
  _ask(repeat = false) {
    const f = this._find;
    if (f.phase !== "asking") return;
    const plan = this._askPlan();
    if (!plan) return;
    const askToken = ++this._askToken;
    const round = this._roundToken;
    const current = () => askToken === this._askToken && round === this._roundToken;
    this._prompting = true;
    this.dispatchEvent(new CustomEvent("ask", { detail: { kind: f.kind, thingId: f.target, color: f.color, repeat } }));
    const run = (i) => {
      const step = plan.ask[i];
      if (step.kind === "clip" || step.kind === "clips") this._lastAskClipId = (step.clip ?? step.clips[0]).id;
      return Promise.resolve(this._playStep(step)).then((heard) => {
        if (!current()) return false;
        if (heard === false && i + 1 < plan.ask.length) return run(i + 1);
        return true;
      });
    };
    const done = () => {
      if (askToken !== this._askToken) return;
      this._prompting = false;
      this._wake();
    };
    // The clue sound follows the question once it has finished, unless something interrupted it.
    run(0)
      .then((asked) => (plan.clue && asked && current() ? this._playStep(plan.clue) : undefined))
      .then(done, done);
    this._wake();
  }

  /** Find game, right thing: a happy jump, confetti, a bright chime, then its name and its sound. */
  _celebrate(id) {
    this._call("stop");
    this._prompting = false;
    this._askToken++;
    const a = react(this.world, id);
    this.dispatchEvent(new CustomEvent("reaction", { detail: { thingId: id, x: a.x, y: a.y, celebrate: true } }));
    this._call("chime", "yay");
    const snap = this.store.snapshot;
    const lang = this._langFor(snap, id, "name");
    const clips = tapClips(snap, id, lang);
    const nowMs = this.now();
    this._mash = startPlaying(this._mash, id, nowMs);
    const token = this._mash.token;
    const done = () => { this._mash = stopPlaying(this._mash, token); this._wake(); };
    let playing;
    if (clips.some((c) => c.kind === "name")) {
      playing = this._call("playThing", clips);
    } else {
      // No recorded name: the device says it, then the recorded sound (if any) follows.
      const name = this._nameFor(id, lang);
      const sound = clips.find((c) => c.kind === "sound");
      playing = Promise.resolve(name ? this._call("speak", name.text, name.lang) : null).then((ok) =>
        sound && ok !== false && this._mash.token === token ? this._call("playClip", sound) : undefined,
      );
    }
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
    const moved = placeId !== this._placeId;
    this._placeId = placeId;
    syncWorld(this.world, this._things(), this.rng, { drop: switched });
    for (const id of this._pendingDrops) if (dropActor(this.world, id)) this._pendingDrops.delete(id);
    // A find round ends with its scene, when its answer leaves it, or when the games are switched off.
    if (this._find.phase === "asking" && (moved || reconcileFind(this._find, this._things()) || !this.findAvailable)) this._endFind();
    this._wake();
    this._emitFind();
  }
}
