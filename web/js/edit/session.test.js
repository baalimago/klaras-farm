import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSession, nextSession, AUTO_CLOSE_MS, GRACE_MS } from "./session.js";

const run = (events, start = initialSession(0)) => events.reduce((s, [e, t]) => nextSession(s, typeof e === "string" ? { type: e } : e, t), start);
const inEdit = (t = 1000) => run([["hold-armed", t], ["gate-pass", t + 100]]);

test("hold → gate → pass → edit; fail returns to play", () => {
  let s = run([["hold-armed", 1000]]);
  assert.equal(s.mode, "gate");
  assert.equal(nextSession(s, { type: "gate-fail" }, 1200).mode, "play");
  s = nextSession(s, { type: "gate-pass" }, 1200);
  assert.equal(s.mode, "edit");
  assert.equal(s.panel, null);
  assert.equal(s.lastActivityAt, 1200);
});

test("a hold that asks for a panel (long press on a find button) opens it after the adult check", () => {
  const then = { name: "find-setup", params: { game: "color" } };
  let s = nextSession(initialSession(0), { type: "hold-armed", then }, 1000);
  assert.equal(s.mode, "gate");
  assert.equal(s.panel, null, "nothing for grown-ups shows before the check");
  assert.deepEqual(s.then, then);
  const passed = nextSession(s, { type: "gate-pass" }, 1500);
  assert.equal(passed.mode, "edit");
  assert.deepEqual(passed.panel, then);
  assert.equal(passed.then, null);
  const failed = nextSession(s, { type: "gate-fail" }, 1500);
  assert.equal(failed.mode, "play");
  assert.equal(failed.then, null, "a failed check forgets the panel");
  assert.equal(nextSession(failed, { type: "hold-armed" }, 2000).then, null, "a plain hold asks for no panel");
  assert.deepEqual(nextSession(initialSession(0), { type: "hold-armed", then: { name: "find-setup" } }, 1).then, { name: "find-setup", params: {} });
});

test("within grace a hold that asks for a panel opens edit with it at once", () => {
  const closed = nextSession(inEdit(0), { type: "tick" }, 100 + AUTO_CLOSE_MS);
  const s = nextSession(closed, { type: "hold-armed", then: { name: "find-setup", params: { game: "animal" } } }, 100 + AUTO_CLOSE_MS + 10);
  assert.equal(s.mode, "edit");
  assert.deepEqual(s.panel, { name: "find-setup", params: { game: "animal" } });
});

test("closing a panel a hold opened from play goes back to play, with grace; other panels stay in edit", () => {
  const then = { name: "find-setup", params: { game: "animal" } };
  const open = nextSession(nextSession(initialSession(0), { type: "hold-armed", then }, 1000), { type: "gate-pass" }, 1500);
  const closed = nextSession(open, { type: "close-panel" }, 9000);
  assert.equal(closed.mode, "play", "the parent came from the child's game");
  assert.equal(closed.panel, null);
  assert.equal(closed.graceUntil, 9000 + GRACE_MS, "a hold within grace reopens without the check");
  // In grace, the same hold opens the setup at once and Done on it again returns to play.
  const again = nextSession(closed, { type: "hold-armed", then }, 9500);
  assert.equal(again.mode, "edit");
  assert.equal(nextSession(again, { type: "close-panel" }, 9600).mode, "play");
  // A panel opened from edit mode (a card) closes back into edit mode.
  const card = nextSession(inEdit(0), { type: "open-panel", name: "thing-card", params: { thingId: "t" } }, 10);
  assert.equal(nextSession(card, { type: "close-panel" }, 20).mode, "edit");
  // Opening another panel from edit forgets the way back; Done always ends in play.
  const other = nextSession(open, { type: "open-panel", name: "settings" }, 1600);
  assert.equal(nextSession(other, { type: "close-panel" }, 1700).mode, "edit");
  assert.equal(nextSession(open, { type: "done" }, 1700).back, null);
});

test("Done ends the session: the next hold needs the check again", () => {
  let s = nextSession(inEdit(), { type: "done" }, 5000);
  assert.equal(s.mode, "play");
  assert.equal(s.graceUntil, 0);
  assert.equal(nextSession(s, { type: "hold-armed" }, 6000).mode, "gate");
});

