// <kf-scene-tools>: draw and arrange the scene (flow 3, US-2.2). Mounted by the Shell in session mode 'scene'.
// The landscape is the place's sky and ground colours, its backdrop template, and felt pieces
// (shapes and yarn lines) the parent draws anywhere, then moves, resizes, recolours, sends to the
// back or deletes. No data format change: it all lives in Place {backdrop, skyColor, groundColor, pieces}.
//
// UI state is the pure state machine in edit/scene-tools.js; this element keeps one state, sends it
// events and renders from it (and from the store) after every event. Tool bar: Shape, Line, Move,
// Colour, Sky, Ground, Delete, Start, Undo, and Done (→ session.sceneDone()).
//
// Foreground rule: the tool bar, panel and colour sheet sit above the drawing canvas (z-index over
// kf-draw-pad's overlay), and while a sheet is open the stage underneath is inert: no stroke can
// start behind the picker.
//
// No lag: a piece being dragged or resized is drawn by the board's renderer from its cached sprite
// (services.board.setLift), with the board rect read once per drag. Nothing is written to the store
// until the finger lifts; the lift stays (state.lifted) until the store's change arrives, so the
// piece never jumps. Every edit action plays one editing sound (kf-dialog/feedback.js).
//
// Edits show at once: each store intent is called synchronously in the tap (FarmStore applies it and
// emits 'change' before returning; it queues the write itself), the undo entry is pushed and the
// screen rendered in the same task. The intent's promise is only watched for a failed write, which
// drops that undo entry and says so (the store has already rolled back and emitted 'reverted').
// Undo: the entries in state.undo, each the place's previous {pieces, skyColor, groundColor, backdrop}.
// Pointer handlers run each step guarded, so one failure never eats the tap (AGENTS rule 5).
import { h, swatches, reportFailure, colorName } from "../kf-dialog/dom.js";
import { editSound } from "../kf-dialog/feedback.js";
import { THING_COLORS, SKY_COLORS, GROUND_COLORS, hex } from "../../farm/palette.js";
import { initialSceneTools, nextSceneTools, isPaused, isDrawTool, templatePatch, placeBefore, undoTop, canUndo, TEMPLATES } from "../../edit/scene-tools.js";
import { clampDelta } from "../../geometry/transform.js";
import { pickPiece, moveStroke, pathData, strokeBox, resizeScale, scaleStroke, sendToBack } from "./pieces.js";

const RAIL = [
  { id: "shape", label: "Shape", icon: "⬟" },
  { id: "line", label: "Line", icon: "〰" },
  { id: "move", label: "Move", icon: "✥" },
  { id: "colour", label: "Colour", icon: "🎨" },
  { id: "sky", label: "Sky", icon: "☁" },
  { id: "ground", label: "Ground", icon: "⛰" },
  { id: "delete", label: "Delete", icon: "✕" },
];
const TEMPLATE_LABELS = { blank: "Blank", meadow: "Meadow", sea: "Sea", room: "Room" };
const TAP_SLOP = 10;
const MOVE_SLOP = 3;
const SVG_NS = "http://www.w3.org/2000/svg";

