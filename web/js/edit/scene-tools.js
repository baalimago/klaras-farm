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
//
// Transitions (anything not listed leaves the state as it is, and returns the same object):
//   tool {tool}          → that tool, sheet closed (Sky and Ground open their sheet), drag dropped;
//                          the selection stays. Colour with a selection opens the piece sheet.
//   open-sheet {sheet}   → 'draw' in Shape/Line, 'piece' with a selection, 'start' always.
//   close-sheet          → no sheet.
//   tap-piece {id}       → selects it (Move, Colour, Delete). Colour opens the piece sheet.
//   tap-empty            → unchanged.
//   deselect             → no selection, piece sheet closed.
//   drag-start {mode,id} → Move tool only, no sheet; selects the piece. Resize needs it selected.
//   drag-end / drag-cancel → no drag.
//   draw-colour {key}    → the colour for the current drawing tool.
//   pieces {ids}         → the place's pieces changed: a selection or drag of a gone piece ends.

export const TOOLS = Object.freeze(["shape", "line", "move", "colour", "sky", "ground", "delete"]);

/** Colours each template starts with (same as a new scene in <kf-scenes>). */
export const TEMPLATES = Object.freeze({
  blank: Object.freeze({ skyColor: "cream", groundColor: "sand" }),
  meadow: Object.freeze({ skyColor: "sky", groundColor: "grass" }),
  sea: Object.freeze({ skyColor: "sky", groundColor: "water" }),
  room: Object.freeze({ skyColor: "wall", groundColor: "floor" }),
});

export function initialSceneTools({ tool = "shape", colors = { shape: "yellow", line: "brown" } } = {}) {
  return { tool, selected: null, sheet: null, drag: null, colors: { ...colors } };
}

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
 * @param {{type: string, tool?: string, sheet?: string, id?: string, mode?: string, key?: string, ids?: string[]}} e
 */
export function nextSceneTools(s, e) {
  switch (e.type) {
    case "tool": {
      if (!TOOLS.includes(e.tool)) return s;
      let sheet = null;
      if (e.tool === "sky" || e.tool === "ground") sheet = e.tool;
      else if (e.tool === "colour" && s.selected) sheet = "piece";
      if (e.tool === s.tool && sheet === s.sheet && !s.drag) return s;
      return { ...s, tool: e.tool, sheet, drag: null };
    }
    case "open-sheet": {
      if (s.drag) return s;
      const ok = e.sheet === "start" || (e.sheet === "draw" && isDrawTool(s.tool)) || (e.sheet === "piece" && s.selected !== null);
      return ok && s.sheet !== e.sheet ? { ...s, sheet: e.sheet } : s;
    }
    case "close-sheet":
      return s.sheet ? { ...s, sheet: null } : s;
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
    case "draw-colour": {
      if (!isDrawTool(s.tool) || !e.key) return s;
      const kind = s.tool;
      return s.colors[kind] === e.key ? s : { ...s, colors: { ...s.colors, [kind]: e.key } };
    }
    case "pieces": {
      const ids = new Set(e.ids ?? []);
      const lost = s.selected !== null && !ids.has(s.selected);
      const dragLost = s.drag !== null && !ids.has(s.drag.id);
      if (!lost && !dragLost) return s;
      return {
        ...s,
        selected: lost ? null : s.selected,
        sheet: lost && s.sheet === "piece" ? null : s.sheet,
        drag: dragLost ? null : s.drag,
      };
    }
    default:
      return s;
  }
}