test("auto-closes after 60 s without activity in the plain edit view", () => {
  let s = inEdit(0); // lastActivityAt 100
  s = run([["activity", 30000], ["tick", 30000 + AUTO_CLOSE_MS - 1]], s);
  assert.equal(s.mode, "edit");
  s = nextSession(s, { type: "tick" }, 30000 + AUTO_CLOSE_MS);
  assert.equal(s.mode, "play");
  assert.equal(s.graceUntil, 30000 + AUTO_CLOSE_MS + GRACE_MS);
  assert.equal(AUTO_CLOSE_MS, 60000);
  assert.equal(GRACE_MS, 300000);
});

test("auto-close also applies in the scene view", () => {
  let s = run([["scene-tools", 1000]], inEdit(0));
  assert.equal(s.mode, "scene");
  assert.equal(nextSession(s, { type: "tick" }, 1000 + AUTO_CLOSE_MS).mode, "play");
  assert.equal(nextSession(s, { type: "scene-done" }, 2000).mode, "edit");
});

test("the timer pauses while a panel is open and restarts when it closes", () => {
  let s = nextSession(inEdit(0), { type: "open-panel", name: "card", params: { thingId: "t1" } }, 1000);
  assert.deepEqual(s.panel, { name: "card", params: { thingId: "t1" } });
  s = nextSession(s, { type: "tick" }, 1000 + 10 * AUTO_CLOSE_MS);
  assert.equal(s.mode, "edit");
  s = nextSession(s, { type: "close-panel" }, 700000);
  assert.equal(s.panel, null);
  assert.equal(nextSession(s, { type: "tick" }, 700000 + AUTO_CLOSE_MS - 1).mode, "edit");
  assert.equal(nextSession(s, { type: "tick" }, 700000 + AUTO_CLOSE_MS).mode, "play");
});

test("after an auto-close the hold alone reopens edit for 5 minutes", () => {
  const closed = nextSession(inEdit(0), { type: "tick" }, 100 + AUTO_CLOSE_MS);
  const t = 100 + AUTO_CLOSE_MS;
  assert.equal(nextSession(closed, { type: "hold-armed" }, t + GRACE_MS - 1).mode, "edit");
  assert.equal(nextSession(closed, { type: "hold-armed" }, t + GRACE_MS).mode, "gate");
});

test("any play tap cancels the grace", () => {
  let s = nextSession(inEdit(0), { type: "tick" }, 100 + AUTO_CLOSE_MS);
  s = nextSession(s, { type: "play-tap" }, 100 + AUTO_CLOSE_MS + 1000);
  assert.equal(s.graceUntil, 0);
  assert.equal(nextSession(s, { type: "hold-armed" }, 100 + AUTO_CLOSE_MS + 2000).mode, "gate");
});

test("returns the same object when nothing changes (so Session can skip 'change')", () => {
  const play = initialSession(0);
  for (const type of ["gate-pass", "gate-fail", "close-panel", "scene-done", "scene-tools", "tick", "play-tap", "activity", "done"]) {
    assert.equal(nextSession(play, { type }, 10), play, type);
  }
  assert.equal(nextSession(play, { type: "open-panel", name: "card" }, 10), play);
  const edit = inEdit(0);
  assert.equal(nextSession(edit, { type: "hold-armed" }, 500), edit);
  assert.equal(nextSession(edit, { type: "tick" }, 5000), edit);
  const gate = run([["hold-armed", 0]]);
  assert.equal(nextSession(gate, { type: "hold-armed" }, 10), gate);
});

test("opening a panel keeps its object; scene-tools closes any panel", () => {
  const s = nextSession(inEdit(0), { type: "open-panel", name: "settings" }, 500);
  assert.deepEqual(s.panel, { name: "settings", params: {} });
  const same = nextSession(s, { type: "activity" }, 600);
  assert.equal(same.panel, s.panel);
  assert.equal(nextSession(s, { type: "scene-tools" }, 700).panel, null);
  assert.equal(nextSession(s, { type: "done" }, 700).panel, null);
});
