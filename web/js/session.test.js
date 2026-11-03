// Session wrapper in Node with a fake clock, fake timers, a fake window and fake services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "./session.js";

function fakeClock(start = 1_000_000) {
  let now = start;
  let seq = 0;
  const jobs = new Map(); // id → {at, fn, every}
  const timers = {
    setTimeout: (fn, ms = 0) => (jobs.set(++seq, { at: now + ms, fn }), seq),
    clearTimeout: (id) => jobs.delete(id),
    setInterval: (fn, ms) => (jobs.set(++seq, { at: now + ms, fn, every: ms }), seq),
    clearInterval: (id) => jobs.delete(id),
  };
  return {
    timers,
    now: () => now,
    pending: () => jobs.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, j] of jobs) if (j.at <= end && (!next || j.at < next[1].at)) next = [id, j];
        if (!next) break;
        const [id, j] = next;
        now = j.at;
        if (j.every) j.at += j.every;
        else jobs.delete(id);
        j.fn();
      }
      now = end;
    },
  };
}

function pointer(type, fields = {}) {
  return Object.assign(new Event(type), { pointerId: 1, isPrimary: true, clientX: 500, clientY: 400, width: 20, height: 20, ...fields });
}

function setup({ things = 2, pickHit = null, connect = true } = {}) {
  const clock = fakeClock();
  const win = Object.assign(new EventTarget(), { innerWidth: 1180, innerHeight: 820 });
  const calls = [];
  const rings = [];
  const services = {
    audio: { holdTone: (on) => calls.push(["holdTone", on]), chime: (k) => calls.push(["chime", k]) },
    engine: { setMode: (m) => calls.push(["setMode", m]), pick: () => pickHit },
    store: { currentPlace: { id: "p1" }, canAddThing: () => things < 4 },
    shell: { toast: (msg) => calls.push(["toast", msg]) },
  };
  const board = { services, toBoard: (x, y) => ({ x: x / 1000, y: y / 1000 }) };
  const session = new Session({
    now: clock.now,
    timers: clock.timers,
    win,
    doc: null,
    createRing: () => {
      const ring = { shown: [], removed: false, set(x, y, p, visible) { this.shown.push({ x, y, p, visible }); }, remove() { this.removed = true; } };
      rings.push(ring);
      return ring;
    },
  });
  if (connect) session.connect(services);
  const changes = [];
  session.addEventListener("change", () => changes.push(session.state.mode));
  const holdDown = (fields = {}) => {
    const e = pointer("pointerdown", fields);
    session.holdStart(e, board);
    win.dispatchEvent(e); // the same event bubbles on to the window: must not count as a second finger
    return e;
  };
  return { clock, win, calls, rings, services, board, session, changes, holdDown };
}

test("starts in play", () => {
  const { session } = setup();
  assert.equal(session.state.mode, "play");
  assert.equal(session.state.panel, null);
});

test("a 1.5 s hold shows the ring after 0.5 s with the soft tone, then opens the gate", () => {
  const { clock, calls, rings, session, holdDown } = setup({ connect: false }); // services come from the board
  let armed = 0;
  session.addEventListener("hold-armed", () => armed++);
  holdDown();
  clock.advance(450);
  const ring = rings[0];
  assert.ok(ring.shown.every((s) => !s.visible), "nothing visible before 0.5 s");
  assert.deepEqual(calls, []);
  clock.advance(100);
  assert.ok(ring.shown.at(-1).visible);
  assert.deepEqual(calls, [["holdTone", true]]);
  clock.advance(500);
  const mid = ring.shown.at(-1).p;
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  assert.equal(session.state.mode, "play");
  clock.advance(450);
  assert.equal(session.state.mode, "gate");
  assert.equal(armed, 1);
  assert.equal(ring.shown.at(-1).p, 1);
  assert.deepEqual(calls.filter((c) => c[0] === "holdTone"), [["holdTone", true], ["holdTone", false]]);
  assert.ok(!calls.some((c) => c[0] === "chime"), "no pop and no chime before the check");
  assert.equal(ring.removed, false, "the full ring stays under the finger until release");
});

test("releasing early, moving or a second finger cancels silently", () => {
  for (const [type, fields] of [
    ["pointerup", {}],
    ["pointercancel", {}],
    ["pointermove", { clientX: 520 }],
    ["pointerdown", { pointerId: 2, isPrimary: false }],
  ]) {
    const { clock, win, calls, rings, session, holdDown } = setup();
    holdDown();
    clock.advance(800);
    win.dispatchEvent(pointer(type, fields));
    clock.advance(2000);
    assert.equal(session.state.mode, "play", type);
    assert.equal(rings[0].removed, true, type);
    assert.deepEqual(calls, [["holdTone", true], ["holdTone", false]], type);
  }
});

test("after release the ring goes and no timers are left behind in play", () => {
  const { clock, win, rings, holdDown } = setup();
  holdDown();
  clock.advance(300);
  win.dispatchEvent(pointer("pointerup"));
  assert.equal(rings[0].removed, true);
  assert.equal(clock.pending(), 0);
});

test("holds at the bottom or side edges never start", () => {
  const { clock, rings, session, holdDown } = setup();
  holdDown({ clientY: 800 });
  holdDown({ clientX: 10 });
  clock.advance(3000);
  assert.equal(session.state.mode, "play");
  assert.equal(rings.length, 0);
});

