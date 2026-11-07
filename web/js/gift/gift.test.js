// The pure parts of the wrapping paper: the gift day, the wrapping's state machine, tear geometry
// and coverage, and the paper painter (against a fake 2D context).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGiftDay, parseWhen } from "./calendar.js";
import { DEFAULT_RULES, accepts, initialWrap, nextWrap } from "./state.js";
import { GRID_COLS, GRID_ROWS, clearedFraction, cover, createCoverage, inside, poke, scalePoints, startTear, stripOf, tearSize, tearTo } from "./tear.js";
import { THEMES, confettiColours, paintPaper, resolveTheme, seeded, withAlpha } from "./paper.js";

// ---------------------------------------------------------------- calendar

test("every 7 November, in local time, any year", () => {
  assert.equal(isGiftDay(new Date(2026, 10, 7), "11-07"), true);
  assert.equal(isGiftDay(new Date(2031, 10, 7, 23, 59), "11-07"), true, "the whole day, to local midnight");
  assert.equal(isGiftDay(new Date(2026, 10, 8, 0, 0), "11-07"), false);
  assert.equal(isGiftDay(new Date(2026, 10, 6, 23, 59), "11-07"), false);
  assert.equal(isGiftDay(new Date(2026, 6, 11), "11-07"), false, "day and month are not swapped");
});

test("a one-off date matches only that year", () => {
  assert.equal(isGiftDay(new Date(2026, 11, 24), "2026-12-24"), true);
  assert.equal(isGiftDay(new Date(2027, 11, 24), "2026-12-24"), false);
  assert.equal(isGiftDay(new Date(2027, 11, 24), { month: 12, day: 24 }), true);
});

test("parseWhen reads MM-DD, YYYY-MM-DD and objects, and refuses nonsense", () => {
  assert.deepEqual(parseWhen("11-07"), { month: 11, day: 7 });
  assert.deepEqual(parseWhen(" 2026-1-2 "), { month: 1, day: 2, year: 2026 });
  assert.deepEqual(parseWhen({ month: 3, day: 9 }), { month: 3, day: 9 });
  for (const bad of ["7 November", "13-01", "11-32", "00-10", "", { month: 2 }]) assert.throws(() => parseWhen(bad), RangeError, JSON.stringify(bad));
});

// ---------------------------------------------------------------- state machine

const run = (events, s = initialWrap(), rules = DEFAULT_RULES) => events.reduce((acc, e) => nextWrap(acc, e, rules), s);
const down = (pointerId = 1, primary = true) => ({ type: "down", pointerId, primary });
const up = (pointerId = 1) => ({ type: "up", pointerId });
const cleared = (fraction) => ({ type: "cleared", fraction });

test("a primary finger starts a tear; lifting it with little torn leaves the paper on", () => {
  const s = run([down(7)]);
  assert.equal(s.phase, "tearing");
  assert.equal(s.pointerId, 7);
  assert.equal(s.tears, 1);
  assert.ok(accepts(s, 7));
  assert.ok(!accepts(s, 8));
  const after = run([cleared(0.1), up(7)], s);
  assert.equal(after.phase, "wrapped");
  assert.equal(after.pointerId, null);
  assert.equal(after.cleared, 0.1);
});

test("palms and second fingers are ignored, and only the tearing finger can end its tear", () => {
  const s0 = initialWrap();
  assert.equal(nextWrap(s0, down(2, false)), s0, "not primary");
  const s = run([down(1)]);
  assert.equal(nextWrap(s, down(3)), s, "a second finger while tearing");
  assert.equal(nextWrap(s, up(3)), s, "another pointer's lift");
  assert.equal(nextWrap(s, { type: "cancel", pointerId: 1 }).phase, "wrapped");
});

test("enough torn away opens it on the lift, not mid-pull", () => {
  const s = run([down(), cleared(DEFAULT_RULES.openAt)]);
  assert.equal(s.phase, "tearing");
  assert.equal(run([up()], s).phase, "opening");
});

test("a child who only pokes still gets it open after enough tears", () => {
  const rules = { openAt: 0.9, openAfterTears: 3 };
  const s = run([down(), up(), down(), up()], initialWrap(), rules);
  assert.equal(s.phase, "wrapped");
  assert.equal(run([down(), up()], s, rules).phase, "opening");
});

test("cleared only grows and is capped at 1", () => {
  const s = run([cleared(0.3), cleared(0.2)]);
  assert.equal(s.cleared, 0.3);
  assert.equal(run([cleared(1.5)]).cleared, 1);
});

