import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSceneTools, nextSceneTools, isPaused, isDrawTool, templatePatch, TEMPLATES, TOOLS } from "./scene-tools.js";

const run = (s, ...events) => events.reduce(nextSceneTools, s);
const start = (over = {}) => ({ ...initialSceneTools(), ...over });

test("starts on Shape with nothing selected, no sheet, not paused", () => {
  const s = initialSceneTools();
  assert.deepEqual(s, { tool: "shape", selected: null, sheet: null, drag: null, colors: { shape: "yellow", line: "brown" } });
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