test("passing the gate enters edit with the rising chime and tells the engine", () => {
  const { calls, session, changes, holdDown, clock } = setup({ connect: false });
  holdDown();
  clock.advance(1500);
  session.gatePassed();
  assert.equal(session.state.mode, "edit");
  assert.deepEqual(changes, ["gate", "edit"]);
  assert.deepEqual(calls.filter((c) => c[0] !== "holdTone"), [["setMode", "play"], ["chime", "enter"], ["setMode", "edit"]]);
});

test("a failed gate returns to play silently", () => {
  const { calls, session } = setup();
  session.holdArmed();
  session.gateFailed();
  assert.equal(session.state.mode, "play");
  assert.ok(!calls.some((c) => c[0] === "chime"));
});

test("Done leaves with the falling chime; the next entry needs the check", () => {
  const { calls, session, clock } = setup();
  session.holdArmed();
  session.gatePassed();
  session.done();
  assert.equal(session.state.mode, "play");
  assert.deepEqual(calls.filter((c) => c[0] === "chime"), [["chime", "enter"], ["chime", "leave"]]);
  assert.equal(clock.pending(), 0, "ticker stops in play");
  session.holdArmed();
  assert.equal(session.state.mode, "gate");
});

test("auto-closes after 60 s idle; input on the window keeps it open; the hold alone reopens within grace", () => {
  const { calls, session, clock, win } = setup();
  session.holdArmed();
  session.gatePassed();
  clock.advance(50_000);
  win.dispatchEvent(pointer("pointerdown", { pointerId: 9 }));
  clock.advance(50_000);
  assert.equal(session.state.mode, "edit");
  clock.advance(11_000);
  assert.equal(session.state.mode, "play");
  assert.deepEqual(calls.filter((c) => c[0] === "chime").at(-1), ["chime", "leave"]);
  session.holdArmed();
  assert.equal(session.state.mode, "edit", "grace: no check");
  assert.deepEqual(calls.filter((c) => c[0] === "chime").at(-1), ["chime", "enter"]);
});

test("a play tap cancels the grace", () => {
  const { session, clock } = setup();
  session.holdArmed();
  session.gatePassed();
  clock.advance(61_000);
  assert.equal(session.state.mode, "play");
  session.playTap();
  session.holdArmed();
  assert.equal(session.state.mode, "gate");
});

test("the timer pauses while a panel is open", () => {
  const { session, clock } = setup();
  session.holdArmed();
  session.gatePassed();
  session.openPanel("card", { thingId: "t1" });
  assert.deepEqual(session.state.panel, { name: "card", params: { thingId: "t1" } });
  clock.advance(10 * 60_000);
  assert.equal(session.state.mode, "edit");
  session.closePanel();
  clock.advance(59_000);
  assert.equal(session.state.mode, "edit");
  clock.advance(2_000);
  assert.equal(session.state.mode, "play");
});

test("scene tools and back", () => {
  const { session, calls } = setup();
  session.holdArmed();
  session.gatePassed();
  session.sceneTools();
  assert.equal(session.state.mode, "scene");
  session.sceneDone();
  assert.equal(session.state.mode, "edit");
  assert.deepEqual(calls.filter((c) => c[0] === "setMode").map((c) => c[1]), ["play", "edit", "scene", "edit"]);
  assert.ok(!calls.some((c) => c[1] === "leave"));
});

test("'change' only fires when mode or panel changes", () => {
  const { session, changes } = setup();
  session.activity();
  session.playTap();
  session.closePanel();
  assert.deepEqual(changes, []);
  session.holdArmed();
  session.activity();
  assert.deepEqual(changes, ["gate"]);
});

test("holding an empty spot in edit mode starts + Add there", () => {
  const { session, holdDown, clock } = setup();
  session.holdArmed();
  session.gatePassed();
  holdDown({ clientX: 300, clientY: 500 });
  clock.advance(1500);
  assert.equal(session.state.mode, "edit");
  assert.deepEqual(session.state.panel, { name: "guided", params: { at: [0.3, 0.5] } });
});

test("holding a thing in edit mode does not add; a full place says why", () => {
  const a = setup({ pickHit: "t1" });
  a.session.holdArmed();
  a.session.gatePassed();
  a.holdDown();
  a.clock.advance(1500);
  assert.equal(a.session.state.panel, null);

  const b = setup({ things: 4 });
  b.session.holdArmed();
  b.session.gatePassed();
  b.holdDown();
  b.clock.advance(1500);
  assert.equal(b.session.state.panel, null);
  assert.equal(b.calls.filter((c) => c[0] === "toast").length, 1);
});

test("holds are ignored in the gate, in scene tools and while a panel is open", () => {
  const { session, holdDown, clock, rings } = setup();
  session.holdArmed();
  holdDown();
  clock.advance(2000);
  session.gatePassed();
  session.sceneTools();
  holdDown();
  clock.advance(2000);
  session.sceneDone();
  session.openPanel("settings");
  holdDown();
  clock.advance(2000);
  assert.equal(rings.length, 0);
  assert.equal(session.state.panel.name, "settings");
});

test("the 'e' key opens the gate in play (desktop), but not while typing", () => {
  const { session, win } = setup();
  const key = (k, target) => {
    const e = Object.assign(new Event("keydown"), { key: k });
    if (target) Object.defineProperty(e, "target", { value: target });
    win.dispatchEvent(e);
  };
  key("e", { tagName: "INPUT" });
  assert.equal(session.state.mode, "play");
  key("x");
  assert.equal(session.state.mode, "play");
  key("e");
  assert.equal(session.state.mode, "gate");
});

test("works without services: no audio, no engine", () => {
  const s = new Session({ now: () => 0, timers: fakeClock().timers, win: null, doc: null });
  s.holdArmed();
  s.gatePassed();
  s.done();
  assert.equal(s.state.mode, "play");
});
