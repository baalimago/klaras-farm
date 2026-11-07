// wrapper.js: literal wrapping paper for a web page. It covers the page with a sheet of gift paper;
// a finger (or mouse) pokes in and drags, and the paper tears along the pull, in whatever direction
// it goes. Torn strips tumble away, and once enough is gone the rest falls off with confetti and a
// chime, and the page underneath is free.
//
//   import { wrapOn } from "./gift/wrapper.js";
//   wrapOn("11-07", { theme: "autumn" });          // every 7 November (device local time)
//   wrapOn("2027-12-24", { onOpen: () => ... });  // one day only
//   const present = wrap({ theme: "starry" });    // right now; await present.opened
//
// This folder (web/js/gift/) is a self-contained package with no imports from the app around it,
// so it can be copied onto another page as is. It owns its own DOM, canvas and audio.
//
// Promises: the paper never traps the page. Any failure while mounting or in an input handler
// removes the paper (it fails open). Enter, Space or Escape opens it from a keyboard. It draws only
// while something moves (0 fps when idle); a tear is cut synchronously in the pointer handler, so
// it stays under the finger. Only the primary pointer tears; palms and second fingers are ignored.

import { isGiftDay, parseWhen } from "./calendar.js";
import { confettiColours, paintPaper, resolveTheme, seeded } from "./paper.js";
import { RipSound } from "./sound.js";
import { DEFAULT_RULES, accepts, initialWrap, nextWrap } from "./state.js";
import { clearedFraction, cover, createCoverage, scalePoints, startTear, stripOf, tearSize, tearTo } from "./tear.js";

export { isGiftDay, parseWhen } from "./calendar.js";
export { THEMES } from "./paper.js";

/**
 * @typedef {{
 *   parent?: HTMLElement, theme?: string | object, openAt?: number, openAfterTears?: number,
 *   sound?: boolean, audioContext?: AudioContext, confetti?: boolean, zIndex?: number, label?: string,
 *   seed?: number, rng?: () => number, onOpen?: () => void, today?: Date
 * }} WrapOptions
 *   openAt: share of paper torn away (0 to 1) that opens it on the next lift, default 0.25
 *   openAfterTears: or open after this many tears, however small, default 8
 *   today: the date wrapOn checks (default now, local time)
 */

const GRAVITY = 2300; // px/s², torn pieces
const OPEN_FADE_MS = 650;
const PIECE_LIFE_S = 2.2;
const CONFETTI_COUNT = 90;
const FAILSAFE_MS = 4000; // the paper is gone this long after it starts opening, whatever else happens

/**
 * Wrap the page if today is the gift day.
 * @param {string | {month:number, day:number, year?:number}} when "MM-DD" every year, or "YYYY-MM-DD"
 * @param {WrapOptions} [options]
 * @returns {Wrapping | null}
 */
export function wrapOn(when, options = {}) {
  if (!isGiftDay(options.today ?? new Date(), parseWhen(when))) return null;
  return wrap(options);
}

/**
 * Wrap the page now.
 * @param {WrapOptions} [options]
 * @returns {Wrapping}
 */
export function wrap(options = {}) {
  return new Wrapping(options);
}

export class Wrapping {
  /** @param {WrapOptions} options */
  constructor(options = {}) {
    this.options = options;
    this.rules = { openAt: options.openAt ?? DEFAULT_RULES.openAt, openAfterTears: options.openAfterTears ?? DEFAULT_RULES.openAfterTears };
    this.theme = resolveTheme(options.theme ?? "classic");
    this.rng = options.rng ?? Math.random;
    this.seed = options.seed ?? Math.floor(this.rng() * 2 ** 31);
    this.state = initialWrap();
    this.coverage = createCoverage();
    this.cuts = []; // every piece cut so far, in px of the current size (replayed after a resize)
    this.pieces = []; // torn bits in flight
    this.confetti = [];
    this.tear = null;
    this.samples = [];
    this.frame = 0;
    this.w = 0;
    this.h = 0;
    this.sound = options.sound === false ? null : new RipSound({ context: options.audioContext });
    /** Resolves when the paper is gone (opened or destroyed). */
    this.opened = new Promise((resolve) => { this.resolveOpened = resolve; });
    try {
      this.mount(options.parent ?? document.body);
      this.resize();
    } catch (e) {
      console.warn("wrapper: could not wrap", e);
      this.destroy();
    }
  }

  get phase() {
    return this.state.phase;
  }

  /** Open it now (the same as tearing enough away). */
  open() {
    this.dispatch({ type: "open" });
  }

