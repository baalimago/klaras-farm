// <kf-scene-tools>: change the scene (flow 3, US-2.2). Mounted by the Shell in session mode 'scene'.
// Tool rail: Shape, Yarn, Paint, Move, Delete, Undo; "Back to animals" → session.sceneDone().
//   Shape/Yarn: <kf-draw-pad mode="shape|yarn"> over the board; each `kf-stroke {points}` → store.addPiece.
//   Paint: tap a piece (or choose Sky / Ground, or tap the sky or ground), then a colour.
//   Move: drag a piece; one store write on release.
//   Delete: tap a piece, confirm.
//   Undo: a local stack of the place's previous {pieces, skyColor, groundColor}, applied with
//   store.updatePlace({patch}). Every change is undoable while the tools are open.
// Board geometry comes from services.board.boardRect() (client rect of the 4:3 board).
import { h, swatches, reportFailure } from "../kf-dialog/dom.js";
import { THING_COLORS, SKY_COLORS, GROUND_COLORS, hex } from "../../farm/palette.js";
import { pickPiece, moveStroke, pathData } from "./pieces.js";

const TOOLS = [
  { id: "shape", label: "Shape", icon: "⬟" },
  { id: "yarn", label: "Yarn", icon: "〰" },
  { id: "paint", label: "Paint", icon: "🖌" },
  { id: "move", label: "Move", icon: "✥" },
  { id: "delete", label: "Delete", icon: "✕" },
];
const HINTS = {
  shape: "Draw big shapes: a house, a tree, the sun.",
  yarn: "Draw lines: a fence, seaweed, a path.",
  paint: "Tap a piece, or choose Sky or Ground. Then pick a colour.",
  move: "Drag a piece to move it.",
  delete: "Tap a piece to delete it.",
};
/** Where the ground starts per backdrop (fraction of board height), for tapping sky vs ground. */
const GROUND_AT = { meadow: 0.6, sea: 0.55, room: 0.68, blank: 0.82 };
const UNDO_LIMIT = 50;
const TAP_SLOP = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

