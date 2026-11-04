// <kf-thing-card>: everything about one thing on one card (flow 2; US-3.6–3.8, 4.5, 4.7, 9.1).
// One tab per language (typed name, name clip, 3 questions with editable cues, sound) plus
// "+ Language"; felt colour, motion, Redraw, Re-stamp eyes, Place legs, Delete with confirm and Undo.
// Changes save immediately; there is no Save button. Props: `services`, `params = {thingId}`.
import { h, ensureElement, languageName } from "../kf-guided-add/dom.js";
import { loadGeometry, snapPoint } from "../kf-guided-add/geometry.js";
import { ThingPreview, viewFor, FULL_VIEW } from "../kf-guided-add/preview.js";
import { EyeStamper } from "../kf-guided-add/eyes.js";
import { ShapeDrawing } from "../kf-guided-add/drawing.js";
import { ShapeEditor } from "../kf-guided-add/shape-editor.js";
import { bodyGuide } from "../kf-guided-add/guide.js";
import { LegPlacer } from "../kf-guided-add/legs.js";
import { THING_SIZE, MOTIONS, stripClip, refitEyes } from "../kf-guided-add/steps.js";
import { languageOptions } from "./languages.js";
import { THING_COLORS, hex } from "../../farm/palette.js";
import { cueLines } from "../../farm/scripts.js";

const KIND_LABEL = { name: "name", prompt: "question", sound: "sound" };

