// <kf-scenes>: the scenes shelf (flow 4; US-2.1, 2.3, 2.4).
// Felt thumbnails, tap to switch, "…" for rename and delete, "+ New scene" (name, backdrop,
// sky and ground colours) → store.createPlace → session.sceneTools(). A new scene is seeded with a
// few random animals from the repertoire (QA round 3): the library's examples are loaded when the
// form opens and handed to createPlace, which picks and places them in the same change.
// Props: services, params (unused). Dispatches kf-close when finished.
import { h, newId, plural, swatches, reportFailure } from "../kf-dialog/dom.js";
import { SKY_COLORS, GROUND_COLORS } from "../../farm/palette.js";
import { BACKDROPS } from "../../farm/snapshot.js";
import { paintThumbnail } from "./thumbnail.js";
import { loadExamples } from "../kf-library/examples.js";

const BACKDROP_LABEL = { meadow: "Meadow", sea: "Sea", room: "Room", blank: "Blank" };
/** Colours each backdrop starts with; the parent can change both. */
const BACKDROP_COLORS = {
  meadow: { skyColor: "sky", groundColor: "grass" },
  sea: { skyColor: "sky", groundColor: "water" },
  room: { skyColor: "wall", groundColor: "floor" },
  blank: { skyColor: "cream", groundColor: "sand" },
};
const THUMB_W = 240;
const THUMB_H = 180;

