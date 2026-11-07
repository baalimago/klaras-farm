// <kf-find-setup>: the grown-ups' setup for a find game (playtest round 3), opened by holding a
// find button in play (then the adult check). params.game:
//   'animal'  "Find game": the find question per language ("Where is the…", "Show me the…", up to
//             6 ways), then each animal's name. 🔍 plays a question at random followed by the
//             animal's recorded name, then its sound. Shows which names still miss a recording.
//   'color'   "Colour game": the colour question per language ("Tap on an animal that is…", up to
//             6 ways), then tap an animal or a colour to record that colour's word. Shows which
//             colours of this scene and which languages still miss a recording.
// Every slot says what Klara hears for it now ("Your recording", or "iPad voice for now" with an
// invitation to record your own); play/voice.js is the rule, the same one play follows.
// State: setup.js (pure). It renders from that state and the store after every event; an open
// <kf-recorder> is kept across renders so a store change never cuts a recording off.
// Props: services ({store, audio, scripts, recorder, session, env}), params {game}. Dispatches kf-close.
import { h, ensureElement, languageName } from "../kf-guided-add/dom.js";
import { clipSlot, lineVoiceText } from "../kf-thing-card/clip-slot.js";
import { questionVoice, nameVoice } from "../../play/voice.js";
import { stripClip } from "../kf-guided-add/steps.js";
import { pressGuard } from "../kf-dialog/press-guard.js";
import { initialSetup, nextSetup, isRecording, askSlots, colorMissing, nameMissing, missingText } from "./setup.js";
import { SIMPLE_COLORS, hex } from "../../farm/palette.js";
import { colorGroup, groupHex } from "../../play/colors.js";
import { colorQuestionText, colorWord, findQuestionText, askLines } from "../../farm/scripts.js";
import { capital, device } from "../../io/device.js";

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
  get canSpeak() { return this.services?.audio?.canSpeak !== false; }
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
    const n = thing?.names ?? {};
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
          : "When Klara taps 🔍, she hears your question and an animal's name, then its sound, and taps that animal. Record the question once, then each animal's name." }),
        this.state.error ? h("p", { class: "kf-warning kf-fs-error", role: "alert", text: this.state.error === "quota" ? `This ${device().name} is out of space, so this couldn't be saved.` : "Something went wrong saving this. Try again." }) : null,
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
        const todo = this._missing(l);
        const n = (todo.question ? 1 : 0) + (todo.colors ?? todo.things).length;
        return h("button", {
          type: "button", role: "tab", "data-lang": l, "aria-selected": String(l === this.state.lang),
          text: n ? `${languageName(l)} · ${n} to record` : languageName(l),
          onclick: () => this.dispatch({ type: "lang", lang: l }),
        });
      }));
  }

  _animalGame() {
    const lang = this.state.lang;
    const things = this._things();
    const questions = this.store.gameClips({ kind: "find-question", language: lang });
    const said = findQuestionText(this.services.scripts ?? {}, lang);
    const takes = questions.map((c) => c.take);
    const slots = askSlots(this.state, takes);
    const status = missingText(this._missing(lang), (id) => this._name(things.find((t) => t.id === id)));
    return [
      this._askSection({ kind: "find-question", said, follows: "a name", takes, slots, what: "question", voice: (take) => this._askVoice(takes, take, this._namesAnswers(lang)) }),
      h("section", { class: "kf-fs-names" },
        h("h3", { text: "2. The names" }),
        things.length
          ? h("p", { class: "kf-note", text: "Say each animal's name the way it follows your question. Klara also hears it when she taps the animal." })
          : h("p", { class: "kf-note", text: "This scene has no things yet. Add one, then record its name here." }),
        things.map((thing) =>
          h("div", { class: "kf-fs-thing", "data-thing": thing.id },
            h("h4", {}, h("span", { class: "kf-fs-dot", "aria-hidden": "true", style: { background: hex(thing.color) } }), this._name(thing)),
            this._slot({ kind: "name", thingId: thing.id }, this._nameCue(thing), `the name of the ${this._name(thing)}`, this._nameVoice(thing))))),
      things.length
        ? h("p", { class: status ? "kf-warning kf-fs-status" : "kf-note kf-fs-status", role: "status", text: status ?? `Everything for this scene is recorded in ${languageName(lang)} ✓` })
        : null,
    ];
  }

  /** "1. The question": its takes (up to 6 ways to ask), each with what Klara hears for it. */
  _askSection({ kind, said, follows, takes, slots, what, voice }) {
    return h("section", { class: "kf-fs-ask" },
      h("h3", { text: "1. The question" }),
      h("p", { class: "kf-note", text: `Say it so ${follows} can follow, for example “${said}”` }),
      !takes.length && this.canSpeak
        ? h("p", { class: "kf-invite", "data-testid": kind === "color-question" ? "color-invite" : "find-invite", text: `The ${device().voice} asks this for now. Record your own: Klara knows your voice best.` })
        : null,
      Array.from({ length: slots }, (_, i) => this._slot({ kind, take: i + 1 }, said, `${what} ${i + 1}`, voice(i + 1))),
      h("button", { class: "kf-btn", type: "button", "data-action": "add-ask", text: "+ Another way to ask", disabled: slots >= 6, onclick: () => this.dispatch({ type: "add-ask", shown: slots }) }));
  }

  /**
   * What to say for a name, so it follows the question ("Wo ist…" + "das Huhn"): in a language with
   * articles the name goes with its article; without a typed name in this language, its name in it.
   */
  _nameCue(thing) {
    const lang = this.state.lang;
    const typed = thing.names?.[lang];
    const { articles } = askLines(this.services.scripts ?? {}, thing, lang);
    if (!typed) return `Say its ${languageName(lang)} name, slowly and clearly (type it on its card to see it here)`;
    if (!articles.length) return `Say just its name, slowly and clearly: “${typed}”`;
    const article = thing.cues?.[lang]?.article;
    return article
      ? `Say its name with its article, slowly and clearly: “${article} ${typed}”`
      : `Say its name with its article (${articles.join(", ")}), slowly and clearly: “… ${typed}”`;
  }

  /** What a name slot plays now (play/voice.js nameVoice, the rule a tap and a find round follow). */
  _nameVoice(thing) {
    const v = nameVoice(this.store.snapshot, thing, this.state.lang, this.canSpeak);
    if (v.source === "recording") return { source: v.source, text: "Your recording" };
    if (v.source === "other-language") return { source: v.source, text: `Plays your ${languageName(v.clip.language)} recording for now` };
    if (v.source === "voice") return { source: v.source, text: `${capital(device().voice)} says “${v.text}” for now` };
    return null;
  }

  /** The scene's things as answers of the find question: all of them, and those with a name recorded in `lang`. */
  _namesAnswers(lang) {
    const things = this._things();
    return {
      needed: things.map((t) => t.id),
      words: things.filter((t) => this.store.clipsFor(t.id, { language: lang, kind: "name" }).length > 0).map((t) => t.id),
    };
  }

  _colorGame() {
    const lang = this.state.lang;
    const scripts = this.services.scripts ?? {};
    const questions = this.store.gameClips({ kind: "color-question", language: lang });
    const words = this.store.gameClips({ kind: "color-word", language: lang });
    const said = colorQuestionText(scripts, lang);
    const takes = questions.map((c) => c.take);
    const slots = askSlots(this.state, takes);
    const missing = this._missing(lang);
    const picked = this.state.picked;
    const status = missingText(missing, (c) => this._colorName(c));
    const answers = { needed: this._neededColors(), words: words.map((w) => w.color) };
    return [
      this._askSection({ kind: "color-question", said, follows: "a colour", takes, slots, what: "colour question", voice: (take) => this._askVoice(takes, take, answers, (c) => this._colorName(c)) }),
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
            const todo = missing.colors.includes(c);
            return h("button", {
              class: `kf-swatch kf-fs-swatch${todo ? " is-missing" : ""}${done ? " is-done" : ""}`, type: "button",
              "data-group": c, "aria-pressed": String(c === picked), "aria-label": `${this._colorName(c)}${done ? ", recorded" : todo ? ", word still to record" : ""}`,
              style: { background: groupHex(c) }, text: done ? "✓" : "",
              onclick: () => this.dispatch({ type: "pick", color: c }),
            });
          })),
        picked
          ? h("div", { class: "kf-fs-word", "data-color": picked },
              h("p", { class: "kf-fs-word-title", text: `${this._colorName(picked)}` }),
              this._slot({ kind: "color-word", color: picked }, `Say just the colour: “${colorWord(scripts, picked, lang) ?? picked}”`, `the word for ${this._colorName(picked)}`,
                lineVoiceText(words.some((w) => w.color === picked) ? "recording" : this.canSpeak ? "voice" : "none")))
          : null),
      h("p", { class: status ? "kf-warning kf-fs-status" : "kf-note kf-fs-status", role: "status", text: status ?? `Everything for this scene is recorded in ${languageName(lang)} ✓` }),
    ];
  }

  /**
   * What a question slot plays (play/voice.js questionVoice, the rule play/ask.js uses): a recorded
   * question is heard only with the answer's recorded word (the animal's name, the colour's word), so
   * the slot says for how many of the scene's answers, and names the ones that still get the iPad voice.
   * @param {{needed: string[], words: string[]}} answers
   */
  _askVoice(takes, take, answers, label = (id) => this._name(this._things().find((t) => t.id === id))) {
    const v = questionVoice(takes, take, answers, this.canSpeak);
    const own = takes.includes(take);
    const color = this.state.game === "color";
    const word = color ? "colour word" : "name";
    if (v.source === "partial") {
      const rest = v.missing.map(label).join(", ");
      return { source: v.source, text: `Plays with each ${color ? "colour's word" : "name"}: ${v.recorded} of ${v.total} recorded (${rest}: ${this.canSpeak ? `${device().voice} for now` : "not asked yet"})` };
    }
    if (own && v.source === "voice") return { source: v.source, text: `${capital(device().voice)} until a ${word} is recorded` };
    if (own && v.source === "none") return { source: v.source, text: `Not heard until a ${word} is recorded` };
    return lineVoiceText(v.source);
  }

  /** The colour groups of the scene's things. */
  _neededColors() {
    return [...new Set(this._things().map((t) => colorGroup(t.color)).filter(Boolean))];
  }

  /** What the game still misses a recording of in `lang`: the question, and the scene's colours or names. */
  _missing(lang) {
    if (this.state.game !== "color") {
      return nameMissing({
        things: this._things().map((t) => t.id),
        names: this._things().flatMap((t) => this.store.clipsFor(t.id, { kind: "name" })),
        questions: this.store.gameClips({ kind: "find-question" }),
        lang,
      });
    }
    return colorMissing({
      needed: this._neededColors(),
      words: this.store.gameClips({ kind: "color-word" }),
      questions: this.store.gameClips({ kind: "color-question" }),
      lang,
    });
  }

  _colorName(group) {
    return colorWord(this.services.scripts ?? {}, group, "en") ?? group;
  }

  /** A recording slot for a question take or a colour word, in the current language; `voice` says what plays now. */
  _slot(slot, cue, what, voice = null) {
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
      recordText: clip ? "Re-record" : "Record your own",
      voice,
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
    if (slot.kind === "name") return this.store.clipsFor(slot.thingId, { language: lang, kind: "name" })[0] ?? null;
    if (slot.kind === "color-word") return this.store.gameClips({ kind: "color-word", language: lang, color: slot.color })[0] ?? null;
    return this.store.gameClips({ kind: slot.kind, language: lang }).find((c) => c.take === slot.take) ?? null;
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

  _close() {
    this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true }));
  }

  _error(e) {
    console.warn("kf-find-setup:", e);
    this.dispatch({ type: "failed", code: e?.code });
  }
}
