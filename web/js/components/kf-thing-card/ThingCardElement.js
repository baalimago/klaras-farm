// <kf-thing-card>: everything about one thing on one card (flow 2; US-3.6–3.8, 4.5, 4.7, 9.1).
// One tab per language (typed name, name clip, 1–6 free-text questions with recordings) plus
// "+ Language"; one sound for every language; felt colour, motion, Redraw, Re-stamp eyes, Place
// legs, Delete with confirm and Undo. Size is not here: animals are resized with the edit-mode scale tool.
// Every recording slot says what Klara hears for it now (play/voice.js, the rule play uses): "Your
// recording" with ▶, or the iPad voice with an invitation to record. A new take replaces the old one.
// An empty name field is highlighted ("Give it a name"); Enter in any text field commits it and
// closes the keyboard. Changes save immediately; there is no Save button. After a change, "Undo
// changes" puts the thing back as it was when the card opened (revert.js; recordings stay), with a
// toast that can take that back too. Props: `services`, `params = {thingId}`.
import { h, ensureElement, languageName } from "../kf-guided-add/dom.js";
import { loadGeometry, snapPoint } from "../kf-guided-add/geometry.js";
import { ThingPreview, viewFor, FULL_VIEW } from "../kf-guided-add/preview.js";
import { EyeStamper } from "../kf-guided-add/eyes.js";
import { ShapeDrawing } from "../kf-guided-add/drawing.js";
import { ShapeEditor } from "../kf-guided-add/shape-editor.js";
import { bodyGuide } from "../kf-guided-add/guide.js";
import { LegPlacer } from "../kf-guided-add/legs.js";
import { MOTIONS, stripClip, refitEyes, sizeScale, sizeBox, sizedFill } from "../kf-guided-add/steps.js";
import { languageOptions } from "./languages.js";
import { THING_COLORS, hex } from "../../farm/palette.js";
import { cueLines } from "../../farm/scripts.js";
import { clipSlot } from "./clip-slot.js";
import { questionsSection } from "./questions.js";
import { pressGuard } from "../kf-dialog/press-guard.js";
import { commitOnEnter } from "./enter.js";
import { nameVoice, soundVoice } from "../../play/voice.js";
import { lineVoiceText } from "./clip-slot.js";
import { changedFields, revertPatch } from "./revert.js";
import { reportFailure } from "../kf-dialog/dom.js";

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
    /** The thing as it was when the card opened, for Undo changes. */
    this._original = null;
    /** Scroll the recorder that is opening into view on the next render. */
    this._reveal = false;
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
    // A render asked for mid-tap waits until that tap's click has run (press-guard.js).
    this._guard = pressGuard(this, () => this._storeChanged());
    this._onStore = () => this._guard.request();
    this._onDecodeFailed = (e) => {
      if (e.detail?.clipId) this._failed.add(e.detail.clipId);
      this._storeChanged();
    };
    store.addEventListener("change", this._onStore);
    audio?.addEventListener?.("decode-failed", this._onDecodeFailed);
    // A field that was being typed in has let go: now the words column can catch up too.
    this.addEventListener("focusout", () => queueMicrotask(() => { if (this._dirty) this._guard.request(); }));
    if (!this.thing) return this._close();
    this._original = structuredClone(this.thing);
    this._render();
  }

  _editing() {
    const a = document.activeElement;
    return !!a && this.contains(a) && a.matches("input, select, textarea");
  }

  /** A full render would rebuild the text field being typed in, the open recorder, or the overlay's page. */
  _canRenderAll() {
    return !this._recording && !this._overlay && !this._editing();
  }

  /** Every store change shows at once (playtest 2). While the parent types in a field or records,
   *  everything but the words column (title, felt, moves, preview) renders now; the words column
   *  follows when the field lets go or the recorder closes. An open overlay re-renders the card
   *  when it closes. */
  _storeChanged() {
    if (!this.isConnected) return;
    if (!this.thing) {
      if (!this._deleting) this._close();
      return;
    }
    if (this._canRenderAll()) return this._render();
    this._dirty = true;
    if (!this._overlay) this._renderAround();
  }

  /** Renders the title and the look column from the store, leaving the words column alone. */
  _renderAround() {
    const thing = this.thing;
    const title = this.querySelector("#kf-tc-title");
    if (title) title.textContent = this.titleText(thing);
    this.querySelector(".kf-tc-revert")?.replaceChildren(...[this._revertBtn(thing)].filter(Boolean));
    const look = this.querySelector(".kf-tc-look");
    if (!look) return;
    look.replaceWith(this._look(thing));
    this._drawPreview();
  }

  displayName(thing = this.thing) {
    const n = thing?.names ?? {};
    return n[this.lang] || n[this.languages[0]] || Object.values(n).find(Boolean) || "thing";
  }

  /** The card's title: its name, or "No name yet" so a nameless thing is obvious (QA round 3). */
  titleText(thing = this.thing) {
    return Object.values(thing?.names ?? {}).some(Boolean) ? this.displayName(thing) : "No name yet";
  }

  get canSpeak() { return this.services?.audio?.canSpeak !== false; }

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
        h("h2", { id: "kf-tc-title", text: this.titleText(thing) }),
        h("div", { class: "kf-row kf-tc-head-end" },
          h("span", { class: "kf-tc-revert" }, this._revertBtn(thing)),
          h("button", { class: "kf-btn icon", type: "button", "aria-label": "Close", text: "✕", onclick: () => this._close() })),
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
    // Only the sheet is replaced: an open overlay (eyes, legs, redraw) stays on top of it. The new
    // sheet keeps the old one's scroll position, so an edit never jumps the parent back to the top.
    const scroll = this._sheet?.scrollTop ?? 0;
    if (this._sheet?.parentNode === this) this._sheet.replaceWith(sheet);
    else this.prepend(sheet);
    this._sheet = sheet;
    sheet.scrollTop = scroll;
    this._drawPreview();
    if (this._reveal) {
      // A recorder opening low on a scrolled card would show half cut off (QA round 3).
      this._reveal = false;
      sheet.querySelector(".kf-tc-recorder")?.scrollIntoView({ block: "nearest" });
    }
  }

  /** "Undo changes", in the head beside ✕ where it is seen at once; only once the thing has changed. */
  _revertBtn(thing) {
    if (!changedFields(this._original, thing).length) return null;
    return h("button", { class: "kf-btn", type: "button", text: "Undo changes", "data-action": "revert", onclick: () => this._revert() });
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
    const name = thing.names?.[lang] ?? "";
    return h(
      "div",
      { class: "kf-tc-words", role: "tabpanel", "aria-label": languageName(lang) },
      h("h3", { text: "Name" }),
      h(
        "div",
        { class: "kf-tc-line" },
        // An empty name stands out and says what to do: a nameless thing is easy to miss (QA round 3).
        h("label", { class: `kf-field kf-tc-name${name ? "" : " is-missing"}` },
          h("span", { text: name ? `Name in ${languageName(lang)}` : "Give it a name" }),
          h("input", {
            type: "text", name: "name", value: name, placeholder: name ? null : `Its name in ${languageName(lang)}`,
            "aria-invalid": name ? null : "true",
            autocomplete: "off", autocapitalize: "words", enterkeyhint: "done", spellcheck: "false",
            onkeydown: commitOnEnter,
            onchange: (e) => this._rename(e.target.value),
          })),
        this._clipControls("name", 1),
      ),
      questionsSection({
        store: this.services.store,
        scripts: this.services.scripts,
        thing,
        lang,
        busy: !!this._recording,
        shell: this.services.shell,
        canSpeak: this.canSpeak,
        slot: (take, _line, voice) => this._clipControls("prompt", take, lineVoiceText(voice)),
        onArticle: (article) => this._setCue({ article }),
        onError: (e) => this._error(e),
      }),
      h("h3", { text: "Sound" }),
      h("p", { class: "kf-note", text: "One sound for every language." }),
      h("div", { class: "kf-tc-line" }, this._clipControls("sound", 1)),
    );
  }

  _clips({ kind, take } = {}) {
    return this.services.store.clipsFor(this.thingId, { language: this.lang, kind }).filter((c) => take == null || c.take === take);
  }

  /** This slot's own recording: the sound is one for every language, the rest are per language. */
  _slotClip(kind, take) {
    if (kind === "sound") return soundVoice(this.services.store.snapshot, this.thingId).clip ?? null;
    return this._clips({ kind, take })[0] ?? null;
  }

  /** What Klara hears for the name or the sound right now, in words (play/voice.js). */
  _voice(kind) {
    const snap = this.services.store.snapshot;
    if (kind === "sound") {
      return soundVoice(snap, this.thingId).clip ? { source: "recording", text: "Your recording" } : { source: "none", text: "No sound yet" };
    }
    const v = nameVoice(snap, this.thing, this.lang, this.canSpeak);
    if (v.source === "recording") return { source: v.source, text: "Your recording" };
    if (v.source === "other-language") return { source: v.source, clip: v.clip, text: `Plays your ${languageName(v.clip.language)} recording for now` };
    if (v.source === "voice") return { source: v.source, text: `iPad voice says “${v.text}” for now` };
    return { source: "none", text: "Just a chime for now" };
  }

  _clipControls(kind, take, voice = kind === "prompt" ? null : this._voice(kind)) {
    const clip = this._slotClip(kind, take);
    const open = !!this._recording && this._recording.kind === kind && this._recording.take === take && this._recording.language === this.lang;
    return clipSlot({
      services: this.services,
      clip,
      kind,
      take,
      what: kind === "prompt" ? `question ${take}` : KIND_LABEL[kind],
      recordText: this._recordText(kind, !!clip),
      cue: open ? this._cueFor(kind, take) : "",
      open,
      clipRef: { thingId: this.thingId, language: this.lang, kind, take },
      failed: !!clip && this._failed.has(clip.id),
      voice,
      onOpen: () => { this._recording = { language: this.lang, kind, take }; this._reveal = true; this._render(); },
      onCancel: () => { this._recording = null; this._render(); },
      onRecorded: (detail) => this._saveRecording(detail, { kind, take }),
    });
  }

  /** Say exactly what to record, so the name and the sound are never mixed up. */
  _recordText(kind, again) {
    if (kind === "name") {
      const word = this.thing.names?.[this.lang];
      if (!word) return again ? "Re-record its name" : "Record its name";
      return `${again ? "Re-record" : "Record"}: say “${word}”`;
    }
    if (kind === "sound") return again ? "Re-record its sound" : "Record its sound (moo! cluck!)";
    return again ? "Re-record" : "Record your own";
  }

  _cueFor(kind, take) {
    const thing = this.thing;
    if (kind === "prompt") return cueLines(this.services.scripts ?? {}, thing, this.lang).lines[take - 1] ?? "";
    if (kind === "sound") return `Make the ${this.displayName(thing)}'s sound, not its name (moo! cluck!)`;
    const word = thing.names?.[this.lang];
    return word ? `Say just the word, slowly and clearly: “${word}”` : "Say just its name, slowly and clearly";
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
    this._preview.setView(viewFor(thing.outline, { fill: sizedFill(thing.outline, 0.6), geo: this.geo }));
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
    return this._update({ names }).then(() => { if (title && this.thing) title.textContent = this.titleText(); });
  }

  _setCue(change) {
    const cues = { ...(this.thing.cues ?? {}) };
    const cue = { ...(cues[this.lang] ?? {}), ...change };
    if (!cue.article) delete cue.article;
    cues[this.lang] = cue;
    return this._update({ cues });
  }

  async _addLanguage(lang) {
    if (!lang) return;
    const prev = this.lang;
    this.lang = lang;
    this._addingLang = false;
    const saved = this.services.store.updateSettings({ patch: { languages: [...this.languages, lang] } });
    this._render(); // the store already has the language: the new tab shows now
    try {
      await saved;
    } catch (e) {
      this.lang = prev;
      this._render();
      this._error(e);
    }
  }

  /** A finished take is kept at once: it replaces the old clip now and the recorder closes (US-4.7).
   *  Cancel, or a take that fails its checks, never gets here, so the old clip stays. */
  async _saveRecording(detail, { kind, take }) {
    const { clip, blob } = detail ?? {};
    if (!clip) return;
    const old = this._slotClip(kind, take);
    let saved;
    try {
      saved = this.services.store.saveClip({ clip: { ...stripClip(clip), thingId: this.thingId, language: this.lang, kind, take }, blob });
    } catch (e) {
      saved = Promise.reject(e);
    }
    // The store already shows the new take: close the recorder now, never after the disk write.
    if (old) this._failed.delete(old.id);
    this._recording = null;
    this._render();
    try {
      await saved;
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
    pad.color = "dark"; // the pencil line is always ink, as in guided add: a white felt line would not show
    pad.services = this.services;
    stage.append(pad);
    const note = h("p", { class: "kf-note" });
    const status = h("p", { class: "kf-note kf-tc-shapes", role: "status" });
    let changed = false;
    const close = () => { editor.detach(); root.remove(); this._overlay = null; this._render(); };
    const done = h("button", {
      class: "kf-btn primary", type: "button", text: "Done", "data-action": "redraw-done",
      onclick: () => {
        const merged = drawing.merged;
        if (!changed || merged.length < 3) return close();
        done.disabled = true;
        const cur = this.thing;
        const b = this.geo.bbox(cur.outline);
        const box = sizeBox(sizeScale(cur.outline)); // a redraw keeps the thing's size
        const outline = this.geo.fitOutline(merged, { maxW: box.w, maxH: box.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }).map(([x, y]) => [x, y]);
        const snap = (p, poly) => snapPoint(this.geo, p, poly);
        const eyes = refitEyes(cur.eyes ?? [], cur.outline, outline, snap);
        const legs = refitEyes(cur.legs ?? [], cur.outline, outline, snap);
        this._update({ outline, eyes, legs }); // shows at once; never wait for the disk to close
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
      onDone: (eyes) => {
        this._overlay = null;
        if (eyes.length) this._update({ eyes });
        this._render();
      },
      onCancel: () => {
        this._overlay = null;
        this._render();
      },
    }).mount(this);
    this._overlay = { close: () => stamper.unmount(), stamper };
  }

  /** Choose how many legs, then place them (edit/leg-flow.js). Done saves; Cancel keeps the old legs. */
  _placeLegs() {
    const thing = this.thing;
    const { root, preview } = this._overlayShell("legs");
    preview.setView(viewFor(thing.outline, { fill: 0.5, centerX: 0.36, geo: this.geo }));
    const close = () => { placer.detach(); root.remove(); this._overlay = null; this._render(); };
    const placer = new LegPlacer({
      preview,
      geo: this.geo,
      thing,
      chime: (kind) => this.services.audio?.chime?.(kind),
      onChange: () => this.services.session?.activity?.(),
      buttons: () => [
        h("button", { class: "kf-btn ghost", type: "button", text: "Cancel", "data-action": "cancel-legs", onclick: close }),
        h("button", {
          class: "kf-btn primary", type: "button", text: "Done", "data-action": "done-legs",
          onclick: () => {
            this._update({ legs: placer.legs }); // shows at once; never wait for the disk to close
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

  /**
   * Undo changes: the thing goes back to how it was when the card opened, at once (the store shows
   * it inside the tap); the toast's Undo puts the changes back. Recordings are left as they are.
   */
  _revert() {
    const now = this.thing;
    const patch = revertPatch(this._original, now);
    if (!now || !patch) return;
    const redo = Object.fromEntries(Object.keys(patch).map((k) => [k, structuredClone(now[k])]));
    const { store, shell } = this.services;
    this._update(patch);
    const name = this.displayName(this._original);
    shell?.toast?.(`The ${name} is back as it was`, {
      undo: () => store.updateThing({ thingId: this.thingId, patch: redo }).catch((e) => reportFailure(this.services, e)),
    });
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
