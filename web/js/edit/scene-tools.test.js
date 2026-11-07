import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSceneTools, nextSceneTools, isPaused, isDrawTool, templatePatch, placeBefore, undoTop, canUndo, TEMPLATES, TOOLS, UNDO_LIMIT } from "./scene-tools.js";

const run = (s, ...events) => events.reduce(nextSceneTools, s);
const start = (over = {}) => ({ ...initialSceneTools(), ...over });

test("starts on Shape with nothing selected, no sheet, not paused", () => {
  const s = initialSceneTools();
  assert.deepEqual(s, { tool: "shape", selected: null, sheet: null, drag: null, colors: { shape: "yellow", line: "brown" }, lifted: null, undo: [], undoing: [], seq: 0 });
  assert.equal(canUndo(s), false);
  assert.equal(undoTop(s), null);
  assert.equal(isPaused(s), false);
  assert.equal(isDrawTool("shape") && isDrawTool("line") && !isDrawTool("move"), true);
  assert.deepEqual(TOOLS, ["shape", "line", "move", "colour", "sky", "ground", "delete"]);
});

test("tool: switches, keeps the selection, Sky and Ground open their sheet, unknown tools are ignored", () => {
  const s = start({ selected: "p1" });
  const move = run(s, { type: "tool", tool: "move" });
  assert.equal(move.tool, "move");
  assert.equal(move.selected, "p1");
  assert.equal(move.sheet, null);
  assert.equal(run(s, { type: "tool", tool: "sky" }).sheet, "sky");
  assert.equal(run(s, { type: "tool", tool: "ground" }).sheet, "ground");
  assert.equal(run(s, { type: "tool", tool: "paint" }), s);
  assert.equal(run(move, { type: "tool", tool: "move" }), move, "same tool again: same state");
});

test("tool: Colour opens the piece sheet only when a piece is selected", () => {
  assert.equal(run(start(), { type: "tool", tool: "colour" }).sheet, null);
  assert.equal(run(start({ selected: "p1" }), { type: "tool", tool: "colour" }).sheet, "piece");
});

test("tool: changing tool closes an open sheet and drops a drag", () => {
  const s = start({ tool: "move", selected: "p1", drag: { mode: "move", id: "p1" } });
  const t = run(s, { type: "tool", tool: "delete" });
  assert.equal(t.drag, null);
  const sky = run(start(), { type: "tool", tool: "sky" }, { type: "tool", tool: "shape" });
  assert.equal(sky.sheet, null);
});

test("open-sheet: draw only in Shape/Line, piece only with a selection, start always; close-sheet", () => {
  assert.equal(run(start(), { type: "open-sheet", sheet: "draw" }).sheet, "draw");
  assert.equal(run(start({ tool: "line" }), { type: "open-sheet", sheet: "draw" }).sheet, "draw");
  const move = start({ tool: "move" });
  assert.equal(run(move, { type: "open-sheet", sheet: "draw" }), move);
  assert.equal(run(move, { type: "open-sheet", sheet: "piece" }), move);
  assert.equal(run(start({ tool: "move", selected: "p" }), { type: "open-sheet", sheet: "piece" }).sheet, "piece");
  assert.equal(run(move, { type: "open-sheet", sheet: "start" }).sheet, "start");
  const open = run(move, { type: "open-sheet", sheet: "start" });
  assert.equal(run(open, { type: "open-sheet", sheet: "start" }), open);
  assert.equal(run(open, { type: "close-sheet" }).sheet, null);
  assert.equal(run(move, { type: "close-sheet" }), move);
  const dragging = start({ tool: "move", selected: "p", drag: { mode: "move", id: "p" } });
  assert.equal(run(dragging, { type: "open-sheet", sheet: "start" }), dragging, "no sheet mid-drag");
});

test("a sheet pauses the board: taps and drags underneath do nothing", () => {
  const s = run(start({ tool: "move", selected: "a" }), { type: "open-sheet", sheet: "start" });
  assert.equal(isPaused(s), true);
  assert.equal(run(s, { type: "tap-piece", id: "b" }), s);
  assert.equal(run(s, { type: "drag-start", mode: "move", id: "a" }), s);
});

