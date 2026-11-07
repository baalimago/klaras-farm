// Scene tools state machine (flow 3, US-2.2), pure: state + event → state.
// <kf-scene-tools> keeps one of these and renders from it after every event.
//
//   tool:     'shape' | 'line' | 'move' | 'colour' | 'sky' | 'ground' | 'delete'
//   selected: null | pieceId   the piece the parent picked. Tapping empty board never clears it; only
//                              'deselect', picking another piece or the piece going away does.
//   sheet:    null | 'draw' | 'piece' | 'sky' | 'ground' | 'start'
//             the foreground colour (or template) sheet. While a sheet is open the board takes no
//             input (paused), so a tap meant for a colour can never draw a stroke.
//   drag:     null | {mode: 'move' | 'resize', id}   a piece under the finger (Move tool)
//   colors:   {shape, line}    felt colour for the next drawn shape / line
//   lifted:   null | pieceId   a dropped piece the board still shows lifted, until the store's change
//                              for it arrives (then the renderer draws it from the store itself)
//   undo:     UndoEntry[]      the edits that can be taken back, newest last, at most UNDO_LIMIT.
//                              UndoEntry = {seq, placeId, before, merge?}: `before` is the place's
//                              {pieces, skyColor, groundColor, backdrop} as it was, so Undo is one
//                              store.updatePlace with it. `merge` ('sky' | 'ground') marks an open
//                              run of colour-picker edits that later picks fold into (see `edited`).
//   undoing:  UndoEntry[]      entries taken back whose Undo write has not committed yet
//   seq:      number           the last entry's number (each edit gets the next one)
//
// Edits reach the store synchronously (FarmStore applies and emits inside the tap); its write
// commits later, in call order. So an entry is pushed at once and only dropped again if its write
// fails. A failed write rolls the store back to its last committed snapshot and fails every write
// queued after it, so each failure drops exactly the entries whose edits the store no longer has.
//
// Transitions (anything not listed leaves the state as it is, and returns the same object):
//   tool {tool}          → that tool, sheet closed (Sky and Ground open their sheet), drag dropped;
//                          the selection stays. Colour with a selection opens the piece sheet.
//                          An open picker run is sealed.
//   open-sheet {sheet}   → 'draw' in Shape/Line, 'piece' with a selection, 'start' always.
//   close-sheet          → no sheet; an open picker run is sealed.
//   tap-piece {id}       → selects it (Move, Colour, Delete). Colour opens the piece sheet.
//   tap-empty            → unchanged.
//   deselect             → no selection, piece sheet closed.
//   drag-start {mode,id} → Move tool only, no sheet; selects the piece. Resize needs it selected.
//   drag-end / drag-cancel → no drag.
//   draw-colour {key}    → the colour for the current drawing tool.
//   drop                 → (a drag that moved) no drag; the piece stays lifted until `pieces` or `lift-done`.
//   lift-done            → nothing lifted (the drop changed nothing in the store).
//   pieces {ids}         → the store changed: the lift ends; a selection or drag of a gone piece ends.
//   edited {placeId, before, merge?, seal?} → push an undo entry (the oldest goes past UNDO_LIMIT).
//                          With `merge`, while the newest entry is an open run with the same merge
//                          and place, the edit folds into it instead: the entry keeps its `before`
//                          and takes the new seq, so dragging through the colour picker is one Undo.
//                          `seal` (the picker committed its value) closes the run after this edit.
//   seal                 → the newest entry's run (if open) is closed: the next pick starts a new entry.
//   edit-failed {seq}    → that edit's write failed: its entry goes (from undo or undoing).
//   undo                 → the newest entry moves to undoing (read it first with undoTop).
//   undo-saved {seq}     → the Undo committed: the entry is gone for good.
//   undo-failed {seq}    → the Undo's write failed, so the store has the edit again: the entry is back
//                          on top. (If the edit itself had failed, edit-failed already dropped it.)

export const TOOLS = Object.freeze(["shape", "line", "move", "colour", "sky", "ground", "delete"]);

/** Colours each template starts with (same as a new scene in <kf-scenes>). */
export const TEMPLATES = Object.freeze({
  blank: Object.freeze({ skyColor: "cream", groundColor: "sand" }),
  meadow: Object.freeze({ skyColor: "sky", groundColor: "grass" }),
  sea: Object.freeze({ skyColor: "sky", groundColor: "water" }),
  room: Object.freeze({ skyColor: "wall", groundColor: "floor" }),
});

/** How many edits Undo can take back. */
export const UNDO_LIMIT = 50;

export function initialSceneTools({ tool = "shape", colors = { shape: "yellow", line: "brown" } } = {}) {
  return { tool, selected: null, sheet: null, drag: null, colors: { ...colors }, lifted: null, undo: [], undoing: [], seq: 0 };
}

/** The entry Undo would take back next, or null. */
export const undoTop = (s) => s.undo.at(-1) ?? null;

/** True when there is an edit to take back. */
export const canUndo = (s) => s.undo.length > 0;

/** The place fields an undo entry keeps. Snapshots are never mutated (FarmStore intents are pure), so
 *  the pieces can be shared; the list itself is copied. */
export function placeBefore(place) {
  return { pieces: [...place.pieces], skyColor: place.skyColor, groundColor: place.groundColor, backdrop: place.backdrop };
}

const withoutSeq = (list, seq) => list.filter((u) => u.seq !== seq);

