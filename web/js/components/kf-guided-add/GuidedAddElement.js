// <kf-guided-add>: add a thing in eight steps (flow 1; US-3.1–3.5, 3.10, 4.1, 4.2, 4.8).
// Draw (one or more shapes glued into one outline) → Felt → Eyes → Legs → Moves → Name → Ask → Sound, with a step bar, Back and ✕ (Keep draft / Discard)
// on every step. The draft is saved after every step and every kept recording, and an open draft for
// the place is resumed. Props: `services`, `params = {placeId?, at?: [x, y], holdMs?}`.
// Events: `kf-close` when done (bubbles), `kf-added {thingId}` after a thing was added.
import { h, ensureElement, languageName } from "./dom.js";
import {
  STEPS, STEP_LABELS, THING_SIZE, MOTIONS, newDraft, normalizeDraft, upsertClip, findClip, stripClip,
  latestDraft, canAdvance, freeSpot, cleanNames, cleanCues, refitEyes,
} from "./steps.js";
import { loadGeometry, snapPoint } from "./geometry.js";
import { ThingPreview, viewFor, FULL_VIEW } from "./preview.js";
import { EyeStamper, attachEyeDrag } from "./eyes.js";
import { ShapeDrawing } from "./drawing.js";
import { LegPlacer } from "./legs.js";
import { THING_COLORS, hex } from "../../farm/palette.js";
import { cueLines } from "../../farm/scripts.js";