test("open from a key or the host, then opened; nothing reopens it", () => {
  assert.equal(run([{ type: "open" }]).phase, "opening");
  const mid = run([down(4), { type: "open" }]);
  assert.equal(mid.phase, "opening");
  assert.equal(mid.pointerId, null, "the tear in progress ends");
  const opening = run([{ type: "open" }]);
  assert.equal(nextWrap(opening, { type: "open" }), opening);
  assert.equal(nextWrap(opening, down()), opening, "no tearing while it falls away");
  const open = run([{ type: "opened" }], opening);
  assert.equal(open.phase, "open");
  for (const e of [down(), { type: "open" }, cleared(0.9), { type: "opened" }, { type: "destroy" }]) assert.equal(nextWrap(open, e), open);
  assert.equal(nextWrap(initialWrap(), { type: "opened" }).phase, "wrapped", "opened only follows opening");
});

test("destroy takes the paper away from any phase", () => {
  for (const s of [initialWrap(), run([down()]), run([{ type: "open" }])]) assert.equal(nextWrap(s, { type: "destroy" }).phase, "open");
  const s = initialWrap();
  assert.equal(nextWrap(s, { type: "nonsense" }), s);
});

// ---------------------------------------------------------------- tear geometry

const rng = () => seeded(42);
const centroid = (poly) => poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });

test("tear size scales with the screen and has a floor", () => {
  assert.equal(tearSize(1180, 820), 820 * 0.08);
  assert.equal(tearSize(200, 100), 28);
});

test("a poke is a ragged hole around the finger, with a white rim just outside it", () => {
  const { cut, rim } = poke(100, 100, 30, rng());
  assert.equal(cut.length, rim.length);
  assert.ok(inside(100, 100, cut));
  for (let i = 0; i < cut.length; i++) {
    const rc = Math.hypot(cut[i].x - 100, cut[i].y - 100), rr = Math.hypot(rim[i].x - 100, rim[i].y - 100);
    assert.ok(rc > 30 * 0.7 && rc < 30 * 1.2, `ragged but round: ${rc}`);
    assert.ok(rr > rc, "the rim is outside the hole");
  }
});

test("the tear follows the pull in whatever direction it goes", () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, -0.8], [-Math.SQRT1_2, -Math.SQRT1_2]]) {
    const r = rng();
    let { tear } = startTear(500, 400, 60, r);
    const res = tearTo(tear, 500 + dx * 300, 400 + dy * 300, r);
    tear = res.tear;
    assert.ok(res.pieces.length > 4);
    assert.ok(Math.abs(tear.dir.x - dx) < 1e-9 && Math.abs(tear.dir.y - dy) < 1e-9, "heads along the pull");
    // The holes lie along the pull: every cut's centre is near the line from the start to the finger.
    for (const { cut } of res.pieces) {
      const c = centroid(cut);
      const t = (c.x - 500) * dx + (c.y - 400) * dy, off = Math.abs((c.x - 500) * -dy + (c.y - 400) * dx);
      assert.ok(t > -60 && t < 330, `along the pull: ${t}`);
      assert.ok(off < 60 * 1.3, `close to the line: ${off}`);
    }
    assert.ok(Math.hypot(tear.last.x - (500 + dx * 300), tear.last.y - (400 + dy * 300)) < tear.half * 0.3 + 1e-6, "keeps up with the finger");
  }
});

test("the strip starts narrow at the poke and widens to full width", () => {
  const r = rng();
  const { tear } = tearTo(startTear(0, 100, 50, r).tear, 600, 100, r);
  const widthAt = (i) => tear.right[i].y - tear.left[i].y; // pulling right: left edge is below (n = (0, 1))
  assert.ok(Math.abs(widthAt(0)) < Math.abs(widthAt(tear.left.length - 1)));
  assert.ok(Math.abs(tear.width - 50) < 1e-9);
});

test("a move shorter than a step changes nothing; many small moves add up like one", () => {
  const r = rng();
  const { tear } = startTear(0, 0, 60, r);
  const tiny = tearTo(tear, 3, 0, r);
  assert.equal(tiny.tear, tear);
  assert.equal(tiny.pieces.length, 0);
  let t = tear;
  for (let x = 4; x <= 200; x += 4) t = tearTo(t, x, 0, r).tear;
  const once = tearTo(tear, 200, 0, rng()).tear;
  assert.equal(t.left.length, once.left.length);
  assert.ok(t.left.length > 5);
});

test("tearTo never changes the tear it was given", () => {
  const r = rng();
  const { tear } = startTear(0, 0, 40, r);
  const frozen = JSON.stringify(tear);
  tearTo(tear, 300, 300, r);
  assert.equal(JSON.stringify(tear), frozen);
});

test("the torn strip is one outline from the poke along both edges; none before the first step", () => {
  const r = rng();
  const { tear } = startTear(10, 10, 40, r);
  assert.equal(stripOf(tear), null);
  const t = tearTo(tear, 400, 10, r).tear;
  const strip = stripOf(t);
  assert.equal(strip.length, 1 + t.left.length * 2);
  assert.deepEqual(strip[0], { x: 10, y: 10 });
  assert.deepEqual(strip[1], t.left[0]);
  assert.deepEqual(strip.at(-1), t.right[0]);
});

