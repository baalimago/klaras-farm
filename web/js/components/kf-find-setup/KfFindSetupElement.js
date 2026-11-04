// <kf-find-setup>: the grown-ups' setup for a find game (playtest round 3), opened by holding a
// find button in play (then the adult check). params.game:
//   'animal'  "Find game": for each thing in the scene, its "Where is the …?" questions (free text,
//             1–6, examples only) with a recording each, per language. 🔍 plays one at random,
//             then the animal's sound.
//   'color'   "Colour game": the colour question per language ("Tap on an animal that is…", up to
//             6 ways), then tap an animal or a colour to record that colour's word. Shows which
//             colours of this scene and which languages still miss a recording.
// State: setup.js (pure). It renders from that state and the store after every event; an open
// <kf-recorder> is kept across renders so a store change never cuts a recording off.
// Props: services ({store, audio, scripts, recorder, session, env}), params {game}. Dispatches kf-close.
import { h, ensureElement, languageName } from "../kf-guided-add/dom.js";
import { clipSlot } from "../kf-thing-card/clip-slot.js";
import { questionsSection } from "../kf-thing-card/questions.js";
import { stripClip } from "../kf-guided-add/steps.js";
import { pressGuard } from "../kf-dialog/press-guard.js";
import { initialSetup, nextSetup, isRecording, askSlots, colorMissing, missingText } from "./setup.js";
import { SIMPLE_COLORS, hex } from "../../farm/palette.js";
import { colorGroup, groupHex } from "../../play/colors.js";
import { colorQuestionText, colorWord } from "../../farm/scripts.js";

