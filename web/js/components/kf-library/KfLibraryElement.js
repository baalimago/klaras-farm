// <kf-library>: the animal library, panel `library` (QA round 3). "+ Add" in edit mode opens it.
// Owns: the sheet that lists "Draw a new animal" (opens guided add), then every animal the family
// has made (across all scenes, farm/library.js libraryEntries) and the pre-made examples
// (web/data/library.json), each with a felt picture (thumbnail.js, painted once and cached) and
// its name. Tapping one adds an independent copy to the current scene at once (store.copyThing:
// the snapshot changes inside the tap), drops it in with the `add` sound and closes the sheet; the
// write is only watched for a failure toast. A full scene says so with the way out, and its tiles
// are off. Renders from the store and its own loaded `examples` on every change; keeps no copy of
// farm data. Props: services, params (unused). Dispatches kf-close.
import { h, newId, plural, reportFailure } from "../kf-dialog/dom.js";
import { editSound } from "../kf-dialog/feedback.js";
import { libraryEntries } from "../../farm/library.js";
import { loadExamples } from "./examples.js";
import { paintThingThumb, THUMB_W, THUMB_H } from "./thumbnail.js";

export class KfLibraryElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    /** @type {import('../../types.js').Thing[] | null} null while loading */
    this.examples = null;
    this._onChange = () => this.render();
    this._onPointer = () => this.services?.session?.activity?.();
  }

  connectedCallback() {
    this.services?.store?.addEventListener("change", this._onChange);
    this.addEventListener("pointerdown", this._onPointer);
    this.render();
    loadExamples(this.services).then((list) => {
      this.examples = list;
      if (this.isConnected) this.render();
    });
  }

  disconnectedCallback() {
    this.services?.store?.removeEventListener("change", this._onChange);
    this.removeEventListener("pointerdown", this._onPointer);
  }

  get store() { return this.services.store; }

  close() { this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true })); }

  /** What the sheet shows, from the store and the loaded examples. */
  view() {
    const store = this.store;
    const place = store.currentPlace;
    const count = place ? store.thingsIn(place.id).length : 0;
    const cap = store.maxThings ?? 8;
    const full = !place || !store.canAddThing(place.id);
    const { own, examples } = libraryEntries(store.snapshot, this.examples ?? []);
    return { place, count, cap, full, own, examples, loading: this.examples === null };
  }

  render() {
    const scroller = this.querySelector(".kf-library");
    const scrollTop = scroller?.scrollTop ?? 0;
    const v = this.view();
    const titleId = newId("library-title");
    const statusId = newId("library-status");
    const sheet = h("section", { class: "kf-sheet full kf-library", role: "dialog", "aria-labelledby": titleId, "aria-describedby": statusId }, [
      h("div", { class: "kf-library-head" }, [
        h("div", {}, [
          h("h2", { id: titleId, text: "Add to this scene" }),
          h("p", { class: "kf-library-count", id: statusId, "data-testid": "library-count", text: `${v.count} of ${v.cap} things in this scene` }),
        ]),
        h("button", { type: "button", class: "kf-btn ghost icon", "aria-label": "Close", text: "✕", onclick: () => (editSound(this.services, "back"), this.close()) }),
      ]),
      v.full
        ? h("p", { class: "kf-library-full", role: "status", "data-testid": "library-full", text: `This scene holds ${v.cap} things. Delete one, or allow more in Settings.` })
        : h("p", { class: "kf-note", text: "Tap one to put a copy in this scene. Its recordings come too." }),
      h("ul", { class: "kf-library-grid", "aria-label": "New" }, [this.drawTile(v.full)]),
      ...(v.own.length ? [h("h3", { text: "Your animals" }), this.grid("Your animals", v.own, v.full)] : []),
      h("h3", { text: "Examples" }),
      v.loading ? h("p", { class: "kf-note", text: "Getting the examples…" }) : this.grid("Examples", v.examples, v.full),
    ]);
    this.replaceChildren(h("div", { class: "kf-library-scrim", onclick: () => this.close() }), sheet);
    sheet.scrollTop = scrollTop;
    this.dataset.full = String(v.full);
  }

  drawTile(full) {
    return h("li", {}, [
      h("button", { type: "button", class: "kf-library-tile kf-library-draw", "data-action": "draw-new", disabled: full, onclick: () => this.drawNew() }, [
        h("span", { class: "kf-library-plus", "aria-hidden": "true", text: "+" }),
        h("span", { class: "kf-library-name", text: "Draw a new animal" }),
      ]),
    ]);
  }

  grid(label, entries, full) {
    return h("ul", { class: "kf-library-grid", "aria-label": label }, entries.map((entry) => h("li", {}, [this.tile(entry, full)])));
  }

  tile(entry, full) {
    const name = this.nameOf(entry.thing);
    const canvas = h("canvas", { class: "kf-library-thumb", width: THUMB_W, height: THUMB_H, "aria-hidden": "true" });
    paintThingThumb(canvas, entry.thing);
    const n = entry.clips.length;
    return h(
      "button",
      {
        type: "button",
        class: "kf-library-tile",
        disabled: full,
        "data-source": entry.example ? "example" : "own",
        "data-thing-id": entry.thing.id,
        "aria-label": `Add ${name}${n ? `, with ${plural(n, "recording")}` : ""}`,
        onclick: () => this.add(entry),
      },
      [canvas, h("span", { class: "kf-library-name", text: name }), n ? h("span", { class: "kf-library-rec", "aria-hidden": "true", text: `🎤 ${n}` }) : null],
    );
  }

  nameOf(thing) {
    const lang = this.store.settings?.languages?.[0];
    const name = (lang && thing.names?.[lang]) || Object.values(thing.names ?? {}).find(Boolean);
    return name ? String(name) : "No name yet";
  }

  drawNew() {
    const { store, session } = this.services;
    const place = store.currentPlace;
    if (!place || !store.canAddThing(place.id)) return this.render();
    editSound(this.services, "select");
    session?.openPanel("guided", {});
  }

  /**
   * Adds a copy at once, inside the tap: the store swaps its snapshot and emits before returning,
   * so the copy drops in and the sheet closes now; the write is watched only to report a failure
   * (the store has rolled back by then). A full scene re-renders with the reason instead.
   */
  add(entry) {
    const { store, engine } = this.services;
    const place = store.currentPlace;
    if (!place || !store.canAddThing(place.id)) return this.render();
    editSound(this.services, "add");
    const before = new Set(store.snapshot.things.map((t) => t.id));
    const args = entry.example ? { placeId: place.id, thing: entry.thing } : { placeId: place.id, thingId: entry.thing.id };
    let committed;
    try {
      committed = store.copyThing(args);
    } catch (e) {
      committed = Promise.reject(e);
    }
    const added = store.snapshot.things.find((t) => !before.has(t.id));
    if (!added) {
      // Refused (full or invalid), or queued behind an import: it shows when the store gets to it.
      committed.then((change) => this.dropped(change.ids[0]), (e) => this.refused(e));
      return;
    }
    this.dropped(added.id);
    committed.catch((e) => reportFailure(this.services, e));
  }

  dropped(thingId) {
    try {
      this.services.engine?.dropIn?.(thingId);
    } catch (e) {
      console.warn("kf-library:", e);
    }
    this.close();
  }

  refused(e) {
    if (e?.code === "place-full") return this.render();
    reportFailure(this.services, e);
  }
}
