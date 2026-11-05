// <kf-guided-add>: add a thing in eight steps (flow 1; US-3.1–3.5, 3.10, 4.1, 4.2, 4.8).
// Body (draw one or more shapes, glued into one outline, each editable) → Felt → Eyes → Legs → Moves → Name → Ask → Sound, with a step bar.
// Always a way out (playtest 3): ‹ Back steps back on every step (on Body it asks to stop), and ✕ asks
// "Stop adding this animal?" (Keep going / Keep draft / Stop adding, which throws the draft away).
// What covers a step (Klara's eye stamping, that dialog, the name prompt) is the pure machine in
// flow.js. Ask shows the same 1–6 free-text questions as the thing card (kf-thing-card/questions.js),
// kept in the draft until Finish (draft-questions.js). Nothing is added without a name. Enter in a
// text field commits it and closes the keyboard; on Name it also goes on. Finish closes at once and
// saves after. The draft is saved after every step and every kept recording, and an open draft for
// the place is resumed (never past a step whose work is missing, steps.js normalizeDraft).
// Props: `services`, `params = {placeId?, at?: [x, y], holdMs?}`.
// Events: `kf-close` when done (bubbles), `kf-added {thingId}` after a thing was added.
import { h, ensureElement, languageName } from "./dom.js";
import {
  STEPS, STEP_LABELS, THING_SIZE, MOTIONS, newDraft, normalizeDraft, upsertClip, findClip, stripClip,
  latestDraft, canAdvance, DEFAULT_SPOT, cleanNames, cleanCues, refitEyes, validOutline, hasName,
} from "./steps.js";
import { initialFlow, flowReducer, backAction, nextAction, finishAction, emptyDraft, STAMP, LEAVE } from "./flow.js";
import { loadGeometry, snapPoint } from "./geometry.js";
import { ThingPreview, viewFor, FULL_VIEW } from "./preview.js";
import { EyeStamper, attachEyeDrag } from "./eyes.js";
import { ShapeDrawing } from "./drawing.js";
import { ShapeEditor } from "./shape-editor.js";
import { bodyGuide } from "./guide.js";
import { LegPlacer } from "./legs.js";
import { setDraftLine, addDraftQuestion, removeDraftQuestion, draftClips } from "./draft-questions.js";
import { THING_COLORS, hex } from "../../farm/palette.js";
import { editSound } from "../kf-dialog/feedback.js";
import { failMessage } from "../kf-dialog/dom.js";
import { questionsSection } from "../kf-thing-card/questions.js";
import { clipSlot } from "../kf-thing-card/clip-slot.js";

const DEFAULT_MOTION = Object.freeze({ kind: "preset", preset: "walk", params: {} });
const DRAW_FELT = "tan";

/** Enter from a hardware keyboard or the iPad's done / go key, not while an IME is composing. */
const isEnter = (e) => e.key === "Enter" && !e.isComposing && e.keyCode !== 229;

/** The Legs step's way on, by phase: Skip before a count, Spread the rest while legs are missing, else Next. */
function legsButton(phase, { skip, spread, next }) {
  if (phase === "choose-count") return h("button", { class: "kf-btn ghost", type: "button", text: "Skip", "data-action": "skip-legs", onclick: skip });
  if (phase === "placing") return h("button", { class: "kf-btn primary", type: "button", text: "Spread the rest and continue", "data-action": "spread-rest", onclick: spread });
  return h("button", { class: "kf-btn primary", type: "button", text: "Next", "data-action": "next-legs", onclick: next });
}

/** Appends the non-empty children (optional parts of a step are null). */
const fill = (parent, ...children) => parent.append(...children.filter((c) => c != null && c !== false));