  /** Remove the paper at once, without the falling-away. */
  destroy() {
    this.dispatch({ type: "destroy" });
  }

  // ---------------------------------------------------------------- DOM

  mount(parent) {
    const root = document.createElement("div");
    root.className = "gift-wrap";
    root.setAttribute("role", "button");
    root.setAttribute("aria-label", this.options.label ?? "A present. Drag to tear the paper open.");
    root.tabIndex = 0;
    root.style.cssText = [
      "position:fixed", "inset:0", `z-index:${this.options.zIndex ?? 2147483000}`, "touch-action:none",
      "user-select:none", "-webkit-user-select:none", "-webkit-touch-callout:none", "-webkit-tap-highlight-color:transparent",
      "overflow:hidden", "outline:none", "cursor:grab", "contain:strict",
    ].join(";");
    const layer = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none";
    this.paper = document.createElement("canvas");
    this.paper.style.cssText = layer;
    this.fx = document.createElement("canvas");
    this.fx.style.cssText = layer;
    root.append(this.paper, this.fx);
    this.source = document.createElement("canvas"); // the untouched sheet: falling pieces show its print
    this.pctx = this.paper.getContext("2d");
    this.fctx = this.fx.getContext("2d");
    this.sctx = this.source.getContext("2d");
    if (!this.pctx || !this.fctx || !this.sctx) throw new Error("no 2d canvas");

    this.handlers = {
      pointerdown: (e) => this.guard(() => this.onDown(e)),
      pointermove: (e) => this.guard(() => this.onMove(e)),
      pointerup: (e) => this.guard(() => this.onUp(e, "up")),
      pointercancel: (e) => this.guard(() => this.onUp(e, "cancel")),
      lostpointercapture: (e) => this.guard(() => this.onUp(e, "cancel")),
      keydown: (e) => this.guard(() => this.onKey(e)),
      contextmenu: (e) => e.preventDefault(),
    };
    for (const [type, fn] of Object.entries(this.handlers)) root.addEventListener(type, fn);
    this.onResize = () => this.guard(() => this.resize());
    window.addEventListener("resize", this.onResize);
    parent.append(root);
    this.root = root;
  }

  /** Run a handler; if it throws, take the paper away rather than leave the page stuck under it. */
  guard(fn) {
    try {
      fn();
    } catch (e) {
      console.warn("wrapper: failed, unwrapping", e);
      this.destroy();
    }
  }