export class ThingCardElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this.ready = null;
    this._recording = null; // {language, kind, take}
    this._overlay = null;
    this._addingLang = false;
    this._failed = new Set();
    this._dirty = false;
  }

  connectedCallback() {
    this.ready ??= this._start();
  }

  disconnectedCallback() {
    this.services?.store?.removeEventListener("change", this._onStore);
    this.services?.audio?.removeEventListener?.("decode-failed", this._onDecodeFailed);
    this._overlay?.close?.();
  }

  get thingId() { return this.params?.thingId; }
  get thing() { return this.services.store.snapshot.things.find((t) => t.id === this.thingId) ?? null; }
  get languages() {
    const l = this.services.store.settings?.languages;
    return l?.length ? l : ["en"];
  }

  async _start() {
    const { store, audio } = this.services;
    const [geo] = await Promise.all([
      loadGeometry(),
      ensureElement("kf-draw-pad", () => import("../kf-draw-pad/define.js")),
      ensureElement("kf-recorder", () => import("../kf-recorder/define.js")),
    ]);
    this.geo = geo;
    this.lang ??= this.languages[0];
    for (const id of audio?.failedClips ?? []) this._failed.add(id);
    this._onStore = () => this._storeChanged();
    this._onDecodeFailed = (e) => {
      if (e.detail?.clipId) this._failed.add(e.detail.clipId);
      this._storeChanged();
    };
    store.addEventListener("change", this._onStore);
    audio?.addEventListener?.("decode-failed", this._onDecodeFailed);
    this.addEventListener("focusout", () => queueMicrotask(() => { if (this._dirty && !this._editing()) this._render(); }));
    if (!this.thing) return this._close();
    this._render();
  }

  _editing() {
    const a = document.activeElement;
    return !!a && this.contains(a) && a.matches("input, select, textarea");
  }

  _storeChanged() {
    if (!this.isConnected) return;
    if (!this.thing) {
      if (!this._deleting) this._close();
      return;
    }
    if (this._recording || this._overlay || this._editing()) {
      this._dirty = true;
      return;
    }
    this._render();
  }

  displayName(thing = this.thing) {
    const n = thing?.names ?? {};
    return n[this.lang] || n[this.languages[0]] || Object.values(n).find(Boolean) || "thing";
  }

  // ---------- rendering ----------

  _render() {
    this._dirty = false;
    const thing = this.thing;
    if (!thing) return;
    if (!this.languages.includes(this.lang)) this.lang = this.languages[0];
    const sheet = h(
      "section",
      { class: "kf-sheet full kf-tc", role: "dialog", "aria-labelledby": "kf-tc-title" },
      h(
        "div",
        { class: "kf-row kf-tc-head" },
        h("h2", { id: "kf-tc-title", text: this.displayName(thing) }),
        h("button", { class: "kf-btn icon", type: "button", "aria-label": "Close", text: "✕", onclick: () => this._close() }),
      ),
      this._tabs(),
      this._addingLang ? this._addLangRow() : null,
      h("div", { class: "kf-tc-body" }, this._words(thing), this._look(thing)),
      h(
        "div",
        { class: "kf-row kf-tc-foot" },
        h("button", { class: "kf-btn danger", type: "button", text: `Delete ${this.displayName(thing)}`, "data-action": "delete", onclick: () => this._delete() }),
        h("span", { class: "kf-tc-spacer" }),
        h("button", { class: "kf-btn primary", type: "button", text: "Close", onclick: () => this._close() }),
      ),
    );
    this.replaceChildren(sheet);
    this._drawPreview();
  }

  _tabs() {
    return h(
      "div",
      { class: "kf-tabs", role: "tablist", "aria-label": "Language" },
      this.languages.map((l) =>
        h("button", {
          type: "button", role: "tab", "data-lang": l, "aria-selected": String(l === this.lang), text: languageName(l),
          onclick: () => { this.lang = l; this._recording = null; this._render(); },
        }),
      ),
      h("button", { type: "button", "data-action": "add-language", text: "+ Language", onclick: () => { this._addingLang = true; this._render(); } }),
    );
  }

  _addLangRow() {
    const select = h(
      "select",
      { name: "language", "aria-label": "Language to add" },
      languageOptions(this.languages, languageName).map(({ lang, name }) => h("option", { value: lang, text: name })),
    );
    return h(
      "div",
      { class: "kf-row kf-tc-addlang" },
      h("label", { class: "kf-field" }, h("span", { text: "Add a language (for the other parent)" }), select),
      h("button", { class: "kf-btn primary", type: "button", text: "Add", onclick: () => this._addLanguage(select.value) }),
      h("button", { class: "kf-btn ghost", type: "button", text: "Cancel", onclick: () => { this._addingLang = false; this._render(); } }),
    );
  }

  _words(thing) {
    const lang = this.lang;
    const { lines, fallback, articles } = cueLines(this.services.scripts ?? {}, thing, lang);
    const cue = thing.cues?.[lang] ?? {};
    const promptCount = this._clips({ kind: "prompt" }).length;
    return h(
      "div",
      { class: "kf-tc-words", role: "tabpanel", "aria-label": languageName(lang) },
      h("h3", { text: "Name" }),
      h(
        "div",
        { class: "kf-tc-line" },
        h("label", { class: "kf-field" }, h("span", { text: `Name in ${languageName(lang)}` }),
          h("input", {
            type: "text", name: "name", value: thing.names?.[lang] ?? "", autocomplete: "off", autocapitalize: "words", enterkeyhint: "done", spellcheck: "false",
            onchange: (e) => this._rename(e.target.value),
          })),
        this._clipControls("name", 1),
      ),
      h("h3", { text: `Questions (${promptCount}/3)` }),
      fallback ? h("p", { class: "kf-note", text: `No script for ${languageName(lang)} yet: say these in your language.` }) : null,
      articles.length
        ? h("label", { class: "kf-field kf-tc-article" }, h("span", { text: "Article" }),
            h("select", { name: "article", onchange: (e) => this._setCue({ article: e.target.value || undefined }) },
              h("option", { value: "", text: "(none)", selected: !cue.article }),
              articles.map((a) => h("option", { value: a, text: a, selected: cue.article === a }))))
        : null,
      lines.map((line, i) =>
        h(
          "div",
          { class: "kf-tc-line" },
          h("label", { class: "kf-field" }, h("span", { text: `Question ${i + 1}` }),
            h("input", { type: "text", name: `cue-${i + 1}`, value: line, onchange: (e) => this._setLine(i, e.target.value) })),
          this._clipControls("prompt", i + 1),
        ),
      ),
      h("h3", { text: "Sound" }),
      h("div", { class: "kf-tc-line" }, this._clipControls("sound", 1)),
    );
  }

  _clips({ kind, take } = {}) {
    return this.services.store.clipsFor(this.thingId, { language: this.lang, kind }).filter((c) => take == null || c.take === take);
  }

  _clipControls(kind, take) {
    const clip = this._clips({ kind, take })[0] ?? null;
    const open = this._recording && this._recording.kind === kind && this._recording.take === take && this._recording.language === this.lang;
    const what = kind === "prompt" ? `question ${take}` : KIND_LABEL[kind];
    const failed = clip && this._failed.has(clip.id);
    const box = h(
      "div",
      { class: "kf-tc-clip", "data-kind": kind, "data-take": String(take) },
      clip ? h("button", { class: "kf-btn icon", type: "button", "aria-label": `Play ${what}`, "data-action": "play", text: "▶", onclick: () => this.services.audio?.playClip?.(clip) }) : null,
      failed ? h("span", { class: "kf-tc-flag", role: "status", text: "Won't play: re-record" }) : null,
      open
        ? null
        : h("button", {
            class: `kf-btn${failed ? " primary" : ""}`, type: "button", "data-action": "record",
            text: this._recordText(kind, !!clip),
            "aria-label": `${clip ? "Re-record" : "Record"} ${what}`,
            onclick: () => { this._recording = { language: this.lang, kind, take }; this._render(); },
          }),
    );
    if (open) {
      const rec = document.createElement("kf-recorder");
      rec.services = this.services;
      rec.label = this._cueFor(kind, take);
      rec.clipRef = { thingId: this.thingId, language: this.lang, kind, take };
      rec.existing = clip;
      rec.addEventListener("kf-recorded", (e) => this._saveRecording(e.detail, { kind, take }));
      box.append(
        h("div", { class: "kf-tc-recorder" }, rec,
          h("button", { class: "kf-btn ghost", type: "button", "data-action": "cancel-record", text: "Cancel", onclick: () => { this._recording = null; this._render(); } })),
      );
    }
    return box;
  }

  /** Say exactly what to record, so the name and the sound are never mixed up. */
  _recordText(kind, again) {
    if (kind === "name") {
      const word = this.thing.names?.[this.lang] || this.displayName(this.thing);
      return `${again ? "Re-record" : "Record"}: say “${word}”`;
    }
    if (kind === "sound") return again ? "Re-record its sound" : "Record its sound (moo! cluck!)";
    return again ? "Re-record" : "Record";
  }

  _cueFor(kind, take) {
    const thing = this.thing;
    if (kind === "prompt") return cueLines(this.services.scripts ?? {}, thing, this.lang).lines[take - 1] ?? "";
    if (kind === "sound") return `Make the ${this.displayName(thing)}'s sound, not its name (moo! cluck!)`;
    return `Say just the word, slowly and clearly: “${thing.names?.[this.lang] || this.displayName(thing)}”`;
  }

  _look(thing) {
    const canvas = h("canvas", { "aria-hidden": "true" });
    this._preview = new ThingPreview(canvas, this.geo);
    return h(
      "div",
      { class: "kf-tc-look" },
      h("h3", { text: "Look" }),
      h("div", { class: "kf-tc-preview" }, canvas),
      h("h3", { text: "Felt" }),
      h(
        "div",
        { class: "kf-swatches", role: "group", "aria-label": "Felt colour" },
        THING_COLORS.map((key) =>
          h("button", {
            class: "kf-swatch", type: "button", "aria-label": key, "data-color": key, "aria-pressed": String(thing.color === key),
            style: { background: hex(key) }, onclick: () => this._update({ color: key }),
          }),
        ),
      ),
      h("h3", { text: "Moves" }),
      h(
        "div",
        { class: "kf-row", role: "group", "aria-label": "Motion" },
        MOTIONS.map((m) =>
          h("button", {
            class: "kf-btn kf-tc-motion", type: "button", "data-motion": m.preset, "aria-pressed": String(thing.motion?.preset === m.preset), text: `${m.icon} ${m.label}`,
            onclick: () => this._update({ motion: { kind: "preset", preset: m.preset, params: { ...(thing.motion?.preset === m.preset ? thing.motion.params : {}) } } }),
          }),
        ),
      ),
      h(
        "div",
        { class: "kf-row kf-tc-shape" },
        h("button", { class: "kf-btn", type: "button", text: "Redraw", "data-action": "redraw", onclick: () => this._redraw() }),
        h("button", { class: "kf-btn", type: "button", text: "Re-stamp eyes", "data-action": "restamp", onclick: () => this._restamp() }),
        h("button", { class: "kf-btn", type: "button", text: "Place legs", "data-action": "legs", onclick: () => this._placeLegs() }),
      ),
    );
  }

  _drawPreview() {
    const thing = this.thing;
    if (!this._preview || !thing) return;
    this._preview.setView(viewFor(thing.outline, { fill: 0.6, geo: this.geo }));
    this._preview.draw(thing);
  }

  // ---------- actions ----------

  async _update(patch) {
    try {
      await this.services.store.updateThing({ thingId: this.thingId, patch });
    } catch (e) {
      this._error(e);
    }
  }

  _rename(value) {
    const names = { ...(this.thing.names ?? {}) };
    const v = value.trim();
    if (v) names[this.lang] = v;
    else delete names[this.lang];
    const title = this.querySelector("#kf-tc-title");
    return this._update({ names }).then(() => { if (title) title.textContent = this.displayName(); });
  }

  _setCue(change) {
    const cues = { ...(this.thing.cues ?? {}) };
    const cue = { ...(cues[this.lang] ?? {}), ...change };
    if (!cue.article) delete cue.article;
    cues[this.lang] = cue;
    return this._update({ cues });
  }

  _setLine(i, value) {
    const prev = this.thing.cues?.[this.lang]?.lines ?? ["", "", ""];
    const lines = [0, 1, 2].map((k) => (k === i ? value.trim() : (prev[k] ?? "")));
    return this._setCue({ lines });
  }

  async _addLanguage(lang) {
    if (!lang) return;
    try {
      await this.services.store.updateSettings({ patch: { languages: [...this.languages, lang] } });
      this.lang = lang;
      this._addingLang = false;
      this._render();
    } catch (e) {
      this._error(e);
    }
  }

  /** A finished take is kept at once: it replaces the old clip now and the recorder closes (US-4.7).
   *  Cancel, or a take that fails its checks, never gets here, so the old clip stays. */
  async _saveRecording(detail, { kind, take }) {
    const { clip, blob } = detail ?? {};
    if (!clip) return;
    const old = this._clips({ kind, take })[0];
    try {
      await this.services.store.saveClip({ clip: { ...stripClip(clip), thingId: this.thingId, language: this.lang, kind, take }, blob });
      if (old) this._failed.delete(old.id);
      this._recording = null;
      this._render();
    } catch (e) {
      this._error(e);
    }
  }

  _overlayShell(className) {
    const canvas = h("canvas", { "aria-hidden": "true" });
    const stage = h("div", { class: "kf-stage" }, canvas);
    const root = h("div", { class: `kf-tc-overlay ${className}` }, stage);
    this.append(root);
    const preview = new ThingPreview(canvas, this.geo);
    return { root, stage, preview };
  }

  _redraw() {
    // Opens with the current outline as shape 1, editable like any shape (move, resize, draw again,
    // delete); more shapes glue on (drawing.js, shape-editor.js). The stored Thing keeps one outline:
    // Done fits the merged drawing to thing size where the thing is.
    const thing = this.thing;
    const drawing = ShapeDrawing.fromOutline(thing.outline);
    const { root, stage, preview } = this._overlayShell("redraw");
    preview.setView(FULL_VIEW);
    const paint = (outline) => preview.draw({ ...thing, outline: outline?.length ? outline : null, eyes: [], legs: [] });
    const pad = document.createElement("kf-draw-pad");
    pad.setAttribute("mode", "outline");
    pad.mode = "outline";
    pad.color = thing.color;
    pad.services = this.services;
    stage.append(pad);
    const note = h("p", { class: "kf-note" });
    const status = h("p", { class: "kf-note kf-tc-shapes", role: "status" });
    let changed = false;
    const close = () => { editor.detach(); root.remove(); this._overlay = null; if (this._dirty) this._render(); };
    const done = h("button", {
      class: "kf-btn primary", type: "button", text: "Done", "data-action": "redraw-done",
      onclick: async () => {
        const merged = drawing.merged;
        if (!changed || merged.length < 3) return close();
        done.disabled = true;
        const cur = this.thing;
        const b = this.geo.bbox(cur.outline);
        const outline = this.geo.fitOutline(merged, { maxW: THING_SIZE.w, maxH: THING_SIZE.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }).map(([x, y]) => [x, y]);
        const snap = (p, poly) => snapPoint(this.geo, p, poly);
        const eyes = refitEyes(cur.eyes ?? [], cur.outline, outline, snap);
        const legs = refitEyes(cur.legs ?? [], cur.outline, outline, snap);
        await this._update({ outline, eyes, legs });
        this._dirty = true;
        close();
      },
    });
    const sync = () => {
      const n = drawing.count;
      const count = n === 1 ? "1 shape" : `${n} shapes`;
      status.textContent = !n ? "Draw a new shape." : drawing.full ? `${count}: that's the most.` : `${count}. Draw more shapes that touch it, or start over.`;
      note.textContent = editor.noteText() ?? "Tap the shape to move it, resize it or draw it again. Its eyes, legs and recordings stay.";
      done.disabled = changed && n === 0;
    };
    const editor = new ShapeEditor({
      drawing,
      pad,
      color: thing.color,
      paint,
      onChange: () => { changed = true; paint(drawing.merged); },
      onRender: sync,
    });
    root.append(
      h("div", { class: "kf-sheet kf-tc-overlay-bar" },
        bodyGuide("Draw the body only, no legs. Its eyes and legs come back by themselves."),
        note, status, editor.warn, editor.selectionRow,
        h("div", { class: "kf-row end" }, editor.undoBtn, editor.restartBtn, h("button", { class: "kf-btn", type: "button", text: "Cancel", onclick: close }), done)),
    );
    editor.mount();
    paint(drawing.merged);
    this._overlay = { close, editor };
  }

  _restamp() {
    const thing = this.thing;
    const stamper = new EyeStamper({
      geo: this.geo,
      thing: { ...thing, eyes: [] },
      holdMs: this.params?.holdMs ?? 1000,
      chime: (kind) => this.services.audio?.chime?.(kind),
      onStamp: () => {},
      onDone: async (eyes) => {
        this._overlay = null;
        if (eyes.length) await this._update({ eyes });
        this._render();
      },
    }).mount(this);
    this._overlay = { close: () => stamper.unmount(), stamper };
  }

  /** Pick how many legs, then tap where each goes (like eyes). Saved on Done; Cancel keeps the old legs. */
  _placeLegs() {
    const thing = this.thing;
    const { root, preview } = this._overlayShell("legs");
    preview.setView(viewFor(thing.outline, { fill: 0.5, centerX: 0.36, geo: this.geo }));
    const close = () => { placer.detach(); root.remove(); this._overlay = null; if (this._dirty) this._render(); };
    const placer = new LegPlacer({
      preview,
      geo: this.geo,
      thing,
      chime: (kind) => this.services.audio?.chime?.(kind),
      onChange: () => this.services.session?.activity?.(),
      buttons: (phase) => [
        h("button", { class: "kf-btn ghost", type: "button", text: "Cancel", "data-action": "cancel-legs", onclick: close }),
        h("button", {
          class: "kf-btn primary", type: "button", text: "Done", "data-action": "done-legs", disabled: phase === "place",
          onclick: async () => {
            await this._update({ legs: placer.legs });
            this._dirty = true;
            close();
          },
        }),
      ],
    });
    root.append(h("div", { class: "kf-sheet kf-tc-overlay-bar" }, placer.panel()));
    requestAnimationFrame(() => placer.redraw());
    this._overlay = { close, placer };
  }

  /** Board point → client point in the open eye stamping or leg placing view (tests). */
  toClient(x, y) {
    return (this._overlay?.stamper ?? this._overlay?.placer?.preview)?.toClient(x, y);
  }

  async _delete() {
    const { store, shell, audio } = this.services;
    const thing = this.thing;
    const name = this.displayName(thing);
    const n = store.clipsFor(thing.id).length;
    const ok = await shell.confirm({
      title: `Delete the ${name}?`,
      body: `This removes its drawing and ${n} recording${n === 1 ? "" : "s"}.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      this._deleting = true;
      const change = await store.deleteThing({ thingId: thing.id });
      audio?.chime?.("poof");
      this._close();
      shell.toast(`Deleted the ${name}`, { undo: () => store.restoreThing(change.removed) });
    } catch (e) {
      this._deleting = false;
      this._error(e);
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true }));
  }

  _error(e) {
    console.warn("kf-thing-card:", e);
    const sheet = this.querySelector(".kf-tc");
    if (!sheet) return;
    let box = sheet.querySelector(".kf-tc-error");
    if (!box) sheet.prepend((box = h("p", { class: "kf-warning kf-tc-error", role: "alert" })));
    box.textContent = e?.code === "quota" ? "The iPad is out of space, so this couldn't be saved." : "Something went wrong saving this. Try again.";
  }
}