export class KfSceneToolsElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this.state = initialSceneTools();
    this._live = null; // the pointer gesture in progress on the stage (positions only; the mode is in state.drag)
    this._lifting = false; // the board was last given a lift (device mirror, so render clears it once)
    this._note = ""; // a one-off hint ("Close the shape…") until the next event
    this._stageTool = null;
    this._raf = 0;
    this._onChange = () => this._storeChanged();
    this._onResize = () => this.layout();
    this._onActivity = () => this.services?.session?.activity?.();
  }

  get store() { return this.services.store; }
  get place() { return this.store.currentPlace; }

  connectedCallback() {
    import("../kf-draw-pad/define.js").catch(() => {}); // a test may have registered a stub
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
    cancelAnimationFrame(this._raf);
    this._setLift(null);
    const mode = this.services?.session?.state?.mode;
    if (this.services?.engine?.mode === "scene" && mode && mode !== "scene") this.services.engine.setMode?.(mode === "edit" ? "edit" : "play");
  }

  // ---------------------------------------------------------------- state

  /** Sends one event to the state machine and renders from the result. */
  send(event) {
    const next = nextSceneTools(this.state, event);
    if (next === this.state) return false;
    const before = this.state;
    this.state = next;
    if (before.tool !== next.tool) this._note = "";
    this.render();
    return true;
  }

  _storeChanged() {
    const ids = (this.place?.pieces ?? []).map((p) => p.id);
    if (!this.send({ type: "pieces", ids })) this.render();
  }

  // ---------------------------------------------------------------- layout

  build() {
    this.rail = h("div", { class: "kf-st-rail", role: "toolbar", "aria-label": "Scene tools", "aria-orientation": "vertical" });
    this.panel = h("div", { class: "kf-st-panel" });
    this.hintEl = h("p", { class: "kf-st-hint", "aria-live": "polite" });
    this.stage = h("div", { class: "kf-st-stage" });
    this.input = h("div", { class: "kf-st-input" });
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "kf-st-svg");
    this.svg.setAttribute("viewBox", "0 0 1 1");
    this.svg.setAttribute("preserveAspectRatio", "none");
    this.svg.setAttribute("aria-hidden", "true");
    this.group = document.createElementNS(SVG_NS, "g");
    this.svg.append(this.group);
    this.handle = h("button", { type: "button", class: "kf-st-handle", "aria-label": "Resize: drag to make it bigger or smaller", text: "⤡" });
    this._listen(this.handle, (e) => this.onHandleDown(e));
    this.stage.append(this.input, this.svg, this.handle);
    this.sheet = h("div", { class: "kf-st-sheet", role: "dialog", "aria-modal": "false" });
    this.done = h("button", {
      type: "button", class: "kf-btn primary kf-st-done", text: "Done",
      onclick: () => {
        editSound(this.services, "save");
        this.services.session?.sceneDone?.();
      },
    });
    this.replaceChildren(this.stage, h("div", { class: "kf-st-side" }, [this.rail, this.hintEl, this.panel]), this.sheet, this.done);
    this.render();
  }

  /** Puts the stage exactly over the board. */
  layout() {
    const r = this.boardRect();
    const host = this.getBoundingClientRect();
    Object.assign(this.stage.style, { left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    this.renderSelection();
  }

  boardRect() {
    let r = null;
    try {
      const b = this.services?.board;
      r = b?.boardRect?.() ?? b?.getBoundingClientRect?.();
    } catch (e) {
      console.warn("scene tools: board rect", e);
    }
    if (r && r.width > 0) return r;
    // No board: a 4:3 letterbox in the viewport.
    const vw = innerWidth;
    const vh = innerHeight;
    const w = Math.min(vw, (vh * 4) / 3);
    const hh = (w * 3) / 4;
    return { left: (vw - w) / 2, top: (vh - hh) / 2, width: w, height: hh };
  }

  // ---------------------------------------------------------------- render (from state + store)

  render() {
    if (!this.rail) return;
    const s = this.state;
    const place = this.place;
    this.renderRail(s);
    this.renderStage(s);
    this.hintEl.textContent = place ? this._note || this.hint(s) : "There is no scene to change.";
    this.panel.replaceChildren(...(place ? this.panelContent(s, place) : []));
    this.renderSheet(s, place);
    this.renderSelection();
    if (this._lifting && !s.drag && !s.lifted) this._setLift(null); // the renderer has the piece itself now
  }

  renderRail(s) {
    const tool = (t) =>
      h("button", { type: "button", class: "kf-st-tool", "aria-pressed": String(s.tool === t.id), "data-tool": t.id, onclick: () => this.pickTool(t.id) }, [
        h("span", { class: "kf-st-icon", "aria-hidden": "true", text: t.icon }),
        h("span", { text: t.label }),
      ]);
    this.rail.replaceChildren(
      ...RAIL.map(tool),
      h("button", { type: "button", class: "kf-st-tool kf-st-extra", "aria-pressed": String(s.sheet === "start"), "data-tool": "start", onclick: () => this.openSheet("start") }, [
        h("span", { class: "kf-st-icon", "aria-hidden": "true", text: "✦" }),
        h("span", { text: "Start" }),
      ]),
      h("button", { type: "button", class: "kf-st-tool kf-st-extra", disabled: !canUndo(s), "data-tool": "undo", onclick: () => this.undo() }, [
        h("span", { class: "kf-st-icon", "aria-hidden": "true", text: "↶" }),
        h("span", { text: "Undo" }),
      ]),
    );
  }

  /** The input layer for the tool: a draw pad for Shape/Line, else a pointer overlay. Inert while a sheet is open. */
  renderStage(s) {
    const kind = isDrawTool(s.tool) ? "draw" : "overlay";
    const key = kind === "draw" ? s.tool : "overlay";
    if (this._stageTool !== key) {
      this._stageTool = key;
      this.pad = null;
      if (kind === "draw") {
        const pad = document.createElement("kf-draw-pad");
        pad.setAttribute("mode", s.tool === "line" ? "yarn" : "shape");
        pad.services = this.services;
        pad.addEventListener("kf-stroke", (e) => this.addPiece(s.tool === "line" ? "yarn" : "shape", e.detail?.points));
        pad.addEventListener("kf-stroke-open", () => this.say("Close the shape: finish where you started."));
        this.pad = pad;
        this.input.replaceChildren(pad);
      } else {
        const overlay = h("div", { class: "kf-st-overlay" });
        this._listen(overlay, (e) => this.onDown(e));
        overlay.addEventListener("contextmenu", (e) => e.preventDefault());
        this.input.replaceChildren(overlay);
      }
    }
    if (this.pad) {
      const color = s.colors[s.tool];
      if (this.pad.getAttribute("color") !== color) this.pad.setAttribute("color", color);
    }
    const paused = isPaused(s);
    this.stage.inert = paused;
    this.stage.classList.toggle("paused", paused);
    if (this.pad) {
      this.pad.style.pointerEvents = paused ? "none" : ""; // the pad is fixed-position: inert alone is not enough everywhere
      if (paused) this.pad.clear?.();
    }
    this.dataset.tool = s.tool;
  }

  hint(s) {
    switch (s.tool) {
      case "shape": return "Draw a shape anywhere: a hill, the sun, a pond, a tree.";
      case "line": return "Draw a line: a fence, a path, grass, waves.";
      case "move": return s.selected ? "Drag it to move it. Pull the round handle to resize." : "Tap a piece, then drag it.";
      case "colour": return s.selected ? "Pick a colour for it." : "Tap a piece to colour it.";
      case "sky": return "Pick a sky colour.";
      case "ground": return "Pick a ground colour.";
      default: return "Tap a piece to delete it.";
    }
  }

  panelContent(s, place) {
    const btn = (text, onclick, extra = {}) => h("button", { type: "button", class: "kf-btn", text, onclick, ...extra });
    if (isDrawTool(s.tool)) {
      const key = s.colors[s.tool];
      return [
        h("button", { type: "button", class: "kf-btn kf-st-colour", "aria-label": `Felt colour: ${colorName(key)}. Change`, onclick: () => this.openSheet("draw") }, [
          h("span", { class: "kf-st-chip", "data-color": key, "aria-hidden": "true", style: `background:${hex(key)}` }),
          h("span", { text: colorName(key) }),
        ]),
      ];
    }
    if (s.tool === "sky" || s.tool === "ground") {
      return [btn(s.tool === "sky" ? "Sky colours" : "Ground colours", () => this.openSheet(s.tool))];
    }
    const piece = s.selected ? place.pieces.find((p) => p.id === s.selected) : null;
    if (!piece || s.tool === "delete") return [];
    return [
      h("p", { class: "kf-st-label", text: piece.kind === "yarn" ? "This line:" : "This piece:" }),
      h("div", { class: "kf-row kf-st-actions" }, [
        btn("Change colour", () => this.openSheet("piece")),
        btn("To back", () => this.toBack(piece.id), { disabled: place.pieces[0]?.id === piece.id }),
        btn("Delete", () => this.confirmDelete(piece)),
        btn("Let go", () => this.deselect()),
      ]),
    ];
  }

  renderSheet(s, place) {
    this.sheet.hidden = !s.sheet || !place;
    if (this.sheet.hidden) return void this.sheet.replaceChildren();
    const close = h("button", { type: "button", class: "kf-btn", text: "Close", onclick: () => this.closeSheet() });
    let title = "";
    let body = [];
    if (s.sheet === "start") {
      title = "Start from";
      body = [h("div", { class: "kf-row kf-st-templates", role: "group", "aria-label": "Start from" },
        Object.keys(TEMPLATES).map((k) => h("button", {
          type: "button", class: "kf-btn kf-st-template", text: TEMPLATE_LABELS[k], "aria-pressed": String(place.backdrop === k),
          onclick: () => this.startFrom(k),
        })))];
    } else {
      let keys = THING_COLORS;
      let current = null;
      if (s.sheet === "sky") (title = "Sky colour"), (keys = SKY_COLORS), (current = place.skyColor);
      else if (s.sheet === "ground") (title = "Ground colour"), (keys = GROUND_COLORS), (current = place.groundColor);
      else if (s.sheet === "draw") (title = s.tool === "line" ? "Line colour" : "Shape colour"), (current = s.colors[s.tool]);
      else (title = "Piece colour"), (current = place.pieces.find((p) => p.id === s.selected)?.color ?? null);
      body = [swatches("Colour", keys, current, (key) => this.pickColour(key))];
    }
    this.sheet.setAttribute("aria-label", title);
    this.sheet.replaceChildren(h("div", { class: "kf-st-sheet-head" }, [h("h2", { text: title }), close]), ...body);
  }

  /** Dashed outline of the selected piece, and the resize handle in Move. Moved with a transform while dragging. */
  renderSelection() {
    if (!this.group) return;
    this.group.replaceChildren();
    this.group.removeAttribute("transform");
    this.handle.style.transform = "";
    const place = this.place;
    const s = this.state;
    const piece = s.selected && place ? place.pieces.find((p) => p.id === s.selected) : null;
    this.handle.hidden = !piece || s.tool !== "move";
    if (!piece) return;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData(piece.stroke, piece.kind === "shape"));
    path.setAttribute("class", "kf-st-selected");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    this.group.append(path);
    if (!this.handle.hidden) {
      const { box } = strokeBox(piece.stroke);
      this.handle.style.left = `${(box.x + box.w) * 100}%`;
      this.handle.style.top = `${(box.y + box.h) * 100}%`;
    }
  }

  // ---------------------------------------------------------------- tool bar and sheet

  pickTool(id) {
    if (this.send({ type: "tool", tool: id })) editSound(this.services, "tool");
  }

  openSheet(sheet) {
    if (this.send({ type: "open-sheet", sheet })) editSound(this.services, "tool");
  }

  closeSheet() {
    if (this.send({ type: "close-sheet" })) editSound(this.services, "back");
  }

  deselect() {
    if (this.send({ type: "deselect" })) editSound(this.services, "back");
  }

  say(text) {
    this._note = text;
    this.hintEl.textContent = text;
  }

  // ---------------------------------------------------------------- pointer (Move, Colour, Delete)

  /** Pointer listeners on a stage target, each guarded so a thrown step never eats the tap. */
  _listen(el, onDown) {
    el.addEventListener("pointerdown", (e) => this._guard(() => onDown(e)));
    el.addEventListener("pointermove", (e) => this._guard(() => this.onMove(e)));
    el.addEventListener("pointerup", (e) => this._guard(() => this.onUp(e)));
    el.addEventListener("pointercancel", () => this._guard(() => this.cancelDrag()));
  }

  _guard(fn) {
    try {
      fn();
    } catch (err) {
      console.warn("scene tools:", err);
    }
  }

  /** Keeps the finger's events on this target; a failure only loses the capture, not the drag. */
  _capture(e) {
    this._guard(() => e.currentTarget?.setPointerCapture?.(e.pointerId));
  }

  onDown(e) {
    if (!e.isPrimary || !this.place || isPaused(this.state)) return;
    e.preventDefault();
    const rect = this.boardRect(); // once per gesture: no layout reads while the finger moves
    const pt = [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
    const piece = pickPiece(this.place.pieces, pt, rect);
    this._live = { id: e.pointerId, x: e.clientX, y: e.clientY, rect, piece, dx: 0, dy: 0, s: 1, moved: false };
    if (this.state.tool !== "move" || !piece) return;
    const wasSelected = this.state.selected === piece.id;
    if (!this.send({ type: "drag-start", mode: "move", id: piece.id })) return;
    this._capture(e);
    this._live.box = strokeBox(piece.stroke).box;
    editSound(this.services, wasSelected ? "pick" : "select");
  }

  onHandleDown(e) {
    const s = this.state;
    const piece = s.selected ? this.place?.pieces.find((p) => p.id === s.selected) : null;
    if (!e.isPrimary || !piece) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.send({ type: "drag-start", mode: "resize", id: piece.id })) return;
    this._capture(e);
    const rect = this.boardRect();
    const { cx, cy } = strokeBox(piece.stroke);
    this._live = {
      id: e.pointerId, x: e.clientX, y: e.clientY, rect, piece, dx: 0, dy: 0, s: 1, moved: false,
      centre: [rect.left + cx * rect.width, rect.top + cy * rect.height], cx, cy,
    };
    editSound(this.services, "pick");
  }

  onMove(e) {
    const live = this._live;
    const drag = this.state.drag;
    if (!live || !drag || e.pointerId !== live.id) return;
    if (!live.moved && Math.hypot(e.clientX - live.x, e.clientY - live.y) > MOVE_SLOP) live.moved = true;
    if (!live.moved) return;
    if (drag.mode === "resize") {
      live.s = resizeScale(live.piece.stroke, [live.x, live.y], [e.clientX, e.clientY], live.centre);
      this._setLift({ id: live.piece.id, s: live.s, cx: live.cx, cy: live.cy });
    } else {
      const [dx, dy] = clampDelta(live.box, (e.clientX - live.x) / live.rect.width, (e.clientY - live.y) / live.rect.height);
      live.dx = dx;
      live.dy = dy;
      this._setLift({ id: live.piece.id, dx, dy });
    }
    this._scheduleOutline();
  }

  onUp(e) {
    const live = this._live;
    this._live = null;
    if (!live || e.pointerId !== live.id) return;
    const drag = this.state.drag;
    if (drag) {
      if (!live.moved) return void this.send({ type: "drag-end" });
      this._guard(() => this.onMove({ pointerId: live.id, clientX: e.clientX, clientY: e.clientY })); // the last position counts
      this.dropPiece(drag.mode, live);
      return;
    }
    if (Math.hypot(e.clientX - live.x, e.clientY - live.y) > TAP_SLOP) return;
    this.tap(live.piece);
  }

  cancelDrag() {
    this._live = null;
    if (!this.send({ type: "drag-cancel" })) this.render();
  }

  tap(piece) {
    if (!piece) return void this.send({ type: "tap-empty" }); // tap-away keeps the selection
    const changed = this.send({ type: "tap-piece", id: piece.id });
    if (this.state.tool === "delete") return void this.confirmDelete(piece);
    if (changed) editSound(this.services, "select");
  }

  /** The outline follows the lifted piece once per frame, with a transform (no path rebuild). */
  _scheduleOutline() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const live = this._live;
      if (!live || !this.state.drag) return;
      const r = live.rect;
      if (this.state.drag.mode === "resize") {
        const t = `translate(${live.cx} ${live.cy}) scale(${live.s}) translate(${-live.cx} ${-live.cy})`;
        this.group.setAttribute("transform", t);
        const { box } = strokeBox(live.piece.stroke);
        const hx = (live.cx + (box.x + box.w - live.cx) * live.s - (box.x + box.w)) * r.width;
        const hy = (live.cy + (box.y + box.h - live.cy) * live.s - (box.y + box.h)) * r.height;
        this.handle.style.transform = `translate(${hx}px, ${hy}px)`;
      } else {
        this.group.setAttribute("transform", `translate(${live.dx} ${live.dy})`);
        this.handle.style.transform = `translate(${live.dx * r.width}px, ${live.dy * r.height}px)`;
      }
    });
  }

  _setLift(lift) {
    this._lifting = lift !== null;
    try {
      this.services?.board?.setLift?.(lift);
    } catch (e) {
      console.error(e);
    }
  }

  // ---------------------------------------------------------------- changes

  dropPiece(mode, live) {
    const piece = live.piece;
    const stroke = mode === "resize" ? scaleStroke(piece.stroke, live.s) : moveStroke(piece.stroke, live.dx, live.dy);
    editSound(this.services, "drop");
    this.send({ type: "drop" }); // shown lifted where it was put until the store's change arrives
    const applied = this.edit((place) => this.store.updatePiece({ placeId: place.id, pieceId: piece.id, patch: { stroke } }));
    if (!applied) this.send({ type: "lift-done" });
  }

  addPiece(kind, points) {
    if (!Array.isArray(points) || points.length < (kind === "shape" ? 3 : 2)) return;
    const color = this.state.colors[kind === "yarn" ? "line" : "shape"];
    editSound(this.services, "add");
    this.edit((place) => this.store.addPiece({ placeId: place.id, piece: { kind, stroke: points, color } }));
  }

  pickColour(key) {
    const s = this.state;
    editSound(this.services, "colour");
    if (s.sheet === "draw") {
      this.send({ type: "draw-colour", key });
      this.send({ type: "close-sheet" }); // picked: back to drawing
      return;
    }
    this.edit((place) => {
      if (s.sheet === "sky") return this.store.updatePlace({ placeId: place.id, patch: { skyColor: key } });
      if (s.sheet === "ground") return this.store.updatePlace({ placeId: place.id, patch: { groundColor: key } });
      return this.store.updatePiece({ placeId: place.id, pieceId: s.selected, patch: { color: key } });
    });
  }

  toBack(pieceId) {
    editSound(this.services, "drop");
    this.edit((place) => {
      const pieces = sendToBack(place.pieces, pieceId);
      return pieces === place.pieces ? null : this.store.updatePlace({ placeId: place.id, patch: { pieces } });
    });
  }

  async startFrom(backdrop) {
    const patch = templatePatch(backdrop);
    if (!patch || !this.place) return;
    if (this.place.pieces.length > 0) {
      const ok = await this.services.shell.confirm({
        title: `Start from ${TEMPLATE_LABELS[backdrop]}?`,
        body: "This clears the pieces you drew. You can undo this while the scene tools are open.",
        confirmLabel: "Start over",
        cancelLabel: "Keep my scene",
      });
      if (!ok) return;
    }
    editSound(this.services, "save");
    this.send({ type: "close-sheet" });
    this.edit((place) => this.store.updatePlace({ placeId: place.id, patch }));
  }

  async confirmDelete(piece) {
    const ok = await this.services.shell.confirm({
      title: piece.kind === "yarn" ? "Delete this line?" : "Delete this piece?",
      body: "You can undo this while the scene tools are open.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!ok) return;
    editSound(this.services, "poof");
    this.edit((place) => this.store.removePiece({ placeId: place.id, pieceId: piece.id }));
  }

  /**
   * Applies one edit now: `change(place)` calls a store intent, which updates the snapshot and emits
   * 'change' synchronously and returns the write's promise (or null when there is nothing to change).
   * The undo entry is pushed in the same task; a failed write drops it again. True when applied.
   */
  edit(change) {
    const place = this.place;
    if (!place) return false;
    const before = placeBefore(place);
    let saving;
    try {
      saving = change(place);
    } catch (e) {
      this._failed(e);
      return false;
    }
    if (!saving) return false; // nothing to change
    this.send({ type: "edited", placeId: place.id, before });
    const seq = this.state.seq;
    Promise.resolve(saving).catch((e) => {
      this.send({ type: "edit-failed", seq });
      this.send({ type: "lift-done" });
      this._failed(e);
    });
    return true;
  }

  /** Takes back the newest edit at once; if its write fails, the edit (and its entry) come back. */
  undo() {
    const entry = undoTop(this.state);
    if (!entry) return false;
    editSound(this.services, "undo");
    this.send({ type: "undo" });
    const seq = entry.seq;
    let saving;
    try {
      saving = this.store.updatePlace({ placeId: entry.placeId, patch: entry.before });
    } catch (e) {
      saving = Promise.reject(e);
    }
    Promise.resolve(saving).then(
      () => this.send({ type: "undo-saved", seq }),
      (e) => {
        this.send({ type: "undo-failed", seq });
        this._failed(e);
      },
    );
    return true;
  }

  _failed(e) {
    reportFailure(this.services, e);
    this.render();
  }
}
