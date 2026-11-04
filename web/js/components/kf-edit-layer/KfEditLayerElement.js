// <kf-edit-layer>: edit mode on the scene (US-11.3, US-3.5, US-3.6, US-2.5, US-7.6).
// The bar (Scenes, Change scene, + Add, Settings, Done) and still, 44 pt+ badges per thing:
// pencil → the thing card; cross → confirm (naming the recordings) → delete → Undo toast.
// Badges are placed once from services.board.actorRect(id) and re-placed on store changes and resize,
// never per frame. Hidden while a panel is open over edit mode.

const BADGE = 52; // px, ≥ 44 pt target
const EDGE = BADGE / 2 + 4;

export class KfEditLayerElement extends HTMLElement {
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
    sub(s.store, "change", () => this.render());
    sub(s.session, "change", () => this.render());
    sub(s.session, "update-ready", () => this.render());
    sub(window, "resize", () => this.placeBadges());
    sub(s.board, "kf-thing-tap", (e) => {
      if (e.detail?.thingId && !s.session?.state?.panel) s.session?.openPanel("card", { thingId: e.detail.thingId });
    });
    this.render();
    // The board settles things in place as edit mode starts; place the badges again once it has.
    this._late = setTimeout(() => this.placeBadges(), 400);
  }

  disconnectedCallback() {
    for (const off of this._subs ?? []) off();
    this._subs = [];
    clearTimeout(this._late);
  }

  _build() {
    this.replaceChildren();
    const badges = document.createElement("div");
    badges.className = "kf-edit-badges";

    const empty = document.createElement("div");
    empty.className = "kf-edit-empty";
    const emptyText = document.createElement("p");
    emptyText.textContent = "Nothing lives here yet.";
    const emptyAdd = this._button("Add a thing", "primary", () => this._add());
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
    add.setAttribute("aria-label", "Add a thing");
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
    Object.assign(this, { _badges: badges, _empty: empty, _reason: reason, _bar: bar, _add_: add, _dot: dot });
  }

  _button(label, kind, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `kf-btn${kind ? " " + kind : ""}`;
    b.textContent = label;
    b.addEventListener("click", onClick);
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
    this._add_.disabled = full;
    if (full) this._add_.setAttribute("aria-describedby", "kf-edit-reason");
    else this._add_.removeAttribute("aria-describedby");
    this._reason.textContent = `This scene holds ${s.store?.maxThings ?? 8} things at most. Delete one, or allow more in Settings.`;
    this._reason.hidden = !full || panelOpen;
    this._empty.hidden = panelOpen || !place || things.length > 0;
    this._dot.hidden = !s.updateReady;
    this.placeBadges();
  }

  /** Puts a pencil and a cross above each thing, from the board's actor rectangles. */
  placeBadges() {
    if (!this._badges) return;
    const s = this.services ?? {};
    this._badges.replaceChildren();
    if (s.session?.state?.panel) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x) => Math.max(EDGE, Math.min(vw - EDGE, x));
    const clampY = (y) => Math.max(EDGE, Math.min(vh - EDGE, y));
    for (const thing of this._things) {
      const r = s.board?.actorRect?.(thing.id);
      if (!r) continue;
      const name = this._name(thing);
      const cx = r.left + r.width / 2;
      const half = Math.max(BADGE / 2 + 6, r.width * 0.3);
      const y = clampY(r.top);
      const needsVoice = s.store.clipsFor(thing.id, { kind: "name" }).length === 0;
      const pencil = this._badge("pencil", needsVoice ? `Edit ${name} (needs your voice)` : `Edit ${name}`, "✎", clampX(cx - half), y, () => s.session?.openPanel("card", { thingId: thing.id }));
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

  _badge(kind, label, glyph, x, y, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `kf-badge ${kind}`;
    b.setAttribute("aria-label", label);
    b.textContent = glyph;
    b.style.left = `${Math.round(x)}px`;
    b.style.top = `${Math.round(y)}px`;
    b.addEventListener("click", onClick);
    return b;
  }

  _name(thing) {
    const lang = this.services?.store?.settings?.languages?.[0];
    const name = (lang && thing.names?.[lang]) || Object.values(thing.names ?? {}).find(Boolean);
    return name ? String(name) : "this thing";
  }

  _add() {
    const s = this.services ?? {};
    const place = s.store?.currentPlace;
    if (!place || !s.store.canAddThing(place.id)) return;
    s.session?.openPanel("guided", {});
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