export class KfSceneToolsElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this.tool = "shape";
    this.colors = { shape: "yellow", yarn: "brown" };
    this._target = null; // {type:'piece', id} | {type:'sky'} | {type:'ground'}
    this._undo = [];
    this._chain = Promise.resolve();
    this._drag = null;
    this._hint = "";
    this._onChange = () => this.refresh();
    this._onResize = () => this.layout();
    this._onActivity = () => this.services?.session?.activity?.();
  }

  get store() { return this.services.store; }
  get place() { return this.store.currentPlace; }

  connectedCallback() {
    import("../kf-draw-pad/define.js").catch(() => {}); // package A; a test may have registered a stub
    this.services?.engine?.setMode?.("scene");
    this.store.addEventListener("change", this._onChange);
    window.addEventListener("resize", this._onResize);
    this.addEventListener("pointerdown", this._onActivity);
    this.build();
    this.layout();
    if (typeof ResizeObserver === "function" && this.services?.board instanceof Element) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.services.board);
    }
  }

  disconnectedCallback() {
    this.store?.removeEventListener("change", this._onChange);
    window.removeEventListener("resize", this._onResize);
    this.removeEventListener("pointerdown", this._onActivity);
    this._ro?.disconnect();
    const mode = this.services?.session?.state?.mode;
    if (this.services?.engine?.mode === "scene" && mode && mode !== "scene") this.services.engine.setMode?.(mode === "edit" ? "edit" : "play");
  }

  // ---------------------------------------------------------------- layout

  build() {
    this.rail = h("div", { class: "kf-st-rail", role: "toolbar", "aria-label": "Scene tools", "aria-orientation": "vertical" });
    this.panel = h("div", { class: "kf-st-panel" });
    this.hintEl = h("p", { class: "kf-st-hint", "aria-live": "polite" });
    this.stage = h("div", { class: "kf-st-stage" });
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "kf-st-svg");
    this.svg.setAttribute("viewBox", "0 0 1 1");
    this.svg.setAttribute("preserveAspectRatio", "none");
    this.svg.setAttribute("aria-hidden", "true");
    this.back = h("button", { type: "button", class: "kf-btn primary kf-st-back", text: "Back to animals", onclick: () => this.services.session?.sceneDone?.() });
    this.replaceChildren(this.stage, h("div", { class: "kf-st-side" }, [this.rail, this.hintEl, this.panel]), this.back);
    this.setTool(this.tool);
  }

  /** Puts the stage exactly over the board. */
  layout() {
    const r = this.boardRect();
    const host = this.getBoundingClientRect();
    Object.assign(this.stage.style, { left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  boardRect() {
    const b = this.services?.board;
    const r = b?.boardRect?.() ?? b?.getBoundingClientRect?.();
    if (r && r.width > 0) return r;
    // No board: a 4:3 letterbox in the viewport.
    const vw = innerWidth;
    const vh = innerHeight;
    const w = Math.min(vw, (vh * 4) / 3);
    const hh = (w * 3) / 4;
    return { left: (vw - w) / 2, top: (vh - hh) / 2, width: w, height: hh };
  }

  toBoard(clientX, clientY) {
    const r = this.boardRect();
    return [(clientX - r.left) / r.width, (clientY - r.top) / r.height];
  }

  // ---------------------------------------------------------------- tools

  setTool(id) {
    this.tool = id;
    this._target = null;
    this._drag = null;
    this._hint = HINTS[id];
    this.stage.replaceChildren();
    if (id === "shape" || id === "yarn") {
      const pad = document.createElement("kf-draw-pad");
      pad.setAttribute("mode", id);
      pad.setAttribute("color", this.colors[id]);
      pad.services = this.services;
      pad.color = this.colors[id];
      pad.addEventListener("kf-stroke", (e) => this.addPiece(id, e.detail?.points));
      pad.addEventListener("kf-stroke-open", () => this.say("Close the shape: finish where you started."));
      this.pad = pad;
      this.stage.append(pad);
    } else {
      this.pad = null;
      const overlay = h("div", { class: "kf-st-overlay" });
      overlay.addEventListener("pointerdown", (e) => this.onDown(e));
      overlay.addEventListener("pointermove", (e) => this.onMove(e));
      overlay.addEventListener("pointerup", (e) => this.onUp(e));
      overlay.addEventListener("pointercancel", () => this.cancelDrag());
      overlay.addEventListener("contextmenu", (e) => e.preventDefault());
      this.stage.append(overlay, this.svg);
    }
    this.refresh();
  }

  say(text) {
    this._hint = text;
    this.hintEl.textContent = text;
  }

  /** Re-renders rail, panel and highlight from state (cheap; parent UI only). */
  refresh() {
    const place = this.place;
    if (this._target?.type === "piece" && !place?.pieces.some((p) => p.id === this._target.id)) this._target = null;

    this.rail.replaceChildren(
      ...TOOLS.map((t) =>
        h("button", { type: "button", class: "kf-st-tool", "aria-pressed": String(this.tool === t.id), "data-tool": t.id, onclick: () => this.setTool(t.id) }, [
          h("span", { class: "kf-st-icon", "aria-hidden": "true", text: t.icon }),
          h("span", { text: t.label }),
        ]),
      ),
      h("button", { type: "button", class: "kf-st-tool", disabled: this._undo.length === 0, "data-tool": "undo", onclick: () => this.undo() }, [
        h("span", { class: "kf-st-icon", "aria-hidden": "true", text: "↶" }),
        h("span", { text: "Undo" }),
      ]),
    );
    this.hintEl.textContent = place ? this._hint : "There is no scene to change.";
    this.panel.replaceChildren(...this.panelContent(place));
    this.drawHighlight();
  }

  panelContent(place) {
    if (!place) return [];
    if (this.tool === "shape" || this.tool === "yarn") {
      const kind = this.tool;
      return [
        swatches("Colour", THING_COLORS, this.colors[kind], (key) => {
          this.colors[kind] = key;
          this.pad?.setAttribute("color", key);
          if (this.pad) this.pad.color = key;
          this.refresh();
        }),
      ];
    }
    if (this.tool !== "paint") return [];
    const t = this._target;
    const targets = h("div", { class: "kf-row", role: "group", "aria-label": "Background" }, [
      h("button", { type: "button", class: "kf-btn", "aria-pressed": String(t?.type === "sky"), text: "Sky", onclick: () => this.select({ type: "sky" }) }),
      h("button", { type: "button", class: "kf-btn", "aria-pressed": String(t?.type === "ground"), text: "Ground", onclick: () => this.select({ type: "ground" }) }),
    ]);
    if (!t) return [targets];
    let keys = THING_COLORS;
    let current = null;
    if (t.type === "sky") (keys = SKY_COLORS), (current = place.skyColor);
    else if (t.type === "ground") (keys = GROUND_COLORS), (current = place.groundColor);
    else current = place.pieces.find((p) => p.id === t.id)?.color;
    return [targets, swatches("Colour", keys, current, (key) => this.paint(key))];
  }

  select(target) {
    this._target = target;
    this.refresh();
  }

  drawHighlight() {
    const svg = this.svg;
    svg.replaceChildren();
    const place = this.place;
    if (!place) return;
    const piece = this._target?.type === "piece" ? place.pieces.find((p) => p.id === this._target.id) : null;
    if (piece) svg.append(this.outlinePath(piece.stroke, piece.kind === "shape", "kf-st-selected"));
    if (this._drag?.moved) {
      const p = this._drag.piece;
      const moved = moveStroke(p.stroke, this._drag.dx, this._drag.dy);
      const ghost = this.outlinePath(moved, p.kind === "shape", "kf-st-ghost");
      if (p.kind === "shape") ghost.setAttribute("fill", hex(p.color));
      else ghost.setAttribute("stroke", hex(p.color));
      svg.append(ghost);
    }
  }

  outlinePath(stroke, closed, cls) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData(stroke, closed));
    path.setAttribute("class", cls);
    path.setAttribute("vector-effect", "non-scaling-stroke");
    return path;
  }

  // ---------------------------------------------------------------- pointer (Paint, Move, Delete)

  onDown(e) {
    if (!e.isPrimary || !this.place) return;
    e.preventDefault();
    const pt = this.toBoard(e.clientX, e.clientY);
    const r = this.boardRect();
    const piece = pickPiece(this.place.pieces, pt, r);
    this._down = { x: e.clientX, y: e.clientY, id: e.pointerId, piece };
    if (this.tool === "move" && piece) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      this._drag = { piece, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
      this._target = { type: "piece", id: piece.id };
      this.drawHighlight();
    }
  }

  onMove(e) {
    const d = this._drag;
    if (!d || e.pointerId !== this._down?.id) return;
    const r = this.boardRect();
    d.dx = (e.clientX - d.x) / r.width;
    d.dy = (e.clientY - d.y) / r.height;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
    if (d.moved) this.drawHighlight();
  }

  onUp(e) {
    const down = this._down;
    this._down = null;
    if (!down || e.pointerId !== down.id) return;
    const d = this._drag;
    this._drag = null;
    if (d) {
      if (d.moved) {
        const stroke = moveStroke(d.piece.stroke, d.dx, d.dy);
        this.commit((place) => this.store.updatePiece({ placeId: place.id, pieceId: d.piece.id, patch: { stroke } }));
      } else this.drawHighlight();
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) return;
    this.tap(down.piece, this.toBoard(e.clientX, e.clientY));
  }

  cancelDrag() {
    this._down = null;
    this._drag = null;
    this.drawHighlight();
  }

  tap(piece, [, y]) {
    if (this.tool === "paint") {
      if (piece) this.select({ type: "piece", id: piece.id });
      else this.select({ type: y < (GROUND_AT[this.place.backdrop] ?? 0.6) ? "sky" : "ground" });
    } else if (this.tool === "delete" && piece) {
      this.select({ type: "piece", id: piece.id });
      this.confirmDelete(piece);
    }
  }

  // ---------------------------------------------------------------- changes

  addPiece(kind, points) {
    if (!Array.isArray(points) || points.length < (kind === "shape" ? 3 : 2)) return;
    const color = this.colors[kind];
    this.commit((place) => this.store.addPiece({ placeId: place.id, piece: { kind, stroke: points, color } }));
  }

  paint(key) {
    const t = this._target;
    if (!t) return;
    this.commit((place) => {
      if (t.type === "sky") return this.store.updatePlace({ placeId: place.id, patch: { skyColor: key } });
      if (t.type === "ground") return this.store.updatePlace({ placeId: place.id, patch: { groundColor: key } });
      return this.store.updatePiece({ placeId: place.id, pieceId: t.id, patch: { color: key } });
    });
  }

  async confirmDelete(piece) {
    const ok = await this.services.shell.confirm({
      title: piece.kind === "yarn" ? "Delete this line?" : "Delete this piece?",
      body: "You can undo this while the scene tools are open.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!ok) return this.select(null);
    this.commit((place) => this.store.removePiece({ placeId: place.id, pieceId: piece.id }));
    this.services.audio?.chime?.("poof");
  }

  /** Runs one change after the previous one, remembering the place as it was for Undo. */
  commit(change) {
    this._chain = this._chain.then(async () => {
      const place = this.place;
      if (!place) return;
      const before = { pieces: structuredClone(place.pieces), skyColor: place.skyColor, groundColor: place.groundColor };
      try {
        await change(place);
        this._undo.push(before);
        if (this._undo.length > UNDO_LIMIT) this._undo.shift();
      } catch (e) {
        reportFailure(this.services, e);
      }
      this.refresh();
    });
    return this._chain;
  }

  undo() {
    this._chain = this._chain.then(async () => {
      const place = this.place;
      const prev = this._undo.pop();
      if (!place || !prev) return;
      try {
        await this.store.updatePlace({ placeId: place.id, patch: prev });
      } catch (e) {
        this._undo.push(prev);
        reportFailure(this.services, e);
      }
      this.refresh();
    });
    return this._chain;
  }
}