const DEFAULT_MOTION = Object.freeze({ kind: "preset", preset: "walk", params: {} });
const DRAW_FELT = "tan";

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
    this._stamping = false;
    this._leaving = false;
    this._editingLine = false;
    this.askIndex = 0;
  }

  connectedCallback() {
    this.ready ??= this._start();
  }

  disconnectedCallback() {
    this._stamper?.unmount();
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
    const at = this._spot();
    this.draft = existing ? normalizeDraft(structuredClone(existing), at) : newDraft(this.placeId, at);
    this.resumed = !!existing;
    this._render();
  }

  _spot() {
    const at = this.params?.at;
    if (Array.isArray(at)) return [at[0], at[1]];
    if (at && typeof at.x === "number") return [at.x, at.y];
    const centers = this.services.store.thingsIn(this.placeId).map((t) => this.geo.centroid(t.outline));
    return freeSpot(centers);
  }

  // ---------- rendering ----------

  _render() {
    this._stamper?.unmount();
    this._stamper = null;
    this._legs?.detach();
    this._legs = null;
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
    if (this._leaving) this.append(this._leaveDialog());
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
    this.preview.canvas.classList.toggle("walk", motion === "walk");
    this.preview.canvas.classList.toggle("float", motion === "float");
    if (step === "draw") {
      // the shapes so far, merged, at the size they were drawn, in felt (tan until a felt is picked)
      const outline = this._drawing?.merged ?? [];
      return this.preview.draw({ ...this.thing, outline: outline.length ? outline : null, eyes: [], legs: [], color: this.thing.color ?? DRAW_FELT }, { backdrop: false });
    }
    if (step === "legs" && this._legs) return this._legs.redraw();
    return this.preview.draw(this.thing, { backdrop: false });
  }

  _topBar() {
    const i = this.draft.step;
    return h(
      "div",
      { class: "kf-ga-top" },
      h("button", { class: "kf-btn", type: "button", text: "‹ Back", disabled: i === 0, onclick: () => this._go(i - 1) }),
      h(
        "div",
        { class: "kf-steps kf-ga-steps", role: "list", "aria-label": "Steps" },
        STEP_LABELS.map((s, k) => h("span", { role: "listitem", class: k === i ? "on" : k < i ? "done" : "", "aria-current": k === i ? "step" : null, text: s })),
      ),
      h("button", { class: "kf-btn icon", type: "button", "aria-label": "Close", text: "✕", onclick: () => this._askLeave() }),
    );
  }

  _nextBtn(onclick = () => this._go(this.draft.step + 1)) {
    return h("button", { class: "kf-btn primary", type: "button", text: "Next", disabled: !canAdvance(this.step, this.thing), onclick });
  }

  _langTabs() {
    if (this.languages.length < 2) return null;
    return h(
      "div",
      { class: "kf-tabs", role: "tablist", "aria-label": "Language" },
      this.languages.map((l) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(l === this.lang), text: languageName(l), onclick: () => { this.lang = l; this.askIndex = 0; this._render(); } }),
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
    // Several shapes, glued into one outline (drawing.js): every closed stroke is another shape.
    this._drawing ??= ShapeDrawing.fromOutline(this.thing.outline);
    const drawing = this._drawing;
    const pad = document.createElement("kf-draw-pad");
    pad.setAttribute("mode", "outline");
    pad.mode = "outline";
    pad.color = this.thing.color ?? "dark";
    pad.services = this.services;
    pad.classList.add("kf-ga-pad");
    this.stage.append(pad);
    const warn = h("p", { class: "kf-warning", role: "status", hidden: true, text: "Close the outline: the two ends are too far apart. Draw it again." });
    const note = h("p", { class: "kf-note" });
    const status = h("p", { class: "kf-note kf-ga-shapes", role: "status" });
    const next = this._nextBtn();
    const add = h("button", { class: "kf-btn", type: "button", text: "+ Add a shape", "data-action": "add-shape", onclick: () => { addHint = true; sync(); } });
    const undo = h("button", { class: "kf-btn", type: "button", text: "Undo last shape", "data-action": "undo-shape", onclick: () => { if (drawing.undo()) this._applyDrawing(); addHint = false; sync(); } });
    let addHint = false;
    const sync = () => {
      const n = drawing.count;
      note.textContent = !n
        ? "Draw a big shape with a finger or a pencil. Small gaps close by themselves."
        : addHint && !drawing.full
          ? "Draw the next shape on the board, touching the others: a head, ears, a tail…"
          : "Add more shapes that touch it, like a head or ears. They stick together into one.";
      status.textContent = !n ? "" : drawing.full ? `${n} shapes: that's the most.` : n === 1 ? "1 shape" : `${n} shapes`;
      status.hidden = !n;
      add.disabled = !n || drawing.full;
      undo.disabled = !n;
      next.disabled = !canAdvance("draw", this.thing);
    };
    pad.addEventListener("kf-stroke", (e) => {
      const pts = e.detail?.points;
      if (!Array.isArray(pts) || pts.length < 3) return;
      warn.hidden = true;
      addHint = false;
      if (drawing.add(pts)) this._applyDrawing();
      sync();
    });
    pad.addEventListener("kf-stroke-open", () => { warn.hidden = false; });
    sync();
    fill(panel,
      h("h2", { text: "Draw its shape" }),
      note,
      status,
      warn,
      h("div", { class: "kf-row end" }, add, undo, next),
    );
  }

  /** Fits the merged drawing to thing size at the spot and keeps the eyes on it, then repaints. */
  _applyDrawing() {
    const merged = this._drawing?.merged ?? [];
    const old = this.thing.outline;
    if (merged.length < 3) {
      this.thing.outline = null;
    } else {
      const [cx, cy] = this.draft.at;
      const outline = this.geo.fitOutline(merged, { maxW: THING_SIZE.w, maxH: THING_SIZE.h, cx, cy }).map(([x, y]) => [x, y]);
      if (old?.length && this.thing.eyes.length) this.thing.eyes = refitEyes(this.thing.eyes, old, outline, (p, poly) => snapPoint(this.geo, p, poly));
      if (old?.length && this.thing.legs?.length) this.thing.legs = refitEyes(this.thing.legs, old, outline, (p, poly) => snapPoint(this.geo, p, poly));
      this.thing.outline = outline;
    }
    this._redraw();
  }

  _step_felt(panel) {
    fill(panel,
      h("h2", { text: "Pick its felt" }),
      h(
        "div",
        { class: "kf-swatches", role: "group", "aria-label": "Felt colour" },
        THING_COLORS.map((key) =>
          h("button", {
            class: "kf-swatch", type: "button", "aria-label": key, "data-color": key, "aria-pressed": String(this.thing.color === key),
            style: { background: hex(key) },
            onclick: () => { this.thing.color = key; this._render(); },
          }),
        ),
      ),
      h("div", { class: "kf-row end" }, this._nextBtn()),
    );
  }

  _step_eyes(panel) {
    const n = this.thing.eyes.length;
    fill(panel,
      h("h2", { text: "Eyes" }),
      h("p", { class: "kf-note", text: n ? `${n === 1 ? "One eye" : "Two eyes"}. Drag an eye to move it.` : "No eyes yet. That's fine too." }),
      h(
        "div",
        { class: "kf-row end" },
        h("button", { class: "kf-btn", type: "button", text: "Undo eye", disabled: !n, onclick: () => { this.thing.eyes = this.thing.eyes.slice(0, -1); this._save(); this._render(); } }),
        h("button", { class: "kf-btn", type: "button", text: "Let Klara stamp", onclick: () => { this._stamping = true; this._render(); } }),
        this._nextBtn(),
      ),
    );
    attachEyeDrag(
      this.preview, this.geo, () => this.thing,
      (eyes) => { this.thing.eyes = eyes; this._redraw(); },
      (eyes) => { this.thing.eyes = eyes; this._save(); this._redraw(); },
    );
    if (this._stamping) {
      this._stamper = new EyeStamper({
        geo: this.geo,
        thing: this.thing,
        holdMs: this.params?.holdMs ?? 1000,
        chime: (kind) => this.services.audio?.chime?.(kind),
        onStamp: (eyes) => { this.thing.eyes = eyes; this._save(); },
        onDone: () => { this._stamping = false; this._render(); },
      }).mount(this);
    }
  }

  _step_legs(panel) {
    const next = () => this._go(this.draft.step + 1);
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
      buttons: (phase) => [
        h("button", { class: "kf-btn ghost", type: "button", text: "Skip", "data-action": "skip-legs", onclick: next }),
        phase === "count" ? null : h("button", { class: "kf-btn primary", type: "button", text: "Next", disabled: phase === "place", onclick: next }),
      ],
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
      h("p", { class: "kf-note", text: "Walks: squash and stretch, legs swing. Floats: a gentle bob, good for objects." }),
      h("div", { class: "kf-row end" }, this._nextBtn()),
    );
  }

  _step_name(panel) {
    const lang = this.lang;
    const label = () => `Record its name. Say just the word, slowly and clearly: “${(this.thing.names[lang] ?? "").trim() || "…"}”`;
    const rec = this._recorder({ kind: "name", take: 1, label: label() });
    const input = h("input", {
      type: "text", name: "name", value: this.thing.names[lang] ?? "", autocomplete: "off", autocapitalize: "words", enterkeyhint: "done", spellcheck: "false",
      oninput: (e) => { this.thing.names[lang] = e.target.value; rec.label = label(); },
      onchange: () => this._save(),
    });
    fill(panel,
      h("h2", { text: "What is it called?" }),
      this._langTabs(),
      h("label", { class: "kf-field" }, h("span", { text: `Name in ${languageName(lang)}` }), input),
      h("p", { class: "kf-note", text: "For you and the question scripts. Klara never sees text." }),
      rec,
      h("div", { class: "kf-row end" }, this._nextBtn()),
    );
  }

  _step_ask(panel) {
    const lang = this.lang;
    const cue = (this.thing.cues[lang] ??= {});
    const { lines, fallback, articles } = cueLines(this.services.scripts ?? {}, this.thing, lang);
    const q = Math.min(this.askIndex, Math.max(0, lines.length - 1));
    const line = lines[q] ?? "";
    const recorded = [1, 2, 3].filter((take) => findClip(this.draft.clips, { language: lang, kind: "prompt", take })).length;
    this._askStatus = h("p", { class: "kf-note kf-ga-count", role: "status", text: `Recorded ${recorded} of 3` });

    const cueBox = this._editingLine
      ? h("label", { class: "kf-field" }, h("span", { text: `Question ${q + 1} words` }),
          h("input", {
            type: "text", name: "cue", value: line,
            onchange: (e) => {
              const prev = cue.lines ?? ["", "", ""];
              cue.lines = [0, 1, 2].map((i) => (i === q ? e.target.value : (prev[i] ?? "")));
              this._editingLine = false;
              this._save();
              this._render();
            },
          }))
      : h("blockquote", { class: "kf-ga-cue", text: `“${line}”` });

    fill(panel,
      h("h2", { text: "Ask for it" }),
      this._langTabs(),
      fallback ? h("p", { class: "kf-warning", text: `No script for ${languageName(lang)} yet: say this in your language.` }) : null,
      articles.length
        ? h("label", { class: "kf-field" }, h("span", { text: "Article" }),
            h("select", {
              name: "article",
              onchange: (e) => { if (e.target.value) cue.article = e.target.value; else delete cue.article; this._save(); this._render(); },
            }, h("option", { value: "", text: "(none)", selected: !cue.article }), articles.map((a) => h("option", { value: a, text: a, selected: cue.article === a }))))
        : null,
      h("p", { class: "kf-note", text: `Question ${q + 1} of 3 · say it like you would to Klara` }),
      cueBox,
      this._editingLine ? null : h("button", { class: "kf-btn ghost", type: "button", text: "✎ Change the words", onclick: () => { this._editingLine = true; this._render(); } }),
      q < 2 ? h("p", { class: "kf-note", text: `Next: ${lines.slice(q + 1).map((l) => `“${l}”`).join(" · ")}` }) : null,
      this._recorder({ kind: "prompt", take: q + 1, label: line }),
      this._askStatus,
      h(
        "div",
        { class: "kf-row end" },
        h("button", { class: "kf-btn ghost", type: "button", text: "Skip for now", onclick: () => this._go(this.draft.step + 1) }),
        q > 0 ? h("button", { class: "kf-btn", type: "button", text: "Previous question", onclick: () => { this.askIndex = q - 1; this._editingLine = false; this._render(); } }) : null,
        this._nextBtn(() => {
          this._editingLine = false;
          if (q < 2) { this.askIndex = q + 1; this._render(); } else this._go(this.draft.step + 1);
        }),
      ),
    );
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
        h("button", { class: "kf-btn ghost", type: "button", text: "Skip", onclick: () => this._finish() }),
        h("button", { class: "kf-btn primary", type: "button", text: "Finish", onclick: () => this._finish() }),
      ),
    );
  }

  // ---------- leaving ----------

  _askLeave() {
    this._leaving = true;
    this._render();
    this.querySelector(".kf-ga-leave [data-default]")?.focus();
  }

  _leaveDialog() {
    return h(
      "div",
      { class: "kf-ga-dim" },
      h(
        "section",
        { class: "kf-sheet center kf-ga-leave", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "kf-ga-leave-title" },
        h("h2", { id: "kf-ga-leave-title", text: "Stop adding this thing?" }),
        h("p", { text: "Keep it as a draft to finish later, or throw it away." }),
        h(
          "div",
          { class: "kf-row end" },
          h("button", { class: "kf-btn ghost", type: "button", text: "Keep going", onclick: () => { this._leaving = false; this._render(); } }),
          h("button", { class: "kf-btn danger", type: "button", text: "Discard", onclick: () => this._discard() }),
          h("button", { class: "kf-btn primary", type: "button", text: "Keep draft", "data-default": true, onclick: () => this._keepDraft() }),
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

  _go(index) {
    if (index < 0 || index >= STEPS.length) return;
    const forward = index > this.draft.step;
    this.draft.step = index;
    this.askIndex = 0;
    this._editingLine = false;
    this._stamping = forward && STEPS[index] === "eyes";
    this.services.session?.activity?.();
    this._save();
    this._render();
  }

  /** Saves the draft; saves run one after another. Resolves after this save has committed. */
  _save() {
    const run = this._saving.then(async () => {
      const { id, placeId, step, at, thing, clips } = this.draft;
      const saved = await this.services.store.saveDraft(structuredClone({ id, placeId, step, at, thing, clips }));
      this.draft.id = saved.id;
      this.draft.updatedAt = saved.updatedAt;
    });
    this._saving = run.catch((e) => this._error(e));
    return run;
  }

  /** A take finished (every good take is kept): store its blob first, then the draft that references it. */
  async _saveRecording(detail) {
    const { clip, blob } = detail ?? {};
    if (!clip) return;
    try {
      if (blob) await this.services.store.putBlob(blob);
      this.draft.clips = upsertClip(this.draft.clips, stripClip({ ...clip, language: clip.language ?? this.lang }));
      await this._save();
      if (this.step === "ask" && this._askStatus) {
        const n = [1, 2, 3].filter((take) => findClip(this.draft.clips, { language: this.lang, kind: "prompt", take })).length;
        this._askStatus.textContent = `Recorded ${n} of 3`;
      }
    } catch (e) {
      this._error(e);
    }
  }

  async _finish() {
    if (this._finishing) return;
    this._finishing = true;
    const { store, engine, audio } = this.services;
    const t = this.thing;
    try {
      await this._saving;
      const change = await store.addThing({
        placeId: this.placeId,
        names: cleanNames(t.names),
        outline: t.outline,
        color: t.color,
        eyes: t.eyes,
        legs: t.legs ?? [],
        motion: t.motion ?? DEFAULT_MOTION,
        cues: cleanCues(t.cues),
        clips: this.draft.clips.map(stripClip),
      });
      if (this.draft.id) await store.discardDraft(this.draft.id);
      const thingId = change.ids[0];
      engine?.dropIn?.(thingId);
      audio?.chime?.("plink");
      this.dispatchEvent(new CustomEvent("kf-added", { bubbles: true, detail: { thingId } }));
      this._close();
    } catch (e) {
      this._finishing = false;
      if (e?.code === "place-full") this._renderFull();
      else this._error(e);
    }
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