test("tap-piece selects in Move, Colour (opens the sheet) and Delete; not in drawing tools", () => {
  assert.equal(run(start({ tool: "move" }), { type: "tap-piece", id: "a" }).selected, "a");
  const c = run(start({ tool: "colour" }), { type: "tap-piece", id: "a" });
  assert.equal(c.selected, "a");
  assert.equal(c.sheet, "piece");
  assert.equal(run(start({ tool: "delete" }), { type: "tap-piece", id: "a" }).selected, "a");
  const shape = start();
  assert.equal(run(shape, { type: "tap-piece", id: "a" }), shape);
  const sel = start({ tool: "move", selected: "a" });
  assert.equal(run(sel, { type: "tap-piece", id: "a" }), sel);
  assert.equal(run(sel, { type: "tap-piece" }), sel);
});

test("tap-away keeps the selection; only deselect or another piece changes it", () => {
  const s = start({ tool: "move", selected: "a" });
  assert.equal(run(s, { type: "tap-empty" }), s);
  assert.equal(run(s, { type: "tap-piece", id: "b" }).selected, "b");
  const d = run(start({ tool: "colour", selected: "a", sheet: "piece" }), { type: "deselect" });
  assert.equal(d.selected, null);
  assert.equal(d.sheet, null);
  const keepSky = run(start({ tool: "sky", selected: "a", sheet: "sky" }), { type: "deselect" });
  assert.equal(keepSky.sheet, "sky");
  const none = start();
  assert.equal(run(none, { type: "deselect" }), none);
});

test("drag: Move tool only; resize only on the selected piece; end and cancel drop it", () => {
  const s = start({ tool: "move" });
  const m = run(s, { type: "drag-start", mode: "move", id: "a" });
  assert.deepEqual(m.drag, { mode: "move", id: "a" });
  assert.equal(m.selected, "a", "picking up selects");
  assert.equal(run(m, { type: "drag-start", mode: "move", id: "b" }), m, "one drag at a time");
  assert.equal(run(m, { type: "drag-end" }).drag, null);
  assert.equal(run(m, { type: "drag-cancel" }).drag, null);
  assert.equal(run(s, { type: "drag-end" }), s);
  assert.equal(run(s, { type: "drag-start", mode: "resize", id: "a" }), s, "resize needs a selection");
  assert.equal(run(start({ tool: "move", selected: "a" }), { type: "drag-start", mode: "resize", id: "a" }).drag.mode, "resize");
  assert.equal(run(s, { type: "drag-start", mode: "spin", id: "a" }), s);
  assert.equal(run(s, { type: "drag-start", mode: "move" }), s);
  const del = start({ tool: "delete" });
  assert.equal(run(del, { type: "drag-start", mode: "move", id: "a" }), del);
});

test("draw-colour sets the colour of the current drawing tool only", () => {
  const s = run(start(), { type: "draw-colour", key: "red" });
  assert.equal(s.colors.shape, "red");
  assert.equal(s.colors.line, "brown");
  const l = run(start({ tool: "line" }), { type: "draw-colour", key: "blue" });
  assert.equal(l.colors.line, "blue");
  assert.equal(run(s, { type: "draw-colour", key: "red" }), s);
  const move = start({ tool: "move" });
  assert.equal(run(move, { type: "draw-colour", key: "red" }), move);
  assert.equal(run(s, { type: "draw-colour" }), s);
});

test("pieces: a selected or dragged piece that went away (deleted, undone) is let go", () => {
  const s = start({ tool: "colour", selected: "a", sheet: "piece", drag: null });
  assert.equal(run(s, { type: "pieces", ids: ["a", "b"] }), s);
  const gone = run(s, { type: "pieces", ids: ["b"] });
  assert.equal(gone.selected, null);
  assert.equal(gone.sheet, null);
  const dragging = start({ tool: "move", selected: "a", drag: { mode: "move", id: "a" } });
  const g2 = run(dragging, { type: "pieces", ids: [] });
  assert.equal(g2.drag, null);
  const sky = start({ tool: "sky", selected: "a", sheet: "sky" });
  assert.equal(run(sky, { type: "pieces" }).sheet, "sky");
});

test("unknown events change nothing; templates give backdrop, colours and no pieces", () => {
  const s = start();
  assert.equal(run(s, { type: "wat" }), s);
  assert.deepEqual(templatePatch("sea"), { backdrop: "sea", skyColor: "sky", groundColor: "water", pieces: [] });
  assert.equal(templatePatch("moon"), null);
  assert.deepEqual(Object.keys(TEMPLATES), ["blank", "meadow", "sea", "room"]);
});

// ---------------------------------------------------------------- lift after a drop

