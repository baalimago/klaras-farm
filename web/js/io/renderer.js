// Renderer: owns requestAnimationFrame and draws the board (ARCHITECTURE §7).
// Slow felt work happens once (io/felt.js caches). Per frame: one background blit, then per actor a
// contact shadow, a few yarn-leg strokes, one sprite drawImage and the button eyes; plus felt confetti
// from a fixed pool. No shadowBlur, dashes, filters or clipping per frame; no allocation in the loop.
// The loop stops when engine.isIdle() and wakes after engine.nextWakeMs(), or on wake().
import { INK, hex } from "../farm/palette.js";
import { bbox, centroid } from "../geometry/stroke.js";
import {
  paintBackground, paintThingSprite, eyeSprite, groundShadowSprite, confettiSprites, makeCanvas, releaseCanvas,
} from "./felt.js";

const LEG_SHADOW = "rgba(40,25,10,.25)";
const CONFETTI_POOL = 24;
const CONFETTI_LIFE = 0.9; // seconds (≤ 1 s, US-5.1)
const SCENE_ALPHA = 0.35;

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{store: any, engine: any}} deps  store: FarmStore; engine: PlayEngine (actors, mode, step, isIdle, nextWakeMs)
   */
  constructor(canvas, { store, engine }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.store = store;
    this.engine = engine;
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this.W = 0; // device px
    this.H = 0;
    this.U = 1;
    this.frames = 0; // frames drawn (tests, diagnostics)
    this.bg = null;
    this._bgDirty = true;
    this._bgScene = false;
    this._place = store?.currentPlace ?? null;
    /** @type {Map<string, any>} thingId → cached sprite and per-frame geometry */
    this.entries = new Map();
    this._raf = 0;
    this._timer = 0;
    this._last = 0;
    this._destroyed = false;
    this._frame = this._frame.bind(this);
    this._onTimer = this._onTimer.bind(this);
    this._confettiAlive = 0;
    this._confettiSprites = [];
    this.confetti = [];
    for (let i = 0; i < CONFETTI_POOL; i++) this.confetti.push({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, life: 0, sprite: 0 });

    this._onStore = (e) => this._storeChanged(e.detail);
    this._onReaction = (e) => this.burst(e.detail?.x, e.detail?.y);
    this._onWakeEvent = () => this.wake();
    store?.addEventListener?.("change", this._onStore);
    engine?.addEventListener?.("reaction", this._onReaction);
    for (const type of ["wake", "mode", "change"]) engine?.addEventListener?.(type, this._onWakeEvent);
  }

  /** Sizes the canvas for a 4:3 board of cssW × cssH CSS px at the device pixel ratio. */
  setSize(cssW, cssH, dpr = 1) {
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (W === this.W && H === this.H && this.bg) return;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.W = W;
    this.H = H;
    this.U = H / 600;
    this.canvas.width = W;
    this.canvas.height = H;
    releaseCanvas(this.bg);
    this.bg = makeCanvas(W, H);
    this._bgDirty = true;
    this._clearSprites();
    for (const s of this._confettiSprites) releaseCanvas(s);
    this._confettiSprites = confettiSprites(Math.max(3, Math.round(5.5 * this.U)));
    this.wake();
  }

  /** 'background' | 'sprites' | a thingId. Schedules a redraw. */
  invalidate(what) {
    if (what === "background") this._bgDirty = true;
    else if (what === "sprites") this._clearSprites();
    else if (what) this._dropEntry(what);
    this.wake();
  }

  /** Requests a frame (if none is pending). The loop keeps going until the engine is idle. */
  wake() {
    if (this._destroyed || this._raf || !this.W) return;
    if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
    this._raf = requestAnimationFrame(this._frame);
  }

  /** Stops the loop and any scheduled wake. A later wake() starts it again. */
  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._timer) clearTimeout(this._timer);
    this._raf = 0;
    this._timer = 0;
    this._last = 0;
  }

  /** Stops for good and releases canvases and listeners. */
  destroy() {
    this.stop();
    this._destroyed = true;
    this.store?.removeEventListener?.("change", this._onStore);
    this.engine?.removeEventListener?.("reaction", this._onReaction);
    for (const type of ["wake", "mode", "change"]) this.engine?.removeEventListener?.(type, this._onWakeEvent);
    this._clearSprites();
    releaseCanvas(this.bg);
    this.bg = null;
  }

  get running() { return this._raf !== 0; }

  /** Felt confetti puff at board coords (x, y). Fixed pool; at most ~1 s. */
  burst(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !this.W) return;
    const reduce = this.store?.settings?.reduceMotion;
    const n = reduce ? 4 : 14;
    const px = x * this.W, py = y * this.H, H = this.H;
    let made = 0;
    for (let i = 0; i < this.confetti.length && made < n; i++) {
      const p = this.confetti[i];
      if (p.life > 0) continue;
      const a = Math.random() * Math.PI * 2, v = H * (0.25 + Math.random() * 0.55);
      p.x = px; p.y = py;
      p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - H * 0.45;
      p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 12;
      p.life = CONFETTI_LIFE * (0.7 + Math.random() * 0.3);
      p.sprite = (i + made) % this._confettiSprites.length;
      made++;
    }
    this._confettiAlive += made;
    this.wake();
  }

  /** Board-unit bounding box {x, y, w, h} of a thing where it is drawn now, or null. */
  actorBounds(thingId) {
    let a = null;
    if (typeof this.engine?.actorFor === "function") a = this.engine.actorFor(thingId) ?? null;
    else {
      const actors = this.engine?.actors ?? [];
      for (let i = 0; i < actors.length; i++) if (actors[i].thingId === thingId) { a = actors[i]; break; }
    }
    const thing = this._thing(thingId);
    if (!thing) return null;
    const b = bbox(thing.outline);
    const [cx, cy] = centroid(thing.outline);
    if (!a) return b;
    const dx = a.x + (a.pose?.dx ?? 0) - cx, dy = a.y + (a.pose?.dy ?? 0) - cy;
    return { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
  }

  // ---------- loop ----------
  _onTimer() {
    this._timer = 0;
    this.wake();
  }

  _frame(now) {
    this._raf = 0;
    if (this._destroyed || !this.W) return;
    let dt = this._last ? (now - this._last) / 1000 : 1 / 60;
    if (dt > 0.1) dt = 0.1;
    else if (dt < 0) dt = 0;
    this._last = now;
    const e = this.engine;
    e?.step?.(dt);
    this._draw(dt);
    this.frames++;
    if (this._destroyed) return;
    if ((!e || e.isIdle?.() !== false) && this._confettiAlive === 0) {
      this._last = 0;
      const ms = e?.nextWakeMs?.();
      if (Number.isFinite(ms) && ms >= 0) this._timer = setTimeout(this._onTimer, Math.max(16, ms));
      return;
    }
    this._raf = requestAnimationFrame(this._frame);
  }

  _draw(dt) {
    const c = this.ctx;
    const scene = this.engine?.mode === "scene";
    if (this._bgDirty || scene !== this._bgScene) this._paintBackground(scene);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.drawImage(this.bg, 0, 0);
    const actors = this.engine?.actors;
    if (actors) {
      c.globalAlpha = scene ? SCENE_ALPHA : 1;
      for (let i = 0; i < actors.length; i++) this._drawActor(c, actors[i]);
    }
    if (this._confettiAlive > 0) this._drawConfetti(c, dt);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
  }

  _drawActor(c, a) {
    let en = this.entries.get(a.thingId);
    if (en === undefined) en = this._build(a.thingId);
    if (en === null) return;
    const p = a.pose;
    const W = this.W, H = this.H;
    const x = (a.x + (p ? p.dx : 0)) * W;
    const y = (a.y + (p ? p.dy : 0)) * H;
    const facing = a.facing === -1 ? -1 : 1;
    const legs = p && p.legs ? p.legs : null;
    const nLegs = legs ? legs.length : 0;

    // contact shadow stays on the ground while the thing jumps
    if (en.walker) {
      const sw = en.halfW * 2.1, sh = Math.max(4, en.halfW * 0.35);
      c.setTransform(1, 0, 0, 1, x, a.y * H + en.footY);
      c.drawImage(this._shadow, -sw / 2, -sh / 2, sw, sh);
    }

    c.setTransform(1, 0, 0, 1, x, y);
    if (p && p.rot) c.rotate(p.rot);
    c.scale((p ? p.sx : 1) * facing, p ? p.sy : 1);

    if (nLegs > 0) this._drawLegs(c, en, legs, nLegs);
    const s = en.sprite;
    c.drawImage(s.canvas, -s.ax, -s.ay);

    // button eyes, squashed by eyeOpen for the blink
    const open = p ? p.eyeOpen : 1;
    const eyes = en.eyes, r = en.eyeR;
    if (open > 0.15) {
      const ry = r * open;
      for (let i = 0; i < eyes.length; i += 2) c.drawImage(this._eye, eyes[i] - r, eyes[i + 1] - ry, r * 2, ry * 2);
    } else if (eyes.length) {
      c.strokeStyle = INK;
      c.lineWidth = Math.max(1, r * 0.4);
      c.lineCap = "round";
      c.beginPath();
      for (let i = 0; i < eyes.length; i += 2) {
        c.moveTo(eyes[i] - r * 0.8, eyes[i + 1]);
        c.lineTo(eyes[i] + r * 0.8, eyes[i + 1]);
      }
      c.stroke();
    }
  }

  _drawLegs(c, en, legs, n) {
    if (en.hipsN !== n) this._computeHips(en, n);
    const hips = en.hips, L = en.legLen, U = this.U, foot = 4 * U * en.footDir;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const hx = hips[k * 2], hy = hips[k * 2 + 1], a = legs[k];
      const fx = hx + Math.sin(a) * L, fy = hy + Math.cos(a) * L;
      c.moveTo(hx, hy + 2 * U);
      c.lineTo(fx, fy + 2 * U);
    }
    c.strokeStyle = LEG_SHADOW;
    c.lineWidth = 5 * U;
    c.stroke();
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const hx = hips[k * 2], hy = hips[k * 2 + 1], a = legs[k];
      const fx = hx + Math.sin(a) * L, fy = hy + Math.cos(a) * L;
      c.moveTo(hx, hy);
      c.lineTo(fx, fy);
      c.lineTo(fx + foot, fy);
    }
    c.strokeStyle = INK;
    c.lineWidth = 4 * U;
    c.stroke();
  }

  _drawConfetti(c, dt) {
    const g = this.H * 1.4;
    const sprites = this._confettiSprites;
    let alive = 0;
    for (let i = 0; i < this.confetti.length; i++) {
      const p = this.confetti[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      alive++;
      p.vy += g * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const s = sprites[p.sprite];
      c.setTransform(1, 0, 0, 1, p.x, p.y);
      c.rotate(p.rot);
      c.globalAlpha = p.life * 3 > 1 ? 1 : p.life * 3;
      c.drawImage(s, -s.width / 2, -s.height / 2);
    }
    this._confettiAlive = alive;
  }

  // ---------- caches ----------
  _paintBackground(scene) {
    const g = this.bg.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (this._place) paintBackground(g, this._place, { w: this.W, h: this.H }, { scene });
    else {
      g.fillStyle = hex("wall");
      g.fillRect(0, 0, this.W, this.H);
    }
    this._bgDirty = false;
    this._bgScene = scene;
  }

  _thing(thingId) {
    const things = this.store?.snapshot?.things ?? [];
    for (let i = 0; i < things.length; i++) if (things[i].id === thingId) return things[i];
    return null;
  }

  /** Builds (once) a thing's sprite and the geometry its eyes and legs need, in device px from the anchor. */
  _build(thingId) {
    const thing = this._thing(thingId);
    if (!thing || !this.W) return null;
    this._eye ??= eyeSprite();
    this._shadow ??= groundShadowSprite();
    const W = this.W, H = this.H, U = this.U;
    const sprite = paintThingSprite(thing, this.cssW, this.dpr);
    const [cx, cy] = centroid(thing.outline);
    const rel = thing.outline.map(([x, y]) => [(x - cx) * W, (y - cy) * H]);
    const b = bbox(rel);
    const eyes = new Float64Array(thing.eyes.length * 2);
    thing.eyes.forEach((e, i) => { eyes[i * 2] = (e.x - cx) * W; eyes[i * 2 + 1] = (e.y - cy) * H; });
    const eyeR = Math.max(4 * U, Math.min(10 * U, 0.085 * Math.min(b.w, b.h)));
    const legLen = Math.max(8 * U, Math.min(34 * U, 0.35 * b.h));
    const walker = thing.motion?.preset === "walk";
    const meanEyeX = thing.eyes.length ? thing.eyes.reduce((s, e) => s + e.x, 0) / thing.eyes.length : cx;
    const en = {
      thing, sprite, rel, eyes, eyeR, legLen, walker,
      halfW: b.w / 2, footY: b.y + b.h + (walker ? legLen : 0),
      footDir: meanEyeX >= cx ? 1 : -1, // toes point the way the face looks
      hips: null, hipsN: -1,
    };
    this.entries.set(thingId, en);
    return en;
  }

  /** Hip points along the bottom of the outline, spread across the middle of its width. */
  _computeHips(en, n) {
    const rel = en.rel, b = bbox(rel);
    en.hips = new Float64Array(n * 2);
    en.hipsN = n;
    for (let k = 0; k < n; k++) {
      const fx = b.x + b.w * (n === 1 ? 0.5 : 0.22 + (0.56 * k) / (n - 1));
      let maxY = -Infinity;
      for (let i = 0, m = rel.length; i < m; i++) {
        const p = rel[i], q = rel[(i + 1) % m];
        if ((p[0] <= fx && q[0] >= fx) || (q[0] <= fx && p[0] >= fx)) {
          const t = q[0] === p[0] ? 0 : (fx - p[0]) / (q[0] - p[0]);
          const yy = p[1] + (q[1] - p[1]) * t;
          if (yy > maxY) maxY = yy;
        }
      }
      if (!Number.isFinite(maxY)) maxY = b.y + b.h;
      en.hips[k * 2] = fx;
      en.hips[k * 2 + 1] = maxY - 3 * this.U;
    }
  }

  _dropEntry(id) {
    const en = this.entries.get(id);
    if (en) releaseCanvas(en.sprite.canvas);
    this.entries.delete(id);
  }

  _clearSprites() {
    for (const en of this.entries.values()) releaseCanvas(en.sprite.canvas);
    this.entries.clear();
  }

  _storeChanged() {
    const place = this.store?.currentPlace ?? null;
    if (place !== this._place) {
      this._place = place;
      this._bgDirty = true;
    }
    // Snapshots are immutable: a changed thing is a new object.
    for (const [id, en] of this.entries) if (this._thing(id) !== en.thing) this._dropEntry(id);
    this.wake();
  }
}