/** The state with the newest entry's picker run closed (the same object when none is open). */
function sealed(s) {
  const top = undoTop(s);
  if (!top?.merge) return s;
  const { merge, ...entry } = top;
  return { ...s, undo: [...s.undo.slice(0, -1), entry] };
}
const capped = (list) => (list.length > UNDO_LIMIT ? list.slice(list.length - UNDO_LIMIT) : list);

/** True while a sheet is open: the board underneath takes no input. */
export const isPaused = (s) => s.sheet !== null;

/** True for the tools that draw new pieces on the board. */
export const isDrawTool = (tool) => tool === "shape" || tool === "line";

/** The store patch for "start from" a template: its backdrop and colours, and no pieces. */
export function templatePatch(backdrop) {
  const t = TEMPLATES[backdrop];
  if (!t) return null;
  return { backdrop, skyColor: t.skyColor, groundColor: t.groundColor, pieces: [] };
}

/**
 * @param {ReturnType<typeof initialSceneTools>} s
 * @param {{type: string, tool?: string, sheet?: string, id?: string, mode?: string, key?: string, ids?: string[], seq?: number, placeId?: string, before?: object}} e
 */
export function nextSceneTools(s, e) {
  switch (e.type) {
    case "tool": {
      if (!TOOLS.includes(e.tool)) return s;
      let sheet = null;
      if (e.tool === "sky" || e.tool === "ground") sheet = e.tool;
      else if (e.tool === "colour" && s.selected) sheet = "piece";
      if (e.tool === s.tool && sheet === s.sheet && !s.drag) return s;
      return { ...sealed(s), tool: e.tool, sheet, drag: null };
    }
    case "open-sheet": {
      if (s.drag) return s;
      const ok = e.sheet === "start" || (e.sheet === "draw" && isDrawTool(s.tool)) || (e.sheet === "piece" && s.selected !== null);
      return ok && s.sheet !== e.sheet ? { ...s, sheet: e.sheet } : s;
    }
    case "close-sheet":
      return s.sheet ? { ...sealed(s), sheet: null } : s;
    case "seal":
      return sealed(s);
    case "tap-piece": {
      if (!e.id || s.sheet || !["move", "colour", "delete"].includes(s.tool)) return s;
      const sheet = s.tool === "colour" ? "piece" : null;
      return s.selected === e.id && s.sheet === sheet ? s : { ...s, selected: e.id, sheet };
    }
    case "tap-empty":
      return s;
    case "deselect":
      return s.selected === null ? s : { ...s, selected: null, sheet: s.sheet === "piece" ? null : s.sheet, drag: null };
    case "drag-start": {
      if (s.tool !== "move" || s.sheet || s.drag || !e.id) return s;
      if (e.mode === "resize" && s.selected !== e.id) return s;
      if (e.mode !== "move" && e.mode !== "resize") return s;
      return { ...s, selected: e.id, drag: { mode: e.mode, id: e.id } };
    }
    case "drag-end":
    case "drag-cancel":
      return s.drag ? { ...s, drag: null } : s;
    case "drop":
      return s.drag ? { ...s, drag: null, lifted: s.drag.id } : s;
    case "lift-done":
      return s.lifted === null ? s : { ...s, lifted: null };
    case "draw-colour": {
      if (!isDrawTool(s.tool) || !e.key) return s;
      const kind = s.tool;
      return s.colors[kind] === e.key ? s : { ...s, colors: { ...s.colors, [kind]: e.key } };
    }
    case "pieces": {
      const ids = new Set(e.ids ?? []);
      const lost = s.selected !== null && !ids.has(s.selected);
      const dragLost = s.drag !== null && !ids.has(s.drag.id);
      if (!lost && !dragLost && s.lifted === null) return s;
      return {
        ...s,
        selected: lost ? null : s.selected,
        sheet: lost && s.sheet === "piece" ? null : s.sheet,
        drag: dragLost ? null : s.drag,
        lifted: null,
      };
    }
    case "edited": {
      if (!e.placeId || !e.before) return s;
      const seq = s.seq + 1;
      const top = undoTop(s);
      const run = e.merge && top?.merge === e.merge && top.placeId === e.placeId;
      const entry = run ? { ...top, seq } : { seq, placeId: e.placeId, before: e.before, merge: e.merge || undefined };
      if (e.seal || !entry.merge) delete entry.merge;
      return { ...s, seq, undo: capped([...(run ? s.undo.slice(0, -1) : s.undo), entry]) };
    }
    case "edit-failed": {
      const undo = withoutSeq(s.undo, e.seq);
      const undoing = withoutSeq(s.undoing, e.seq);
      return undo.length === s.undo.length && undoing.length === s.undoing.length ? s : { ...s, undo, undoing };
    }
    case "undo": {
      const top = undoTop(sealed(s)); // an entry that comes back after a failed Undo is a run no more
      return top ? { ...s, undo: s.undo.slice(0, -1), undoing: [...s.undoing, top] } : s;
    }
    case "undo-saved": {
      const undoing = withoutSeq(s.undoing, e.seq);
      return undoing.length === s.undoing.length ? s : { ...s, undoing };
    }
    case "undo-failed": {
      const entry = s.undoing.find((u) => u.seq === e.seq);
      if (!entry) return s;
      return { ...s, undoing: withoutSeq(s.undoing, e.seq), undo: capped([...s.undo, entry]) };
    }
    default:
      return s;
  }
}