test("drop: a moved piece stays lifted until the store's change arrives, or lift-done", () => {
  const dragging = start({ tool: "move", selected: "a", drag: { mode: "move", id: "a" } });
  const dropped = run(dragging, { type: "drop" });
  assert.equal(dropped.drag, null);
  assert.equal(dropped.lifted, "a");
  assert.equal(run(dropped, { type: "pieces", ids: ["a"] }).lifted, null, "the store has the new stroke");
  assert.equal(run(dropped, { type: "pieces", ids: ["a"] }).selected, "a", "and it stays selected");
  assert.equal(run(dropped, { type: "lift-done" }).lifted, null);
  const idle = start({ tool: "move" });
  assert.equal(run(idle, { type: "drop" }), idle, "no drag, nothing to drop");
  assert.equal(run(idle, { type: "lift-done" }), idle);
  assert.equal(run(dropped, { type: "drag-cancel" }), dropped, "a drop is not a drag");
});

// ---------------------------------------------------------------- undo

const place = (over = {}) => ({ id: "farm", pieces: [{ id: "a" }], skyColor: "sky", groundColor: "grass", backdrop: "meadow", ...over });
const edit = (s, p = place()) => run(s, { type: "edited", placeId: p.id, before: placeBefore(p) });

test("edited: pushes an entry with the place as it was, numbered in order", () => {
  const p = place();
  const before = placeBefore(p);
  assert.deepEqual(before, { pieces: [{ id: "a" }], skyColor: "sky", groundColor: "grass", backdrop: "meadow" });
  assert.notEqual(before.pieces, p.pieces, "its own list");
  const one = edit(start());
  const two = edit(one, place({ skyColor: "lilac" }));
  assert.equal(canUndo(two), true);
  assert.deepEqual(two.undo.map((u) => u.seq), [1, 2]);
  assert.equal(undoTop(two).before.skyColor, "lilac");
  assert.equal(undoTop(two).placeId, "farm");
  assert.equal(run(one, { type: "edited" }), one, "nothing to remember");
  assert.equal(run(one, { type: "edited", placeId: "farm" }), one);
});

test("edited: keeps at most UNDO_LIMIT entries, dropping the oldest", () => {
  let s = start();
  for (let i = 0; i < UNDO_LIMIT + 5; i++) s = edit(s, place({ skyColor: `c${i}` }));
  assert.equal(s.undo.length, UNDO_LIMIT);
  assert.equal(s.undo[0].before.skyColor, "c5");
  assert.equal(undoTop(s).before.skyColor, `c${UNDO_LIMIT + 4}`);
  assert.equal(s.seq, UNDO_LIMIT + 5);
});

test("undo: the newest entry moves to undoing; saved it is gone; failed it is back on top", () => {
  const s = edit(edit(start()), place({ backdrop: "sea" }));
  const u = run(s, { type: "undo" });
  assert.deepEqual(u.undo.map((x) => x.seq), [1]);
  assert.deepEqual(u.undoing.map((x) => x.seq), [2]);
  assert.equal(canUndo(u), true);
  const saved = run(u, { type: "undo-saved", seq: 2 });
  assert.deepEqual(saved.undoing, []);
  assert.equal(run(saved, { type: "undo-saved", seq: 2 }), saved, "only once");
  const failed = run(u, { type: "undo-failed", seq: 2 });
  assert.deepEqual(failed.undo.map((x) => x.seq), [1, 2]);
  assert.deepEqual(failed.undoing, []);
  assert.equal(run(failed, { type: "undo-failed", seq: 2 }), failed);
  const empty = start();
  assert.equal(run(empty, { type: "undo" }), empty, "nothing to undo");
  const both = run(s, { type: "undo" }, { type: "undo" });
  assert.equal(canUndo(both), false);
  assert.deepEqual(both.undoing.map((x) => x.seq), [2, 1]);
});

test("edit-failed: the store no longer has that edit, so its entry goes, wherever it is", () => {
  const s = edit(edit(edit(start())));
  const f = run(s, { type: "edit-failed", seq: 2 });
  assert.deepEqual(f.undo.map((x) => x.seq), [1, 3]);
  assert.equal(run(f, { type: "edit-failed", seq: 2 }), f, "unknown entry");
  // The edit was undone before its write failed: the Undo fails after it and brings nothing back.
  const u = run(s, { type: "undo" }, { type: "edit-failed", seq: 3 }, { type: "undo-failed", seq: 3 });
  assert.deepEqual(u.undo.map((x) => x.seq), [1, 2]);
  assert.deepEqual(u.undoing, []);
  // A saved edit whose Undo failed while a newer edit was queued: the newer edit fails too.
  const queued = edit(run(s, { type: "undo" }), place({ skyColor: "pink" }));
  assert.deepEqual(queued.undo.map((x) => x.seq), [1, 2, 4]);
  const back = run(queued, { type: "undo-failed", seq: 3 }, { type: "edit-failed", seq: 4 });
  assert.deepEqual(back.undo.map((x) => x.seq), [1, 2, 3]);
});

