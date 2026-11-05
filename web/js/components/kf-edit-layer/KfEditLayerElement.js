// <kf-edit-layer>: edit mode on the scene (US-11.3, US-3.5, US-3.6, US-2.5, US-7.6).
// The bar (Scenes, Change scene, + Add, Settings, Done) and still, 44 pt+ badges per thing.
// "+ Add" (and "Add an animal" on an empty scene) opens the animal library (panel `library`, QA
// round 3) and shows how many things the scene has against its limit ("5/8"); a full scene keeps
// it on, with the reason under the bar, and the library says the same with the way out. Badges:
// pencil → the thing card; cross → confirm (naming the recordings) → delete → Undo toast.
// Badges are placed once from services.board.actorRect(id) and re-placed on store changes and resize,
// never per frame. Hidden while a panel is open over edit mode, and while a thing is dragged.
// Selection and resize are the pure machine in edit/selection.js (`this._sel`); every event goes
// through `_dispatch`, and the ring, its handle and the badges are rendered from the state after it.
// Selection: the thing last tapped, dragged or edited with its pencil is selected (a dashed felt
// ring). Tapping empty board never drops it; only selecting another thing, deleting it or leaving
// edit mode does. Like a piece in the scene tools: a tap on a thing selects it, a tap on the selected
// thing opens its card (so does its pencil).
// Resize: the ring has a round handle at its bottom-right corner. Dragging it calls the board's
// resizeStart / resizeTo / resizeEnd (the thing grows or shrinks about its feet, live, one store write
// on release; a pointercancel, a lost capture, deleting the thing or leaving edit mode puts the old
// size back). Meanwhile the ring and badges hide (`.resizing`), and only the handle moves, with a
// transform from the state, to the scaled corner: the DOM under the finger is not rebuilt (it holds
// the pointer capture), so badges are placed again only once the resize has ended.
import { editSound } from "../kf-dialog/feedback.js";
import { isPalm } from "../../edit/hold.js";
import { initialSelection, nextSelection, selectedId, isResizing, ownsPointer, tapAction, handleOffset, resizeOutcome } from "../../edit/selection.js";

const BADGE = 52; // px, ≥ 44 pt target
const RING_PAD = 10; // px between a thing and its ring
const EDGE = BADGE / 2 + 4;
const BADGE_SPREAD_MAX = 70; // px from the top centre to each badge's centre
const SETTLE_MS = 400; // > GLIDE_S (0.3 s)

export class KfEditLayerElement extends HTMLElement {
  constructor() {
    super();
    this._sel = initialSelection();
  }

  /** The selected thing's id, or null (from the selection state). */
  get selected() { return selectedId(this._sel); }

  /** The selection state (edit/selection.js), read-only. */
  get selection() { return this._sel; }