export class KfScenesElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this._view = "shelf"; // 'shelf' | 'new'
    this._menuFor = null; // place id with the "…" menu open
    this._renaming = null; // place id being renamed
    this._draft = { name: "", backdrop: "meadow", ...BACKDROP_COLORS.meadow };
    this._onChange = () => {
      if (this._view === "shelf" && !this._renaming) this.render();
    };
    this._onPointer = () => this.services?.session?.activity?.();
  }

  connectedCallback() {
    this.services?.store?.addEventListener("change", this._onChange);
    this.addEventListener("pointerdown", this._onPointer);
    this.render();
  }

  disconnectedCallback() {
    this.services?.store?.removeEventListener("change", this._onChange);
    this.removeEventListener("pointerdown", this._onPointer);
  }

  get store() { return this.services.store; }

  close() { this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true })); }

  render() {
    const titleId = newId("scenes-title");
    const isNew = this._view === "new";
    const header = h("div", { class: "kf-scenes-head" }, [
      h("h2", { id: titleId, text: isNew ? "New scene" : "Scenes" }),
      h("button", { type: "button", class: "kf-btn ghost icon", "aria-label": "Close", text: "✕", onclick: () => this.close() }),
    ]);
    const body = isNew ? this.renderNew() : this.renderShelf();
    this.replaceChildren(
      h("div", { class: "kf-scenes-scrim", onclick: () => this.close() }),
      h("section", { class: "kf-sheet full kf-scenes", role: "dialog", "aria-labelledby": titleId }, [header, body]),
    );
    this.querySelector("[autofocus]")?.focus();
  }

  // ---------------------------------------------------------------- shelf

  renderShelf() {
    const { places, settings } = this.store.snapshot;
    const current = this.store.currentPlace?.id ?? settings.currentPlaceId;
    const list = h("ul", { class: "kf-shelf", "aria-label": "Scenes" });
    for (const place of places) list.append(this.renderCard(place, place.id === current));
    list.append(
      h("li", { class: "kf-scene-item" }, [
        h("button", { type: "button", class: "kf-scene-card kf-scene-new", onclick: () => this.openNew() }, [h("span", { class: "kf-scene-plus", "aria-hidden": "true", text: "+" }), h("span", { text: "New scene" })]),
      ]),
    );
    return h("div", {}, [list]);
  }

  renderCard(place, isCurrent) {
    const item = h("li", { class: "kf-scene-item" });
    if (this._renaming === place.id) {
      item.append(this.renderRename(place));
      return item;
    }
    const canvas = h("canvas", { class: "kf-scene-thumb", width: THUMB_W, height: THUMB_H, "aria-hidden": "true" });
    paintThumbnail(canvas, place).catch(() => {});
    const card = h("button", { type: "button", class: "kf-scene-card", "aria-current": isCurrent ? "true" : null, onclick: () => this.switchTo(place.id) }, [
      canvas,
      h("span", { class: "kf-scene-name", text: place.name }),
    ]);
    const open = this._menuFor === place.id;
    const menuId = newId("scene-menu");
    const more = h("button", {
      type: "button",
      class: "kf-btn icon kf-scene-more",
      "aria-label": `Options for ${place.name}`,
      "aria-expanded": String(open),
      "aria-controls": open ? menuId : null,
      text: "…",
      onclick: () => {
        this._menuFor = open ? null : place.id;
        this.render();
      },
    });
    item.append(card, more);
    if (open) {
      item.append(
        h("div", { class: "kf-scene-menu", id: menuId, role: "group", "aria-label": `${place.name} options` }, [
          h("button", { type: "button", class: "kf-btn", text: "Rename", onclick: () => this.startRename(place.id) }),
          h("button", { type: "button", class: "kf-btn danger", text: "Delete", onclick: () => this.confirmDelete(place) }),
        ]),
      );
    }
    return item;
  }

  renderRename(place) {
    const inputId = newId("scene-name");
    const input = h("input", { id: inputId, type: "text", value: place.name, maxLength: 60, autocomplete: "off", autofocus: true });
    const form = h("form", { class: "kf-scene-rename" }, [
      h("div", { class: "kf-field" }, [h("label", { htmlFor: inputId, text: "Scene name" }), input]),
      h("div", { class: "kf-row end" }, [
        h("button", { type: "button", class: "kf-btn", text: "Cancel", onclick: () => this.stopRename() }),
        h("button", { type: "submit", class: "kf-btn primary", text: "Save" }),
      ]),
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await this.store.renamePlace({ placeId: place.id, name: input.value });
      } catch (err) {
        reportFailure(this.services, err);
      }
      this.stopRename();
    });
    return form;
  }

  startRename(placeId) {
    this._menuFor = null;
    this._renaming = placeId;
    this.render();
  }

  stopRename() {
    this._renaming = null;
    this.render();
  }

  async switchTo(placeId) {
    try {
      if (this.store.currentPlace?.id !== placeId) await this.store.setCurrentPlace({ placeId });
      this.close();
    } catch (e) {
      reportFailure(this.services, e);
    }
  }

  async confirmDelete(place) {
    this._menuFor = null;
    const things = this.store.thingsIn(place.id);
    const ids = new Set(things.map((t) => t.id));
    const recordings = this.store.snapshot.clips.filter((c) => ids.has(c.thingId)).length;
    const lost = things.length || recordings ? `This removes ${plural(things.length, "thing")} and ${plural(recordings, "recording")}.` : "This scene has no things or recordings.";
    const ok = await this.services.shell.confirm({
      title: `Delete “${place.name}”?`,
      body: [lost, "This can't be undone."],
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (ok) {
      try {
        await this.store.deletePlace({ placeId: place.id });
        this.services.audio?.chime?.("poof");
      } catch (e) {
        reportFailure(this.services, e);
      }
    }
    this.render();
  }

  // ---------------------------------------------------------------- new scene

  openNew() {
    this._menuFor = null;
    this._view = "new";
    this._draft = { name: "", backdrop: "meadow", ...BACKDROP_COLORS.meadow };
    // Ready long before "Start drawing": seeding never waits on a fetch inside the tap.
    loadExamples(this.services).then((list) => (this._examples = list));
    this.render();
  }

  renderNew() {
    const d = this._draft;
    const inputId = newId("new-name");
    const noteId = newId("new-note");
    const input = h("input", { id: inputId, type: "text", value: d.name, placeholder: "Grandma's garden", maxLength: 60, autocomplete: "off", autofocus: true, "aria-describedby": noteId });
    input.addEventListener("input", () => (d.name = input.value));

    const preview = h("canvas", { class: "kf-scene-preview", width: THUMB_W * 2, height: THUMB_H * 2, "aria-hidden": "true" });
    const repaint = () => paintThumbnail(preview, { backdrop: d.backdrop, skyColor: d.skyColor, groundColor: d.groundColor, pieces: [] }).catch(() => {});

    const backdrops = h("div", { class: "kf-backdrops", role: "group", "aria-label": "Backdrop" });
    const skyHolder = h("div");
    const groundHolder = h("div");
    const drawSwatches = () => {
      skyHolder.replaceChildren(swatches("Sky colour", SKY_COLORS, d.skyColor, (k) => ((d.skyColor = k), drawSwatches(), repaint())));
      groundHolder.replaceChildren(swatches("Ground colour", GROUND_COLORS, d.groundColor, (k) => ((d.groundColor = k), drawSwatches(), repaint())));
    };
    const drawBackdrops = () => {
      backdrops.replaceChildren(
        ...BACKDROPS.map((b) => {
          const thumb = h("canvas", { class: "kf-backdrop-thumb", width: 120, height: 90, "aria-hidden": "true" });
          paintThumbnail(thumb, { backdrop: b, ...BACKDROP_COLORS[b], pieces: [] }).catch(() => {});
          return h(
            "button",
            {
              type: "button",
              class: "kf-backdrop",
              "aria-pressed": String(b === d.backdrop),
              onclick: () => {
                Object.assign(d, { backdrop: b, ...BACKDROP_COLORS[b] });
                drawBackdrops();
                drawSwatches();
                repaint();
              },
            },
            [thumb, h("span", { text: BACKDROP_LABEL[b] ?? b })],
          );
        }),
      );
    };
    drawBackdrops();
    drawSwatches();
    repaint();

    const form = h("form", { class: "kf-scene-new-form" }, [
      h("div", { class: "kf-field" }, [h("label", { htmlFor: inputId, text: "Scene name" }), input]),
      h("p", { class: "kf-note", id: noteId, text: "The name is for you; Klara never sees text. A few animals move in to start with." }),
      h("div", { class: "kf-scene-new-grid" }, [
        h("div", {}, [h("h3", { text: "Backdrop" }), backdrops, h("h3", { text: "Sky" }), skyHolder, h("h3", { text: "Ground" }), groundHolder]),
        h("div", { class: "kf-scene-preview-wrap" }, [preview]),
      ]),
      h("div", { class: "kf-row end kf-scene-actions" }, [
        h("button", { type: "button", class: "kf-btn", text: "Back", onclick: () => ((this._view = "shelf"), this.render()) }),
        h("button", { type: "submit", class: "kf-btn primary", text: "Start drawing" }),
      ]),
    ]);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.create();
    });
    return form;
  }

  /**
   * Creates the scene (with its seeded animals) inside the tap: the store shows it at once, so the
   * shelf closes and the scene tools open without waiting for the disk. A write that fails later
   * has been rolled back by the store; the parent gets a toast.
   */
  create() {
    const d = this._draft;
    if (this._creating) return;
    this._creating = true;
    const before = this.store.snapshot.places;
    let committed;
    try {
      const seed = { examples: this._examples ?? [] };
      committed = this.store.createPlace({ name: d.name, backdrop: d.backdrop, skyColor: d.skyColor, groundColor: d.groundColor, seed });
    } catch (e) {
      committed = Promise.reject(e);
    }
    const open = () => {
      // Close the shelf first so the scene tools are not covered by it.
      this.close();
      this.services.session?.sceneTools?.();
    };
    if (this.store.snapshot.places !== before) {
      open();
      committed.catch((e) => reportFailure(this.services, e));
      return;
    }
    // Not shown yet: refused, or queued behind an import.
    committed.then(open, (e) => {
      this._creating = false;
      reportFailure(this.services, e);
    });
  }
}