test("undo after a template Start gives back the drawn pieces and the old backdrop", () => {
  const drawn = place({ pieces: [{ id: "a" }, { id: "b" }], backdrop: "meadow" });
  const s = run(edit(start({ tool: "move", selected: "a" }), drawn), { type: "pieces", ids: [] });
  assert.equal(s.selected, null, "the template took the selected piece");
  const top = undoTop(s);
  assert.deepEqual(top.before, { pieces: [{ id: "a" }, { id: "b" }], skyColor: "sky", groundColor: "grass", backdrop: "meadow" });
  const u = run(s, { type: "undo" }, { type: "pieces", ids: ["a", "b"] }, { type: "undo-saved", seq: top.seq });
  assert.equal(canUndo(u), false);
  assert.deepEqual(u.undoing, []);
  assert.equal(u.selected, null, "undo brings the pieces back, not the selection");
});

// ---------------------------------------------------------------- colour picker runs

const pick = (s, p, merge, seal = false) => run(s, { type: "edited", placeId: p.id, before: placeBefore(p), merge, seal });

test("edited with merge: a run of picker moves is one entry that keeps the first before", () => {
  const first = place({ skyColor: "sky" });
  let s = pick(start({ tool: "sky", sheet: "sky" }), first, "sky");
  s = pick(s, place({ skyColor: "#111111" }), "sky");
  s = pick(s, place({ skyColor: "#222222" }), "sky");
  assert.equal(s.undo.length, 1);
  assert.equal(undoTop(s).before.skyColor, "sky", "Undo goes back to before the picker opened");
  assert.equal(undoTop(s).seq, 3, "the entry carries the newest edit's seq");
  assert.equal(s.seq, 3);
  assert.equal(undoTop(s).merge, "sky");
});

test("edited with seal: the commit folds in and closes the run; the next pick is a new entry", () => {
  let s = pick(start(), place(), "ground");
  s = pick(s, place({ groundColor: "#333333" }), "ground", true);
  assert.equal(s.undo.length, 1);
  assert.equal("merge" in undoTop(s), false);
  s = pick(s, place({ groundColor: "#444444" }), "ground");
  assert.equal(s.undo.length, 2);
  assert.equal(undoTop(s).before.groundColor, "#444444");
  const sealedAtOnce = pick(start(), place(), "ground", true);
  assert.equal("merge" in undoTop(sealedAtOnce), false, "a single committed pick is a plain entry");
});

test("a run never swallows another kind of edit, another field or another place", () => {
  let s = pick(start(), place(), "sky");
  s = pick(s, place(), "ground");
  assert.equal(s.undo.length, 2, "ground after sky");
  s = pick(s, place({ id: "sea" }), "ground");
  assert.equal(s.undo.length, 3, "another place");
  s = edit(s);
  s = pick(s, place(), "ground");
  assert.equal(s.undo.length, 5, "a plain edit in between ends the run");
});

test("seal, close-sheet, tool and undo close an open run", () => {
  const open = pick(start({ tool: "sky", sheet: "sky" }), place(), "sky");
  for (const e of [{ type: "seal" }, { type: "close-sheet" }, { type: "tool", tool: "move" }]) {
    const s = run(open, e);
    assert.equal("merge" in undoTop(s), false, e.type);
    assert.equal(pick(s, place(), "sky").undo.length, 2, `${e.type}: the next pick is a new entry`);
  }
  const plain = edit(start());
  assert.equal(run(plain, { type: "seal" }), plain, "nothing open: same state");
  const back = run(open, { type: "undo" }, { type: "undo-failed", seq: 1 });
  assert.equal("merge" in undoTop(back), false, "an entry back from a failed Undo is not a run");
});

test("edit-failed on a run's newest pick drops the run", () => {
  const s = pick(pick(start(), place(), "sky"), place({ skyColor: "#101010" }), "sky");
  const f = run(s, { type: "edit-failed", seq: 2 });
  assert.equal(canUndo(f), false);
  assert.equal(run(s, { type: "edit-failed", seq: 1 }), s, "an earlier pick's seq is no entry");
});