export class GuidedAddElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    /** Resolves once the first screen is shown (tests await it). */
    this.ready = null;
    this.draft = null;
    this._saving = Promise.resolve();
    this._stamper = null;
    /** What covers the step: flow.js ({overlay, prompt}). */
    this.flow = initialFlow();
    /** The question being recorded on the Ask step: {language, take}, or null. */
    this._recording = null;
  }

  connectedCallback() {
    this.ready ??= this._start();
  }

  disconnectedCallback() {
    this._stamper?.unmount();
    this._editor?.detach();
    this._legs?.detach();
  }

  /** Runs a flow event and renders the result. */
  _dispatch(event) {
    this.flow = flowReducer(this.flow, event);
    this._render();
  }

  get step() { return STEPS[this.draft?.step ?? 0]; }
  get thing() { return this.draft?.thing; }

  /** Board point → client point on whatever is showing (preview or the eye stamping view). */
  toClient(x, y) {
    return (this._stamper ?? this.preview).toClient(x, y);
  }

  async _start() {
    const { store } = this.services;
    this.placeId = this.params?.placeId ?? store.currentPlace?.id ?? null;
    const [geo] = await Promise.all([
      loadGeometry(),
      ensureElement("kf-draw-pad", () => import("../kf-draw-pad/define.js")),
      ensureElement("kf-recorder", () => import("../kf-recorder/define.js")),
    ]);
    this.geo = geo;
    const langs = store.settings?.languages;
    this.languages = langs?.length ? [...langs] : ["en"];
    this.lang = this.languages[0];
    if (!this.placeId || !store.canAddThing(this.placeId)) return this._renderFull();
    const existing = latestDraft(await store.listDrafts(), this.placeId);
    const held = this._heldSpot();
    this.draft = existing ? normalizeDraft(structuredClone(existing), held ?? [...DEFAULT_SPOT]) : newDraft(this.placeId, held ?? [...DEFAULT_SPOT], !!held);
    this.resumed = !!existing;
    this._render();
  }

  /** The spot the parent held on the board to add a thing there (US-11.3), or null. */
  _heldSpot() {
    const at = this.params?.at;
    if (Array.isArray(at)) return [at[0], at[1]];
    if (at && typeof at.x === "number") return [at.x, at.y];
    return null;
  }

  // ---------- rendering ----------

  _render() {
    this._stamper?.unmount();
    this._stamper = null;
    this._legs?.detach();
    this._legs = null;
    this._editor?.detach();
    this._editor = null;
    this.replaceChildren();
    const step = this.step;
    const index = this.draft.step;
    this.dataset.step = step;
    const canvas = h("canvas", { class: "kf-ga-canvas", "aria-hidden": "true" });
    this.stage = h("div", { class: "kf-stage kf-ga-stage" }, canvas);
    this.preview = new ThingPreview(canvas, this.geo);
    this.errorBox = h("p", { class: "kf-warning kf-ga-error", role: "alert", hidden: true });
    const panel = h("section", { class: `kf-sheet kf-ga-panel ${step}`, "aria-label": `Step ${index + 1} of ${STEPS.length}: ${STEP_LABELS[index]}` });
    this.append(this.stage, this._topBar(), panel);
    this[`_step_${step}`](panel);
    panel.append(this.errorBox);
    this._enterCloses(panel);
    if (this.flow.overlay === LEAVE) this.append(this._leaveDialog());
    this._redraw();
  }

  _redraw() {
    const step = this.step;
    const portrait = this.clientHeight > this.clientWidth;
    let view = FULL_VIEW;
    if (step !== "draw" && this.thing.outline?.length) {
      view = portrait
        ? viewFor(this.thing.outline, { fill: 0.4, centerX: 0.5, centerY: 0.3, geo: this.geo })
        : viewFor(this.thing.outline, { fill: 0.5, centerX: 0.28, geo: this.geo });
    }
    this.preview.setView(view);
    const motion = step === "moves" ? this.thing.motion?.preset : null;
    for (const m of MOTIONS) this.preview.canvas.classList.toggle(m.preset, motion === m.preset);
    if (step === "draw") return this._paintDrawing(this._drawing?.merged);
    if (step === "legs" && this._legs) return this._legs.redraw();
    return this.preview.draw(this.thing, { backdrop: false });
  }

  _topBar() {
    const i = this.draft.step;
    return h(
      "div",
      { class: "kf-ga-top" },
      h("button", { class: "kf-btn", type: "button", text: "‹ Back", "data-action": "back", onclick: () => this._back() }),
      h(
        "div",
        { class: "kf-steps kf-ga-steps", role: "list", "aria-label": "Steps" },
        STEP_LABELS.map((s, k) => h("span", { role: "listitem", class: k === i ? "on" : k < i ? "done" : "", "aria-current": k === i ? "step" : null, text: s })),
      ),
      h("button", { class: "kf-btn icon", type: "button", "aria-label": "Close", text: "✕", "data-action": "close", onclick: () => this._askLeave() }),
    );
  }

  _nextBtn(onclick = () => this._next(), text = "Next") {
    return h("button", { class: "kf-btn primary", type: "button", text, disabled: !canAdvance(this.step, this.thing), onclick });
  }

  _langTabs() {
    if (this.languages.length < 2) return null;
    return h(
      "div",
      { class: "kf-tabs", role: "tablist", "aria-label": "Language" },
      this.languages.map((l) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(l === this.lang), text: languageName(l), onclick: () => { this.lang = l; this._recording = null; this._render(); } }),
      ),
    );
  }

  _recorder({ kind, take = 1, label }) {
    const el = document.createElement("kf-recorder");
    el.services = this.services;
    el.label = label;
    el.clipRef = { thingId: null, language: this.lang, kind, take };
    el.existing = findClip(this.draft.clips, { language: this.lang, kind, take });
    el.dataset.kind = kind;
    el.dataset.take = String(take);
    el.addEventListener("kf-recorded", (e) => this._saveRecording(e.detail));
    return el;
  }

  // ---------- steps ----------

  _step_draw(panel) {
    // Several shapes, glued into one outline (drawing.js); each stays editable (shape-editor.js).
    this._drawing ??= ShapeDrawing.fromOutline(this.thing.outline);
    const drawing = this._drawing;
    const pad = document.createElement("kf-draw-pad");
    pad.setAttribute("mode", "outline");
    pad.mode = "outline";
    pad.color = "dark"; // the pencil line is always ink; the felt (tan until picked) fills the shapes
    pad.services = this.services;
    pad.classList.add("kf-ga-pad");
    this.stage.append(pad);
    const note = h("p", { class: "kf-note" });
    const status = h("p", { class: "kf-note kf-ga-shapes", role: "status" });
    const next = this._nextBtn();
    const sync = () => {
      const n = drawing.count;
      note.textContent = editor.noteText() ?? (!n
        ? "Draw a big shape with a finger or a pencil. Small gaps close by themselves."
        : "Add a head, ears or horns: draw them over the body and they join it. Tap a shape to change it.");
      status.textContent = !n ? "" : drawing.full ? `${n} shapes: that's the most.` : n === 1 ? "1 shape" : `${n} shapes`;
      status.hidden = !n;
      next.disabled = !canAdvance("draw", this.thing);
    };
    const editor = new ShapeEditor({
      drawing,
      pad,
      color: this.thing.color ?? DRAW_FELT,
      paint: (outline) => this._paintDrawing(outline),
      onChange: () => this._applyDrawing(),
      onRender: sync,
    });
    this._editor = editor;
    fill(panel,
      h("h2", { text: "Draw the body" }),
      bodyGuide(),
      note,
      status,
      editor.warn,
      editor.selectionRow,
      h("div", { class: "kf-row end" }, editor.undoBtn, editor.restartBtn, next),
    );
    editor.mount();
  }

  /** The drawing so far, at the size it was drawn, in felt (tan until a felt is picked). */
  _paintDrawing(outline) {
    return this.preview.draw({ ...this.thing, outline: outline?.length ? outline : null, eyes: [], legs: [], color: this.thing.color ?? DRAW_FELT }, { backdrop: false });
  }

  /** Fits the merged drawing to thing size at the spot and keeps the eyes on it, then repaints. */
  _applyDrawing() {
    const merged = this._drawing?.merged ?? [];
    const old = this.thing.outline;
    if (merged.length < 3) {
      this.thing.outline = null;
    } else {
      const [cx, cy] = this.draft.at;
      // always the default size; resizing is the edit-mode scale tool (playtest 3)
      const outline = this.geo.fitOutline(merged, { maxW: THING_SIZE.w, maxH: THING_SIZE.h, cx, cy }).map(([x, y]) => [x, y]);
      if (old?.length && this.thing.eyes.length) this.thing.eyes = refitEyes(this.thing.eyes, old, outline, (p, poly) => snapPoint(this.geo, p, poly));
      if (old?.length && this.thing.legs?.length) this.thing.legs = refitEyes(this.thing.legs, old, outline, (p, poly) => snapPoint(this.geo, p, poly));
      this.thing.outline = outline;
    }
    this._redraw();
  }

  _step_felt(panel) {
    // One felt for the whole animal (a Thing has one colour): the copy says so, so a pick never
    // looks like it changed "a random part" (playtest 3). The preview repaints in the same tap.
    fill(panel,
      h("h2", { text: "Pick its felt" }),
      h("p", { class: "kf-note", text: "The whole animal is made of this felt." }),
      h(
        "div",
        { class: "kf-swatches", role: "group", "aria-label": "Felt colour" },
        THING_COLORS.map((key) =>
          h("button", {
            class: "kf-swatch", type: "button", "aria-label": key, "data-color": key, "aria-pressed": String(this.thing.color === key),
            style: { background: hex(key) },
            onclick: () => { this.thing.color = key; this._render(); this._save(); },
          }),
        ),
      ),
      h("div", { class: "kf-row end" }, this._nextBtn()),
    );
  }

  _step_eyes(panel) {
    // Playtest 3 dead end: Eyes used to open Klara's full-screen stamping at once, where only 1 s holds
    // do anything. Now the panel (with ‹ Back and ✕) always shows first: the parent taps the body to
    // put an eye on, or opens stamping for Klara. Without a body there is nothing to stamp on, so the
    // step says so and offers the way back to Body.
    if (!validOutline(this.thing.outline)) {
      fill(panel,
        h("h2", { text: "Eyes" }),
        h("p", { class: "kf-note", text: "Eyes go on the body, and there is no body yet. Draw it first." }),
        h("div", { class: "kf-row end" }, h("button", { class: "kf-btn primary", type: "button", text: "Draw the body", "data-action": "draw-body", onclick: () => this._go(0) })),
      );
      return;
    }
    const n = this.thing.eyes.length;
    fill(panel,
      h("h2", { text: "Eyes" }),
      h("p", { class: "kf-note", text: n ? `${n === 1 ? "One eye" : "Two eyes"}. Drag an eye to move it, or tap to move the oldest.` : "Tap the body where an eye goes, or let Klara stamp them. No eyes is fine too." }),
      h(
        "div",
        { class: "kf-row end" },
        h("button", { class: "kf-btn", type: "button", text: "Undo eye", disabled: !n, onclick: () => { this.thing.eyes = this.thing.eyes.slice(0, -1); this._save(); this._render(); } }),
        h("button", { class: "kf-btn", type: "button", text: "Let Klara stamp", "data-action": "stamp-eyes", onclick: () => this._dispatch({ type: "stamp", canStamp: validOutline(this.thing.outline) }) }),
        this._nextBtn(),
      ),
    );
    const placed = (eyes) => {
      const changed = eyes.length !== this.thing.eyes.length;
      this.thing.eyes = eyes;
      if (changed) {
        this.services.audio?.chime?.("tap");
        this._render(); // the note and Undo eye follow the count
      } else {
        this._redraw();
      }
      this._save();
    };
    attachEyeDrag(
      this.preview, this.geo, () => this.thing,
      (eyes) => { this.thing.eyes = eyes; this._redraw(); },
      placed,
      { stamp: true },
    );
    if (this.flow.overlay === STAMP) {
      this._stamper = new EyeStamper({
        geo: this.geo,
        thing: this.thing,
        holdMs: this.params?.holdMs ?? 1000,
        chime: (kind) => this.services.audio?.chime?.(kind),
        onStamp: (eyes) => { this.thing.eyes = eyes; this._save(); },
        onDone: (eyes) => this._stampEnded(eyes),
        onCancel: (before) => this._stampEnded(before),
      }).mount(this);
    }
  }

  /** Done keeps the stamped eyes, Cancel the ones from before; either way back to the Eyes panel. */
  _stampEnded(eyes) {
    this._stamper = null;
    this.thing.eyes = eyes;
    this._save();
    this._dispatch({ type: "stampEnded" });
  }

  _step_legs(panel) {
    // Leaving never ends with fewer legs than chosen: while legs are missing the button spreads the
    // rest (the placed ones stay) and moves on; Skip leaves the count unpicked.
    const next = () => this._next();
    const spreadAndNext = () => {
      this._legs?.spreadRest();
      next();
    };
    this._legs = new LegPlacer({
      preview: this.preview,
      geo: this.geo,
      thing: this.thing,
      target: this.thing.legTarget,
      drawOpts: { backdrop: false },
      chime: (kind) => this.services.audio?.chime?.(kind),
      onChange: (st) => {
        this.thing.legs = st.legs;
        this.thing.legTarget = st.target;
        this.services.session?.activity?.();
        this._save();
      },
      buttons: (phase) => [legsButton(phase, { skip: next, spread: spreadAndNext, next })],
    });
    fill(panel, this._legs.panel());
  }

  _step_moves(panel) {
    const cur = this.thing.motion?.preset;
    fill(panel,
      h("h2", { text: "How does it move?" }),
      h(
        "div",
        { class: "kf-row", role: "group", "aria-label": "Motion" },
        MOTIONS.map((m) =>
          h("button", {
            class: "kf-btn kf-ga-motion", type: "button", "data-motion": m.preset, "aria-pressed": String(cur === m.preset), text: `${m.icon} ${m.label}`,
            onclick: () => { this.thing.motion = { kind: "preset", preset: m.preset, params: {} }; this._render(); },
          }),
        ),
      ),
      h("p", { class: "kf-note", text: "Walks: legs swing. Hops: jumps along. Scuttles: quick little steps. Floats: a gentle bob, good for objects." }),
      h("div", { class: "kf-row end" }, this._nextBtn()),
    );
  }

  _step_name(panel) {
    const lang = this.lang;
    const label = () => `Record its name. Say just the word, slowly and clearly: “${(this.thing.names[lang] ?? "").trim() || "…"}”`;
    const rec = this._recorder({ kind: "name", take: 1, label: label() });
    const prompt = h("p", { class: "kf-warning kf-ga-name-needed", role: "alert", text: "Give it a name first. Type it above, in any language.", hidden: this.flow.prompt !== "name" });
    const input = h("input", {
      type: "text", name: "name", value: this.thing.names[lang] ?? "", autocomplete: "off", autocapitalize: "words", enterkeyhint: "next", spellcheck: "false",
      oninput: (e) => {
        this.thing.names[lang] = e.target.value;
        rec.label = label();
        if (hasName(this.thing)) {
          // the prompt goes as soon as there is a name; no rebuild, so the keyboard stays up
          this.flow = flowReducer(this.flow, { type: "named" });
          prompt.hidden = this.flow.prompt !== "name";
        }
      },
      onchange: () => this._save(),
    });
    // Enter (hardware keyboard, or the iPad's next / go key) commits the name, closes the keyboard and
    // goes on; with no name it closes the keyboard and asks for one (playtest 3).
    const commit = (e) => {
      e.preventDefault();
      this.thing.names[lang] = input.value;
      input.blur();
      this._next({ focus: false });
    };
    input.addEventListener("keydown", (e) => { if (isEnter(e)) commit(e); });
    const form = h("form", { class: "kf-ga-name-form", action: "", onsubmit: commit },
      h("label", { class: "kf-field" }, h("span", { text: `Name in ${languageName(lang)}` }), input));
    fill(panel,
      h("h2", { text: "What is it called?" }),
      this._langTabs(),
      form,
      prompt,
      h("p", { class: "kf-note", text: "For you and the question scripts. Klara never sees text." }),
      rec,
      h("div", { class: "kf-row end" }, this._nextBtn()),
    );
  }

  _step_ask(panel) {
    // Nothing recorded yet: the iPad voice asks instead, so going on is a skip and says so.
    const recorded = draftClips(this.draft, { language: this.lang, kind: "prompt" }).length > 0;
    fill(panel,
      h("h2", { text: "Ask for it" }),
      this._langTabs(),
      questionsSection({
        store: this._questionStore(),
        scripts: this.services.scripts,
        thing: { ...this.thing, id: null },
        lang: this.lang,
        busy: !!this._recording,
        slot: (take, line) => this._questionSlot(take, line),
        onArticle: (article) => this._setArticle(article),
        onError: (e) => this._error(e),
      }),
      h("div", { class: "kf-row end" }, this._nextBtn(undefined, recorded ? "Next" : "Skip for now")),
    );
  }

  /**
   * What questionsSection needs from a store, over the draft: every edit changes the draft, shows at
   * once, then saves (the thing is not in the farm until Finish).
   */
  _questionStore() {
    // `rebuild: false` for new words: the field the parent typed in already shows them and nothing
    // else on the panel depends on them, while rebuilding the panel as the field lets go would
    // swallow the tap that took the focus away (Record, the next field). An open recorder shows the
    // old words, so it closes and the panel rebuilds.
    const edit = (fn, { rebuild = true } = {}) => (args) => {
      try {
        const next = fn({ thing: this.thing, clips: this.draft.clips }, args);
        this.draft.thing = next.thing;
        this.draft.clips = next.clips;
        if (rebuild || this._recording) {
          this._recording = null; // a rebuilt panel cannot keep a take going; the old clip stays
          this._render();
        }
        return this._save();
      } catch (e) {
        return Promise.reject(e);
      }
    };
    return {
      clipsFor: (_thingId, filter) => draftClips(this.draft, filter),
      setQuestionLine: edit(setDraftLine, { rebuild: false }),
      addQuestion: edit(addDraftQuestion),
      removeQuestion: edit(removeDraftQuestion),
    };
  }

  /** Record / Re-record / ▶ for question `take`; the open recorder shows the words to say. */
  _questionSlot(take, line) {
    const lang = this.lang;
    const clip = findClip(this.draft.clips, { language: lang, kind: "prompt", take });
    const open = this._recording?.language === lang && this._recording.take === take;
    return clipSlot({
      services: this.services,
      clip,
      kind: "prompt",
      take,
      what: `question ${take}`,
      recordText: clip ? "Re-record" : "Record",
      cue: open ? line : "",
      open,
      clipRef: { thingId: null, language: lang, kind: "prompt", take },
      onOpen: () => { this._recording = { language: lang, take }; this._render(); },
      onCancel: () => { this._recording = null; this._render(); },
      onRecorded: (detail) => this._saveRecording(detail),
    });
  }

  _setArticle(article) {
    const cue = (this.thing.cues[this.lang] ??= {});
    if (article) cue.article = article;
    else delete cue.article;
    this._render();
    this._save();
  }

  _step_sound(panel) {
    const name = (this.thing.names[this.lang] ?? "").trim();
    fill(panel,
      h("h2", { text: name ? `What does the ${name} say?` : "What does it say?" }),
      h("p", { class: "kf-note", text: "Optional. Make its sound, as silly as you like." }),
      this._recorder({ kind: "sound", take: 1, label: "Make its sound, not its name (moo! cluck!)" }),
      h(
        "div",
        { class: "kf-row end" },
        h("button", { class: "kf-btn ghost", type: "button", text: "Skip", onclick: () => this._tryFinish() }),
        h("button", { class: "kf-btn primary", type: "button", text: "Finish", onclick: () => this._tryFinish() }),
      ),
    );
  }

  /**
   * Enter in any other text field of a step (the Ask questions) commits it the way leaving the field
   * does and closes the iPad keyboard. The Name field handles its own Enter (it also goes on).
   */
  _enterCloses(panel) {
    for (const input of panel.querySelectorAll('input[type="text"]')) if (!input.enterKeyHint) input.enterKeyHint = "done";
    panel.addEventListener("keydown", (e) => {
      const t = e.target;
      if (!isEnter(e) || e.defaultPrevented || !(t instanceof HTMLInputElement) || t.name === "name") return;
      e.preventDefault();
      t.blur();
    });
  }

  // ---------- leaving ----------

  /** ‹ Back: the step before; on the first step, the same question as ✕. */
  _back() {
    const a = backAction(this.draft.step);
    if (a.type === "go") return this._go(a.step);
    return this._askLeave();
  }

  /** ✕: asks whether to stop; with nothing drawn, named or recorded there is nothing to ask about. */
  _askLeave() {
    if (emptyDraft(this.draft)) return this._discard();
    document.activeElement?.blur?.(); // the keyboard goes down so the whole dialog shows
    this._dispatch({ type: "close" });
    this.querySelector(".kf-ga-leave [data-default]")?.focus();
  }

  _leaveDialog() {
    return h(
      "div",
      { class: "kf-ga-dim" },
      h(
        "section",
        { class: "kf-sheet center kf-ga-leave", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "kf-ga-leave-title" },
        h("h2", { id: "kf-ga-leave-title", text: "Stop adding this animal?" }),
        h("p", { text: "Stop adding throws it away. Keep draft saves it, so you can finish it later with + Add." }),
        h(
          "div",
          { class: "kf-row end" },
          h("button", { class: "kf-btn ghost", type: "button", text: "Keep going", "data-action": "keep-going", onclick: () => this._dispatch({ type: "stay" }) }),
          h("button", { class: "kf-btn", type: "button", text: "Keep draft", "data-action": "keep-draft", "data-default": true, onclick: () => this._keepDraft() }),
          h("button", { class: "kf-btn danger", type: "button", text: "Stop adding", "data-action": "stop-adding", onclick: () => this._discard() }),
        ),
      ),
    );
  }

  async _keepDraft() {
    try {
      await this._save();
      this._close();
    } catch (e) {
      this._error(e);
    }
  }

  async _discard() {
    try {
      await this._saving;
      if (this.draft.id) await this.services.store.discardDraft(this.draft.id);
      this._close();
    } catch (e) {
      this._error(e);
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true }));
  }

  // ---------- data ----------

  _go(index, { prompt = null } = {}) {
    if (index < 0 || index >= STEPS.length) return;
    const forward = index > this.draft.step;
    if (index !== this.draft.step) editSound(this.services, forward ? "next" : "back");
    this.draft.step = index;
    this._recording = null;
    this.flow = flowReducer(this.flow, { type: "step" });
    if (prompt) this.flow = flowReducer(this.flow, { type: prompt });
    this.services.session?.activity?.();
    this._save();
    this._render();
  }

  /** Next: the next step, or, past Name with no name, the prompt (the field gets the focus after a tap). */
  _next({ focus = true } = {}) {
    const a = nextAction(this.draft.step, this.thing);
    if (a.type === "go") return this._go(a.step);
    this._go(a.step, { prompt: "needName" });
    if (focus) this.querySelector('input[name="name"]')?.focus();
  }

  /** Finish (or Skip on Sound): nothing is added without a name; the parent is sent to Name and asked. */
  _tryFinish() {
    const a = finishAction(this.thing);
    if (a.type === "finish") return this._finish();
    this._go(a.step, { prompt: "needName" });
    this.querySelector('input[name="name"]')?.focus();
  }

  /** Saves the draft; saves run one after another. Resolves after this save has committed. */
  _save() {
    const run = this._saving.then(async () => {
      const { id, placeId, step, at, held, thing, clips } = this.draft;
      const saved = await this.services.store.saveDraft(structuredClone({ id, placeId, step, at, held, thing, clips }));
      this.draft.id = saved.id;
      this.draft.updatedAt = saved.updatedAt;
    });
    this._saving = run.catch((e) => this._error(e));
    return run;
  }

  /**
   * A take finished (every good take is kept). The draft shows it at once (an open question
   * recorder closes now, never after the disk write); then its blob is stored, then the draft that
   * references it, in the save queue so no save can reference a blob that is not stored yet.
   */
  _saveRecording(detail) {
    const { clip, blob } = detail ?? {};
    if (!clip) return Promise.resolve();
    this.draft.clips = upsertClip(this.draft.clips, stripClip({ ...clip, language: clip.language ?? this.lang }));
    if (this._recording) {
      this._recording = null;
      this._render();
    }
    if (blob) {
      const put = this._saving.then(() => this.services.store.putBlob(blob));
      this._saving = put.catch((e) => this._error(e));
    }
    return this._save().catch((e) => this._error(e));
  }

  /**
   * Finish: the store shows the new thing at once, so the sheet closes and the chime plays right
   * after the tap (AGENTS.md rule 5: never await before closing UI). The commit and the draft's
   * removal finish afterwards; a refused thing (scene full) keeps the sheet open instead.
   */
  _finish() {
    if (this._finishing) return;
    this._finishing = true;
    const { store } = this.services;
    const t = this.thing;
    const before = store.snapshot?.things ?? [];
    let committed;
    try {
      committed = store.addThing({
        placeId: this.placeId,
        names: cleanNames(t.names),
        outline: t.outline,
        color: t.color,
        eyes: t.eyes,
        legs: t.legs ?? [],
        motion: t.motion ?? DEFAULT_MOTION,
        cues: cleanCues(t.cues),
        clips: this.draft.clips.map(stripClip),
        // a held spot is the parent's choice; otherwise it lands like a library copy, beside the
        // animals where they stand now and on the ground
        ...(this.draft.held ? {} : { spot: "free" }),
      });
    } catch (e) {
      committed = Promise.reject(e);
    }
    const added = (store.snapshot?.things ?? []).find((thing) => !before.includes(thing));
    if (!added) return this._finishRefused(committed);
    this._announce(added.id);
    return this._afterFinish(committed);
  }

  /** The new thing drops onto the board with a chime and the sheet closes; one failing step never keeps it open. */
  _announce(thingId) {
    const { engine, audio } = this.services;
    try {
      engine?.dropIn?.(thingId);
      audio?.chime?.("plink");
      this.dispatchEvent(new CustomEvent("kf-added", { bubbles: true, detail: { thingId } }));
    } catch (e) {
      console.warn("kf-guided-add:", e);
    } finally {
      this._close();
    }
  }

  /** The store did not take the thing on the spot: the sheet stays and says why. */
  async _finishRefused(committed) {
    try {
      const change = await committed; // only when the store queued it behind a replace
      this._announce(change.ids[0]);
      await this._dropDraft();
    } catch (e) {
      this._finishing = false;
      if (e?.code === "place-full") this._renderFull();
      else this._error(e);
    }
  }

  /** After the sheet closed: once the thing is saved the draft goes; if it was not, the draft stays. */
  async _afterFinish(committed) {
    try {
      await committed;
    } catch (e) {
      console.warn("kf-guided-add:", e);
      const msg = e?.code === "quota" ? failMessage(e) : "The new thing didn't save. It's kept as a draft: tap + to finish it.";
      this.services.shell?.toast?.(msg);
      return;
    }
    try {
      await this._dropDraft();
    } catch (e) {
      console.warn("kf-guided-add: draft not removed", e);
    }
  }

  /** Removes the draft after any save still running, so that save cannot bring it back. */
  async _dropDraft() {
    await this._saving;
    if (this.draft.id) await this.services.store.discardDraft(this.draft.id);
  }

  _renderFull() {
    this.replaceChildren(
      h(
        "section",
        { class: "kf-sheet center", role: "alertdialog", "aria-labelledby": "kf-ga-full" },
        h("h2", { id: "kf-ga-full", text: "This scene is full" }),
        h("p", { text: `This scene already has ${this.services.store.maxThings ?? 8} things, the most it can hold, so Klara is never overwhelmed. Delete one, or allow more in Settings.` }),
        h("div", { class: "kf-row end" }, h("button", { class: "kf-btn primary", type: "button", text: "OK", onclick: () => this._close() })),
      ),
    );
    this.dataset.step = "full";
  }

  _error(e) {
    const msg = e?.code === "quota" ? "The iPad is out of space, so this couldn't be saved." : "Something went wrong saving this. Try again.";
    if (this.errorBox) {
      this.errorBox.textContent = msg;
      this.errorBox.hidden = false;
    }
    console.warn("kf-guided-add:", e);
  }
}