// ---------------------------------------------------------------- coverage

test("coverage counts the cells whose centre a cut covers, once each", () => {
  const cov = createCoverage();
  assert.equal(cov.cols * cov.rows, GRID_COLS * GRID_ROWS);
  const half = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 600 }, { x: 0, y: 600 }];
  cover(cov, half, 1000, 600);
  assert.equal(clearedFraction(cov), 0.5);
  cover(cov, half, 1000, 600);
  assert.equal(clearedFraction(cov), 0.5, "the same place twice counts once");
  cover(cov, [{ x: -100, y: -100 }, { x: 2000, y: -100 }, { x: 2000, y: 2000 }, { x: -100, y: 2000 }], 1000, 600);
  assert.equal(clearedFraction(cov), 1, "off-screen corners are clamped");
});

test("coverage ignores degenerate input", () => {
  const cov = createCoverage(4, 4);
  assert.equal(cover(cov, [{ x: 0, y: 0 }, { x: 10, y: 10 }], 100, 100), 0);
  assert.equal(cover(cov, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], 0, 100), 0);
});

test("a full-width pull across the screen clears a good share, so a few pulls open it", () => {
  const r = rng();
  const cov = createCoverage();
  let { tear, pieces } = startTear(0, 410, tearSize(1180, 820), r);
  const res = tearTo(tear, 1180, 410, r);
  for (const p of [...pieces, ...res.pieces]) cover(cov, p.cut, 1180, 820);
  const f = clearedFraction(cov);
  assert.ok(f > 0.1 && f < DEFAULT_RULES.openAt, `one pull clears ${f}`);
});

test("scalePoints maps a tear to a rotated screen", () => {
  assert.deepEqual(scalePoints([{ x: 100, y: 50 }], 0.5, 2), [{ x: 50, y: 100 }]);
});

// ---------------------------------------------------------------- paper

function fakeCtx() {
  const calls = [];
  const makeGradient = (...args) => { calls.push(["gradient", ...args]); return { addColorStop: (o, c) => calls.push(["stop", o, c]), toJSON: () => "gradient" }; };
  return new Proxy({ calls }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "createRadialGradient" || key === "createLinearGradient") return makeGradient;
      return (...args) => calls.push([key, ...args]);
    },
    set(target, key, value) {
      calls.push(["set", key, value]);
      return true;
    },
  });
}

test("the paper fills the sheet with its base colour first, then print and ribbon", () => {
  for (const name of Object.keys(THEMES)) {
    const ctx = fakeCtx();
    const theme = THEMES[name];
    paintPaper(ctx, 800, 600, theme, seeded(1));
    assert.deepEqual(ctx.calls[0], ["set", "fillStyle", theme.base]);
    assert.deepEqual(ctx.calls[1], ["fillRect", 0, 0, 800, 600]);
    const fills = ctx.calls.filter((c) => c[0] === "set" && c[1] === "fillStyle").map((c) => c[2]);
    assert.ok(fills.includes(theme.ribbon) && fills.includes(theme.ink[0]), name);
  }
});

test("every motif and stripes paint, and the same seed paints the same paper", () => {
  for (const motif of ["dots", "leaves", "stars", "confetti", "stripes"]) {
    const theme = resolveTheme({ motif, wash: ["#abc"] });
    const a = fakeCtx(), b = fakeCtx();
    paintPaper(a, 400, 300, theme, seeded(9));
    paintPaper(b, 400, 300, theme, seeded(9));
    assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls), motif);
    assert.ok(a.calls.length > 30, motif);
  }
});

test("themes: by name, unknown name falls back, partial objects lie over classic", () => {
  assert.equal(resolveTheme("autumn"), THEMES.autumn);
  assert.equal(resolveTheme("nope"), THEMES.classic);
  assert.equal(resolveTheme({ base: "#000" }).ribbon, THEMES.classic.ribbon);
  assert.equal(resolveTheme(undefined).base, THEMES.classic.base);
  assert.deepEqual(confettiColours(THEMES.autumn), THEMES.autumn.confetti);
  assert.ok(confettiColours(THEMES.classic).includes(THEMES.classic.ribbon));
});

test("seeded is deterministic and in [0, 1)", () => {
  const a = seeded(5), b = seeded(5);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test("withAlpha turns hex into rgba and leaves other colours alone", () => {
  assert.equal(withAlpha("#ff8000", 0.5), "rgba(255,128,0,0.5)");
  assert.equal(withAlpha("#f80", 1), "rgba(255,136,0,1)");
  assert.equal(withAlpha("red", 0.3), "red");
});