export class KfFindSetupElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this.ready = null;
    this.state = null;
    this._recorder = null; // {key, el}: the open recorder, reused while the same slot records
    this._guard = null; // holds a store-driven render until the tap in progress has landed
    this._onStore = () => (this._guard ? this._guard.request() : this._render());
    this._onPointer = () => this.services?.session?.activity?.();
    this._onKey = (e) => { if (e.key === "Escape" && !this.state?.recording) this._close(); };
  }

  connectedCallback() {
    this.ready ??= this._start();
  }

  disconnectedCallback() {
    this.services?.store?.removeEventListener("change", this._onStore);
    this.removeEventListener("pointerdown", this._onPointer);
    this.removeEventListener("keydown", this._onKey);
  }

  get store() { return this.services.store; }
  get languages() {
    const l = this.store.settings?.languages;
    return l?.length ? l : ["en"];
  }

  async _start() {
    await ensureElement("kf-recorder", () => import("../kf-recorder/define.js"));
    this.state = initialSetup(this.params?.game, this.languages[0]);
    this._guard ??= pressGuard(this, () => this._render());
    this.store.addEventListener("change", this._onStore);
    this.addEventListener("pointerdown", this._onPointer);
    this.addEventListener("keydown", this._onKey);
    this._render();
  }

  /** Applies a panel event and renders from the new state. */
  dispatch(event) {
    this.state = nextSetup(this.state, event);
    if (!this.state.recording) this._recorder = null;
    this._render();
  }

  _things() {
    const place = this.store.currentPlace;
    return place ? this.store.thingsIn(place.id) : [];
  }

  _name(thing) {
    const n = thing.names ?? {};
    return n[this.state.lang] || n[this.languages[0]] || Object.values(n).find(Boolean) || "thing";
  }

  // ---------- rendering ----------

  _render() {
    if (!this.isConnected || !this.state) return;
    if (!this.languages.includes(this.state.lang)) this.state = nextSetup(this.state, { type: "lang", lang: this.languages[0] });
    // Keep the scroll position and the focused field (named within its animal's section) across the
    // rebuild, so an edit never sends the parent back to the first animal.
    const scroll = this.querySelector(".kf-fs")?.scrollTop ?? 0;
    const active = this.contains(document.activeElement) ? document.activeElement : null;
    const focus = active?.getAttribute("name")
      ? `${active.closest("[data-thing]") ? `[data-thing="${CSS.escape(active.closest("[data-thing]").dataset.thing)}"] ` : ""}[name="${CSS.escape(active.getAttribute("name"))}"]`
      : null;
    const color = this.state.game === "color";
    const title = color ? "Colour game" : "Find game";
    this.replaceChildren(
      h("section", { class: "kf-sheet full kf-fs", role: "dialog", "aria-labelledby": "kf-fs-title", "data-game": this.state.game },
        h("div", { class: "kf-row kf-fs-head" },
          h("h2", { id: "kf-fs-title", text: title }),
          h("button", { class: "kf-btn icon", type: "button", "aria-label": "Close", text: "✕", onclick: () => this._close() })),
        h("p", { class: "kf-note kf-fs-intro", text: color
          ? "When Klara taps the colour button, she hears your question and a colour, then taps any animal of that colour. Record the question once, then each colour word."
          : "When Klara taps 🔍, she hears one of these questions (picked at random), then the animal's sound, and taps that animal." }),
        this.state.error ? h("p", { class: "kf-warning kf-fs-error", role: "alert", text: this.state.error === "quota" ? "The iPad is out of space, so this couldn't be saved." : "Something went wrong saving this. Try again." }) : null,
        this._tabs(),
        h("div", { class: "kf-fs-body" }, color ? this._colorGame() : this._animalGame()),
        h("div", { class: "kf-row kf-fs-foot" },
          h("span", { class: "kf-tc-spacer" }),
          h("button", { class: "kf-btn primary", type: "button", text: "Done", "data-action": "done", onclick: () => this._close() }))),
    );
    const sheet = this.querySelector(".kf-fs");
    if (sheet) sheet.scrollTop = scroll;
    if (focus) this.querySelector(focus)?.focus({ preventScroll: true });
  }

  _tabs() {
    return h("div", { class: "kf-tabs", role: "tablist", "aria-label": "Language" },
      this.languages.map((l) => {
        const todo = this.state.game === "color" ? this._missing(l) : null;
        const n = todo ? (todo.question ? 1 : 0) + todo.colors.length : 0;
        return h("button", {
          type: "button", role: "tab", "data-lang": l, "aria-selected": String(l === this.state.lang),
          text: n ? `${languageName(l)} · ${n} to record` : languageName(l),
          onclick: () => this.dispatch({ type: "lang", lang: l }),
        });
      }));
  }

  _animalGame() {
    const things = this._things();
    if (!things.length) return h("p", { class: "kf-note", text: "This scene has no things yet. Add one, then record its questions here." });
    return things.map((thing) =>
      h("section", { class: "kf-fs-thing", "data-thing": thing.id },
        h("h3", {}, h("span", { class: "kf-fs-dot", "aria-hidden": "true", style: { background: hex(thing.color) } }), this._name(thing)),
        questionsSection({
          store: this.store,
          scripts: this.services.scripts,
          thing,
          lang: this.state.lang,
          heading: false,
          busy: !!this.state.recording,
          shell: this.services.shell,
          slot: (take, line) => this._slot({ kind: "prompt", thingId: thing.id, take }, line, `question ${take} for the ${this._name(thing)}`),
          onArticle: (article) => this._setArticle(thing, article),
          onError: (e) => this._error(e),
        })));
  }

  _colorGame() {
    const lang = this.state.lang;
    const scripts = this.services.scripts ?? {};
    const questions = this.store.gameClips({ kind: "color-question", language: lang });
    const words = this.store.gameClips({ kind: "color-word", language: lang });
    const said = colorQuestionText(scripts, lang);
    const slots = askSlots(this.state, questions.map((c) => c.take));
    const missing = this._missing(lang);
    const picked = this.state.picked;
    const status = missingText(missing, (c) => this._colorName(c));
    return [
      h("section", { class: "kf-fs-ask" },
        h("h3", { text: "1. The question" }),
        h("p", { class: "kf-note", text: `Say it so a colour can follow, for example “${said}”` }),
        Array.from({ length: slots }, (_, i) => this._slot({ kind: "color-question", take: i + 1 }, said, `colour question ${i + 1}`)),
        h("button", { class: "kf-btn", type: "button", "data-action": "add-ask", text: "+ Another way to ask", disabled: slots >= 6, onclick: () => this.dispatch({ type: "add-ask", shown: slots }) })),
      h("section", { class: "kf-fs-colors" },
        h("h3", { text: "2. The colours" }),
        h("p", { class: "kf-note", text: "Tap an animal, or a colour, then say just the colour word." }),
        h("div", { class: "kf-row kf-fs-things", role: "group", "aria-label": "Animals in this scene" },
          this._things().map((t) => {
            const g = colorGroup(t.color);
            return h("button", {
              class: "kf-btn kf-fs-pick-thing", type: "button", "data-thing": t.id, "data-color": g, "aria-pressed": String(!!g && g === picked),
              onclick: () => g && this.dispatch({ type: "pick", color: g }),
            }, h("span", { class: "kf-fs-dot", "aria-hidden": "true", style: { background: hex(t.color) } }), this._name(t));
          })),
        h("div", { class: "kf-swatches kf-fs-swatches", role: "group", "aria-label": "Colours" },
          SIMPLE_COLORS.map((c) => {
            const done = words.some((w) => w.color === c);
            return h("button", {
              class: `kf-swatch kf-fs-swatch${missing.colors.includes(c) ? " is-missing" : ""}${done ? " is-done" : ""}`, type: "button",
              "data-group": c, "aria-pressed": String(c === picked), "aria-label": `${this._colorName(c)}${done ? ", recorded" : ""}`,
              style: { background: groupHex(c) }, text: done ? "✓" : "",
              onclick: () => this.dispatch({ type: "pick", color: c }),
            });
          })),
        picked
          ? h("div", { class: "kf-fs-word", "data-color": picked },
              h("p", { class: "kf-fs-word-title", text: `${this._colorName(picked)}` }),
              this._slot({ kind: "color-word", color: picked }, `Say just the colour: “${colorWord(scripts, picked, lang) ?? picked}”`, `the word for ${this._colorName(picked)}`))
          : null),
      h("p", { class: status ? "kf-warning kf-fs-status" : "kf-note kf-fs-status", role: "status", text: status ?? `Everything for this scene is recorded in ${languageName(lang)} ✓` }),
    ];
  }

  /** The scene's colours (and the question) still missing a recording in `lang`. */
  _missing(lang) {
    const needed = [...new Set(this._things().map((t) => colorGroup(t.color)).filter(Boolean))];
    return colorMissing({
      needed,
      words: this.store.gameClips({ kind: "color-word" }),
      questions: this.store.gameClips({ kind: "color-question" }),
      lang,
    });
  }

  _colorName(group) {
    return colorWord(this.services.scripts ?? {}, group, "en") ?? group;
  }

  /** A recording slot for a question take or a colour word, in the current language. */
  _slot(slot, cue, what) {
    const lang = this.state.lang;
    const clip = this._clipFor(slot);
    const open = isRecording(this.state, slot);
    const key = `${slot.kind}|${slot.thingId ?? ""}|${slot.take ?? 1}|${slot.color ?? ""}|${lang}`;
    const keep = open && this._recorder?.key === key ? this._recorder.el : null;
    const box = clipSlot({
      services: this.services,
      clip,
      kind: slot.kind,
      take: slot.take ?? 1,
      color: slot.color,
      what,
      recordText: clip ? "Re-record" : "Record",
      cue: typeof cue === "string" ? cue : "",
      open,
      clipRef: { thingId: slot.thingId ?? null, language: lang, kind: slot.kind, take: slot.take ?? 1 },
      recorder: keep,
      onOpen: () => this.dispatch({ type: "record", slot }),
      onCancel: () => this.dispatch({ type: "cancel" }),
      onRecorded: (detail) => this._save(slot, lang, detail),
    });
    if (open) this._recorder = { key, el: box.recorder };
    return box;
  }

  _clipFor(slot) {
    const lang = this.state.lang;
    if (slot.kind === "prompt") return this.store.clipsFor(slot.thingId, { language: lang, kind: "prompt" }).find((c) => c.take === slot.take) ?? null;
    if (slot.kind === "color-word") return this.store.gameClips({ kind: "color-word", language: lang, color: slot.color })[0] ?? null;
    return this.store.gameClips({ kind: "color-question", language: lang }).find((c) => c.take === slot.take) ?? null;
  }

  /** A finished take replaces the old clip at once and the recorder closes (US-4.7), without
   *  waiting for the disk; a save that does not stick rolls back in the store and shows why. */
  _save(slot, lang, { clip, blob } = {}) {
    if (!clip) return;
    const record = { ...stripClip(clip), thingId: slot.thingId ?? null, language: lang, kind: slot.kind, take: slot.take ?? 1 };
    if (slot.color) record.color = slot.color;
    let saved;
    try {
      saved = this.store.saveClip({ clip: record, blob });
    } catch (e) {
      saved = Promise.reject(e);
    }
    this.dispatch({ type: "saved" });
    Promise.resolve(saved).catch((e) => this._error(e));
  }

  async _setArticle(thing, article) {
    const lang = this.state.lang;
    const cue = { ...(thing.cues?.[lang] ?? {}), article };
    if (!article) delete cue.article;
    try {
      await this.store.updateThing({ thingId: thing.id, patch: { cues: { ...(thing.cues ?? {}), [lang]: cue } } });
    } catch (e) {
      this._error(e);
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true }));
  }

  _error(e) {
    console.warn("kf-find-setup:", e);
    this.dispatch({ type: "failed", code: e?.code });
  }
}