  resize() {
    if (!this.root || this.state.phase === "open") return;
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h) return;
    if (this.w && this.h) {
      const sx = w / this.w, sy = h / this.h;
      this.cuts = this.cuts.map((p) => ({ cut: scalePoints(p.cut, sx, sy), rim: scalePoints(p.rim, sx, sy) }));
      this.endTear(); // a rotation mid-pull ends that tear
    }
    this.w = w;
    this.h = h;
    this.half = tearSize(w, h);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.paper, this.fx, this.source]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    for (const ctx of [this.pctx, this.fctx, this.sctx]) ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    paintPaper(this.sctx, w, h, this.theme, seeded(this.seed));
    this.pctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pctx.drawImage(this.source, 0, 0);
    this.pctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const p of this.cuts) this.cutOut(p);
  }

  // ---------------------------------------------------------------- input

  point(e) {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    const next = nextWrap(this.state, { type: "down", pointerId: e.pointerId, primary: e.isPrimary }, this.rules);
    if (next === this.state) return;
    this.state = next;
    e.preventDefault();
    // Sound first and synchronously: the gesture is what lets the iPad play it.
    try { this.sound?.unlock(); this.sound?.pop(); this.sound?.start(); } catch {}
    try { this.root.setPointerCapture(e.pointerId); } catch {}
    this.root.style.cursor = "grabbing";
    const { x, y } = this.point(e);
    const { tear, pieces } = startTear(x, y, this.half, this.rng);
    this.tear = tear;
    this.samples = [{ x, y, t: e.timeStamp }];
    this.apply(pieces);
    this.fling(pieces[0].cut, { x: 0, y: 0 });
    this.kick();
  }

  onMove(e) {
    if (!accepts(this.state, e.pointerId) || !this.tear) return;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const { x, y } = this.point(ev);
      const { tear, pieces } = tearTo(this.tear, x, y, this.rng);
      this.tear = tear;
      if (pieces.length) this.apply(pieces);
      this.samples.push({ x, y, t: ev.timeStamp });
    }
    if (this.samples.length > 6) this.samples.splice(0, this.samples.length - 6);
    this.sound?.speed(this.velocity().speed / 1000);
    this.kick();
  }

  onUp(e, type) {
    if (!accepts(this.state, e.pointerId)) return;
    this.endTear();
    this.state = nextWrap(this.state, { type, pointerId: e.pointerId }, this.rules);
    this.root.style.cursor = "grab";
    if (this.state.phase === "opening") this.startOpening();
  }

  onKey(e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Escape") return;
    e.preventDefault();
    try { this.sound?.unlock(); } catch {}
    this.open();
  }

  /** The torn strip comes away and falls. */
  endTear() {
    const tear = this.tear;
    this.tear = null;
    this.sound?.stop();
    if (!tear) return;
    const strip = stripOf(tear);
    if (strip) this.fling(strip, this.velocity());
    this.kick();
  }

  /** Finger velocity over the last few samples, px/s. */
  velocity() {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0, speed: 0 };
    const a = s[0], b = s.at(-1);
    const dt = Math.max(1, b.t - a.t) / 1000;
    const x = (b.x - a.x) / dt, y = (b.y - a.y) / dt;
    return { x, y, speed: Math.hypot(x, y) };
  }

  // ---------------------------------------------------------------- state

  dispatch(event) {
    const before = this.state.phase;
    this.state = nextWrap(this.state, event, this.rules);
    if (before !== "opening" && this.state.phase === "opening") this.startOpening();
    if (before !== "open" && this.state.phase === "open") this.teardown();
  }

  /** Cut pieces out of the paper and count what is gone. */
  apply(pieces) {
    for (const p of pieces) {
      this.cutOut(p);
      this.cuts.push(p);
      cover(this.coverage, p.cut, this.w, this.h);
    }
    this.state = nextWrap(this.state, { type: "cleared", fraction: clearedFraction(this.coverage) }, this.rules);
  }

  cutOut({ cut, rim }) {
    const ctx = this.pctx;
    ctx.globalCompositeOperation = "source-atop"; // the white back shows only on paper that is left
    ctx.fillStyle = this.theme.back;
    fillPoly(ctx, rim);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    fillPoly(ctx, cut);
    ctx.globalCompositeOperation = "source-over";
  }

  startOpening() {
    this.endTear();
    this.root.style.pointerEvents = "none"; // the page is usable while the paper falls away
    this.root.removeAttribute("role");
    try { this.sound?.chime(); } catch {}
    if (this.options.confetti !== false) this.burst();
    const done = () => this.dispatch({ type: "opened" });
    this.failsafe = setTimeout(done, FAILSAFE_MS);
    if (typeof this.paper.animate === "function") {
      const anim = this.paper.animate(
        [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.08)" }],
        { duration: OPEN_FADE_MS, easing: "ease-in", fill: "forwards" },
      );
      anim.onfinish = () => { this.faded = true; this.maybeOpened(); };
    } else {
      this.paper.style.opacity = "0";
      this.faded = true;
    }
    this.kick();
  }

  maybeOpened() {
    if (this.state.phase === "opening" && this.faded && !this.pieces.length && !this.confetti.length) this.dispatch({ type: "opened" });
  }

  teardown() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.failsafe);
    this.sound?.close();
    if (this.root) {
      for (const [type, fn] of Object.entries(this.handlers)) this.root.removeEventListener(type, fn);
      window.removeEventListener("resize", this.onResize);
      this.root.remove();
    }
    // Let the canvases' memory go now (iPad Safari keeps it while a reference lives).
    for (const c of [this.paper, this.fx, this.source]) if (c) { c.width = 0; c.height = 0; }
    this.cuts = [];
    this.resolveOpened();
    if (this.options.onOpen) {
      try { this.options.onOpen(); } catch (e) { console.warn("wrapper: onOpen failed", e); }
    }
  }

  // ---------------------------------------------------------------- animation

  /** A piece of paper (an outline in px) falls away. */
  fling(poly, v) {
    if (!poly || poly.length < 3) return;
    let cx = 0, cy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      cx += p.x; cy += p.y;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    cx /= poly.length;
    cy /= poly.length;
    const r = this.rng;
    this.pieces.push({
      rel: poly.map((p) => ({ x: p.x - cx, y: p.y - cy })),
      box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      home: { x: cx, y: cy },
      x: cx, y: cy,
      vx: v.x * 0.5 + (r() - 0.5) * 260,
      vy: v.y * 0.5 - 260 - r() * 200,
      angle: 0, spin: (r() - 0.5) * 5,
      flip: 0, flipRate: 3 + r() * 5,
      life: 0, size: Math.max(maxX - minX, maxY - minY),
    });
  }

  burst() {
    const colours = confettiColours(this.theme);
    const r = this.rng;
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
      const speed = 700 + r() * 900;
      this.confetti.push({
        x: this.w / 2 + (r() - 0.5) * 60, y: this.h * 0.55,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        angle: r() * Math.PI, spin: (r() - 0.5) * 14, flip: r() * Math.PI, flipRate: 6 + r() * 8,
        w: 8 + r() * 8, h: 5 + r() * 4, colour: colours[i % colours.length], life: 0,
      });
    }
  }

  /** Make sure a frame is coming; the loop stops itself when nothing moves. */
  kick() {
    if (this.frame || this.state.phase === "open") return;
    this.last = performance.now();
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  tick(t) {
    this.frame = 0;
    if (this.state.phase === "open") return;
    try {
      const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      this.step(dt);
      this.draw();
    } catch (e) {
      console.warn("wrapper: frame failed, unwrapping", e);
      this.destroy();
      return;
    }
    // A held finger draws only when it moves (each move asks for a frame), so a still hand is 0 fps.
    if (this.pieces.length || this.confetti.length) {
      this.frame = requestAnimationFrame((n) => this.tick(n));
    } else {
      this.maybeOpened();
    }
  }

  step(dt) {
    for (const p of this.pieces) {
      p.vy += GRAVITY * dt;
      p.vx *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.flip += p.flipRate * dt;
      p.life += dt;
    }
    this.pieces = this.pieces.filter((p) => p.life < PIECE_LIFE_S && p.y - p.size < this.h + 40);
    for (const c of this.confetti) {
      c.vy += GRAVITY * 0.55 * dt;
      c.vx *= 1 - 1.6 * dt;
      c.vy *= 1 - 1.2 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.angle += c.spin * dt;
      c.flip += c.flipRate * dt;
      c.life += dt;
    }
    this.confetti = this.confetti.filter((c) => c.life < 2.4 && c.y < this.h + 30);
  }

  draw() {
    const ctx = this.fctx;
    ctx.clearRect(0, 0, this.w, this.h);
    for (const p of this.pieces) this.drawPiece(ctx, p);
    if (this.tear) this.drawCurl(ctx, this.tear);
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.scale(1, Math.cos(c.flip));
      ctx.fillStyle = c.colour;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
  }

  /** A falling piece tumbles: its print shows on one side, the white back on the other. */
  drawPiece(ctx, p) {
    const face = Math.cos(p.flip);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, p.life - PIECE_LIFE_S + 0.5) / 0.5);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.scale(1, Math.abs(face) < 0.05 ? 0.05 : face);
    tracePoly(ctx, p.rel);
    if (face >= 0) {
      ctx.save();
      ctx.clip();
      const { x, y, w, h } = p.box;
      const d = this.dpr;
      if (w >= 1 && h >= 1) ctx.drawImage(this.source, x * d, y * d, w * d, h * d, x - p.home.x, y - p.home.y, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = this.theme.back;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(60,40,30,0.18)";
    ctx.stroke();
    ctx.restore();
  }

  /** Where the finger pulls, the torn paper rolls up into a curl. */
  drawCurl(ctx, tear) {
    if (!tear.dir) return;
    const len = tear.width * 2.1;
    const thick = Math.max(10, tear.width * 0.42);
    ctx.save();
    ctx.translate(tear.last.x, tear.last.y);
    ctx.rotate(Math.atan2(tear.dir.y, tear.dir.x));
    ctx.fillStyle = "rgba(40,25,15,0.18)";
    roundRect(ctx, -thick / 2 + thick * 0.25, -len / 2 + thick * 0.25, thick, len, thick / 2);
    ctx.fill();
    const g = ctx.createLinearGradient(-thick / 2, 0, thick / 2, 0);
    g.addColorStop(0, "#d9d2c6");
    g.addColorStop(0.45, this.theme.back);
    g.addColorStop(1, "#cfc6b8");
    ctx.fillStyle = g;
    roundRect(ctx, -thick / 2, -len / 2, thick, len, thick / 2);
    ctx.fill();
    ctx.fillStyle = this.theme.base; // a sliver of the print, rolled to the outside
    roundRect(ctx, thick * 0.18, -len / 2 + 2, thick * 0.3, len - 4, thick * 0.15);
    ctx.fill();
    ctx.restore();
  }
}

function tracePoly(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function fillPoly(ctx, poly) {
  if (poly.length < 3) return;
  tracePoly(ctx, poly);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