  connectedCallback() {
    const s = this.services ?? {};
    // Guard against a stale mount (the Shell renders asynchronously): one layer, and only in edit mode.
    if (s.session?.state && s.session.state.mode !== "edit") return void this.remove();
    for (const other of this.ownerDocument.querySelectorAll("kf-edit-layer")) if (other !== this) other.remove();
    if (s.session && !s.session.services) s.session.connect?.(s);
    this._build();
    this._subs = [];
    const sub = (target, type, fn) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, fn);
      this._subs.push(() => target.removeEventListener(type, fn));
    };
    sub(s.store, "change", () => { this.render(); this._settleLater(); });
    sub(s.session, "change", () => this.render());
    sub(s.session, "update-ready", () => this.render());
    sub(window, "resize", () => this.placeBadges());
    sub(s.board, "kf-thing-tap", (e) => {
      const id = e.detail?.thingId;
      if (!id || s.session?.state?.panel) return;
      const action = tapAction(this._sel, id);
      if (action === "ignore") return;
      editSound(s, "select");
      this._dispatch({ type: "tap", id }); // first tap: the ring with its resize handle
      if (action === "open-card") s.session?.openPanel("card", { thingId: id });
    });
    sub(s.board, "kf-thing-grab", (e) => {
      this.classList.add("dragging");
      this._dispatch({ type: "grab", id: e.detail?.thingId });
    });
    sub(s.board, "kf-thing-drop", () => {
      this.classList.remove("dragging");
      this.placeBadges(); // the actor is already where it was put down
    });
    this.render();
    this._settleLater();
  }

  /**
   * The board spreads overlapping things apart as edit mode starts and when a thing is added
   * (a glide of play/world.js GLIDE_S); place the badges again once it has. Never per frame:
   * while the engine still reports `settling` (gliding or dropping in), placeBadges shows none and asks again later.
   */
  _settleLater() {
    clearTimeout(this._late);
    this._late = setTimeout(() => this.placeBadges(), SETTLE_MS);
  }

  disconnectedCallback() {
    for (const off of this._subs ?? []) off();
    this._subs = [];
    clearTimeout(this._late);
    this._dispatch({ type: "leave" }); // a resize going on goes back to the old size
  }

  /**
   * The one way the selection changes: the next state, the board told when a resize ends
   * (resizeEnd(true) on lifting the finger, resizeEnd(false) otherwise), then the screen from the state.
   */
  _dispatch(e) {
    const prev = this._sel;
    const next = nextSelection(prev, e);
    if (next === prev) return;
    this._sel = next;
    const outcome = resizeOutcome(prev, next, e);
    if (outcome) {
      try { this.services?.board?.resizeEnd?.(outcome === "commit"); } catch (err) { console.error(err); }
    }
    this._renderSelection();
  }

  /** The ring, handle and badges from the selection state. While resizing, only the handle's transform. */
  _renderSelection() {
    const resizing = isResizing(this._sel);
    this.classList.toggle("resizing", resizing);
    if (!resizing) return void this.placeBadges();
    const handle = this._badges?.querySelector(".kf-resize-handle");
    if (!handle) return;
    const [dx, dy] = handleOffset(this._sel);
    // The handle rides the scaled ring corner: one transform write, no layout.
    handle.style.transform = this._sel.k === 1 ? "" : `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }

  _build() {
    this.replaceChildren();
    const badges = document.createElement("div");
    badges.className = "kf-edit-badges";

    const empty = document.createElement("div");
    empty.className = "kf-edit-empty";
    const emptyText = document.createElement("p");
    emptyText.textContent = "Nothing lives here yet.";
    const emptyAdd = this._button("Add an animal", "primary", () => this._add());
    emptyAdd.dataset.action = "add-first";
    empty.append(emptyText, emptyAdd);

    const reason = document.createElement("p");
    reason.className = "kf-edit-reason";
    reason.id = "kf-edit-reason";


    const bar = document.createElement("nav");
    bar.className = "kf-edit-bar";
    bar.setAttribute("aria-label", "Edit mode");
    const session = () => this.services?.session;
    const scenes = this._button("Scenes", "", () => session()?.openPanel("scenes"));
    scenes.dataset.action = "scenes";
    const change = this._button("Change scene", "", () => session()?.sceneTools());
    change.dataset.action = "scene";
    const add = this._button("+ Add", "", () => this._add());
    add.dataset.action = "add";
    const count = document.createElement("span");
    count.className = "kf-add-count";
    count.dataset.testid = "add-count";
    add.append(count);
    const settings = this._button("Settings", "", () => session()?.openPanel("settings"));
    settings.dataset.action = "settings";
    const dot = document.createElement("span");
    dot.className = "kf-update-dot";
    dot.title = "Update ready";
    const dotLabel = document.createElement("span");
    dotLabel.className = "kf-visually-hidden";
    dotLabel.textContent = " (update ready)";
    dot.append(dotLabel);
    settings.append(dot);
    const done = this._button("Done", "primary", () => session()?.done());
    done.dataset.action = "done";
    bar.append(scenes, change, add, settings, done);

    this.append(badges, empty, reason, bar);
    Object.assign(this, { _badges: badges, _empty: empty, _reason: reason, _bar: bar, _add_: add, _count: count, _dot: dot });
  }

  _button(label, kind, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `kf-btn${kind ? " " + kind : ""}`;
    b.textContent = label;
    b.addEventListener("click", (e) => {
      if (label !== "Done") editSound(this.services, "select"); // Done: the session plays 'leave'
      onClick(e);
    });
    return b;
  }

  get _things() {
    const store = this.services?.store;
    const place = store?.currentPlace;
    return place ? store.thingsIn(place.id) : [];
  }

  render() {
    if (!this._bar) return;
    const s = this.services ?? {};
    const panelOpen = !!s.session?.state?.panel;
    this.classList.toggle("covered", panelOpen);
    const place = s.store?.currentPlace;
    const things = this._things;
    const full = place ? !s.store.canAddThing(place.id) : true;
    const cap = s.store?.maxThings ?? 8;
    // "+ Add" stays on when the scene is full: the library it opens says why and what to do.
    this._add_.disabled = !place;
    this._add_.classList.toggle("full", full);
    this._count.textContent = place ? ` ${things.length}/${cap}` : "";
    this._add_.setAttribute("aria-label", place ? `Add an animal (${things.length} of ${cap} in this scene)` : "Add an animal");
    if (full) this._add_.setAttribute("aria-describedby", "kf-edit-reason");
    else this._add_.removeAttribute("aria-describedby");
    this._reason.textContent = `This scene holds ${cap} things. Delete one, or allow more in Settings.`;
    this._reason.hidden = !full || panelOpen;
    this._empty.hidden = panelOpen || !place || things.length > 0;
    this._dot.hidden = !s.updateReady;
    const before = this._sel;
    this._dispatch({ type: "things", ids: things.map((t) => t.id) }); // the selected thing was deleted
    if (this._sel === before) this.placeBadges();
  }

  /** Puts a pencil and a cross above each thing, from the board's actor rectangles. */
  placeBadges() {
    if (!this._badges) return;
    const s = this.services ?? {};
    if (isResizing(this._sel)) return; // the handle under the finger must stay; placed again on release
    this._badges.replaceChildren();
    if (s.session?.state?.panel) return;
    // Things are gliding apart or dropping in: badges placed now would float where they were.
    if (s.engine?.settling) { this._settleLater(); return; }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x) => Math.max(EDGE, Math.min(vw - EDGE, x));
    const clampY = (y) => Math.max(EDGE, Math.min(vh - EDGE, y));
    for (const thing of this._things) {
      const r = s.board?.actorRect?.(thing.id);
      if (!r) continue;
      const name = this._name(thing);
      if (thing.id === selectedId(this._sel)) {
        const hx = clampX(r.right + RING_PAD);
        // Low enough to stay clear of the pencil and cross on a flat thing's top edge.
        const hy = clampY(Math.max(r.bottom + RING_PAD, r.top + BADGE + 6));
        this._badges.append(this._ring(r), this._handle(thing.id, name, hx, hy));
      }
      const cx = r.left + r.width / 2;
      // Close to the thing's top centre, so a wide thing's pencil still reads as its own.
      const half = Math.max(BADGE / 2 + 6, Math.min(BADGE_SPREAD_MAX, r.width * 0.3));
      const y = clampY(r.top);
      const needsVoice = s.store.clipsFor(thing.id, { kind: "name" }).length === 0;
      const pencil = this._badge("pencil", needsVoice ? `Edit ${name} (needs your voice)` : `Edit ${name}`, "✎", clampX(cx - half), y, () => {
        this._dispatch({ type: "pencil", id: thing.id });
        s.session?.openPanel("card", { thingId: thing.id });
      });
      if (needsVoice) {
        // A small mic dot: this thing has no recorded name yet, so play uses the iPad's voice.
        const dot = document.createElement("span");
        dot.className = "kf-voice-dot";
        dot.setAttribute("aria-hidden", "true");
        dot.textContent = "🎤";
        pencil.append(dot);
        pencil.classList.add("needs-voice");
      }
      const cross = this._badge("cross", `Delete ${name}`, "✕", clampX(cx + half), y, () => this.deleteThing(thing.id));
      pencil.dataset.thingId = cross.dataset.thingId = thing.id;
      this._badges.append(pencil, cross);
    }
  }

  /** The selected thing's dashed ring (decorative; taps go through to the board). */
  _ring(r) {
    const ring = document.createElement("div");
    ring.className = "kf-edit-ring";
    ring.dataset.thingId = selectedId(this._sel);
    ring.setAttribute("aria-hidden", "true");
    const pad = RING_PAD;
    Object.assign(ring.style, {
      left: `${Math.round(r.left - pad)}px`, top: `${Math.round(r.top - pad)}px`,
      width: `${Math.round(r.width + 2 * pad)}px`, height: `${Math.round(r.height + 2 * pad)}px`,
    });
    return ring;
  }

  /** The selected thing's resize handle: drag it to make the thing bigger or smaller. */
  _handle(thingId, name, x, y) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kf-resize-handle";
    b.dataset.thingId = thingId;
    b.setAttribute("aria-label", `Resize ${name}: drag to make it bigger or smaller`);
    b.textContent = "⤡";
    b.style.left = `${Math.round(x)}px`;
    b.style.top = `${Math.round(y)}px`;
    b.addEventListener("pointerdown", (e) => this._startResize(e, b, thingId));
    b.addEventListener("pointermove", (e) => this._moveResize(e));
    b.addEventListener("pointerup", (e) => {
      this._moveResize(e); // the last position counts
      this._dispatch({ type: "handle-up", pointerId: e.pointerId });
    });
    b.addEventListener("pointercancel", (e) => this._dispatch({ type: "handle-cancel", pointerId: e.pointerId }));
    b.addEventListener("lostpointercapture", (e) => this._dispatch({ type: "lost-capture", pointerId: e.pointerId }));
    return b;
  }

  _startResize(e, handle, thingId) {
    if (!e.isPrimary || isPalm(e) || isResizing(this._sel)) return;
    e.preventDefault();
    e.stopPropagation();
    let pivot = null;
    try { pivot = this.services?.board?.resizeStart?.(thingId, e.clientX, e.clientY) ?? null; } catch (err) { console.error(err); }
    if (!pivot) return;
    const corner = [parseFloat(handle.style.left), parseFloat(handle.style.top)];
    this._dispatch({ type: "handle-down", id: thingId, pointerId: e.pointerId, pivot, corner });
    if (!isResizing(this._sel)) return void this.services.board.resizeEnd?.(false); // never left half started
    try { handle.setPointerCapture(e.pointerId); } catch {}
  }

  _moveResize(e) {
    if (!ownsPointer(this._sel, e.pointerId)) return;
    let k = this._sel.k;
    try { k = this.services?.board?.resizeTo?.(e.clientX, e.clientY) ?? k; } catch (err) { console.error(err); }
    this._dispatch({ type: "handle-move", pointerId: e.pointerId, k });
  }

  _badge(kind, label, glyph, x, y, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `kf-badge ${kind}`;
    b.setAttribute("aria-label", label);
    b.textContent = glyph;
    b.style.left = `${Math.round(x)}px`;
    b.style.top = `${Math.round(y)}px`;
    b.addEventListener("click", (e) => {
      if (kind === "pencil") editSound(this.services, "select");
      onClick(e);
    });
    return b;
  }

  _name(thing) {
    const lang = this.services?.store?.settings?.languages?.[0];
    const name = (lang && thing.names?.[lang]) || Object.values(thing.names ?? {}).find(Boolean);
    return name ? String(name) : "this thing";
  }

  /** Opens the animal library: draw a new one, or copy one from any scene or the examples. */
  _add() {
    const s = this.services ?? {};
    if (!s.store?.currentPlace) return;
    s.session?.openPanel("library", {});
  }

  /** US-3.6: confirm naming the recordings, delete, then a few seconds of Undo. */
  async deleteThing(thingId) {
    const { store, shell, audio } = this.services ?? {};
    const thing = store?.snapshot?.things?.find((t) => t.id === thingId);
    if (!thing || !shell) return false;
    const name = this._name(thing);
    const n = store.clipsFor(thingId).length;
    const body = n
      ? `This removes its drawing and ${n} recording${n === 1 ? "" : "s"}.`
      : "This removes its drawing. It has no recordings yet.";
    const ok = await shell.confirm({
      title: name === "this thing" ? "Delete this thing?" : `Delete ${name}?`,
      body,
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!ok) return false;
    const change = await store.deleteThing({ thingId });
    audio?.chime?.("poof");
    shell.toast("Deleted", { undo: () => store.restoreThing(change.removed) });
    return true;
  }
}
