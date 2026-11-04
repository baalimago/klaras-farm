// The "Where is the…?" questions of one thing in one language (US-4.8, playtest round 3): free-text
// lines, 1 to 6, each with its own recording; the built-in lines are examples, changed freely.
// Shared by the thing card and the find game setup. Edits go straight to the store (setQuestionLine,
// addQuestion, removeQuestion); the host re-renders on the store's change. The host also supplies
// the recording slot for each line, because it owns which slot is recording.
import { h, languageName } from "../kf-guided-add/dom.js";
import { cueLines, MAX_CUE_LINES } from "../../farm/scripts.js";

/**
 * @param {{store:object, shell?:object, scripts:object, thing:object, lang:string, slot:(take:number, line:string) => HTMLElement,
 *   onArticle:(article:string|undefined) => void, onError:(e:any) => void, heading?:boolean, busy?:boolean}} o
 *   busy: a recorder is open, so removing a question (which renumbers the recordings) waits
 *   shell: offers Undo after a removal (it deletes that question's recording)
 * @returns {HTMLElement}
 */
export function questionsSection({ store, scripts, thing, lang, slot, onArticle, onError, heading = true, busy = false, shell = null }) {
  const { lines, examples, fallback, articles } = cueLines(scripts ?? {}, thing, lang);
  const cue = thing.cues?.[lang] ?? {};
  const recorded = new Set(store.clipsFor(thing.id, { language: lang, kind: "prompt" }).map((c) => c.take));
  const count = lines.filter((_, i) => recorded.has(i + 1)).length;
  const run = (p) => Promise.resolve(p).catch(onError);
  return h(
    "div",
    { class: "kf-questions", "data-thing": thing.id },
    heading ? h("h3", { text: `Questions (${count}/${lines.length})` }) : null,
    h("p", { class: "kf-note", text: "Examples, change them freely. Say each one when you record it; one is picked at random each time." }),
    fallback ? h("p", { class: "kf-note", text: `No script for ${languageName(lang)} yet: say these in your language.` }) : null,
    articles.length
      ? h("label", { class: "kf-field kf-tc-article" }, h("span", { text: "Article" }),
          h("select", { name: "article", onchange: (e) => onArticle(e.target.value || undefined) },
            h("option", { value: "", text: "(none)", selected: !cue.article }),
            articles.map((a) => h("option", { value: a, text: a, selected: cue.article === a }))))
      : null,
    lines.map((line, i) =>
      h(
        "div",
        { class: "kf-tc-line kf-question", "data-index": String(i) },
        h("label", { class: "kf-field" }, h("span", { text: `Question ${i + 1}` }),
          h("input", {
            type: "text", name: `cue-${i + 1}`, value: line, placeholder: examples[i], autocomplete: "off", enterkeyhint: "done",
            onchange: (e) => run(store.setQuestionLine({ thingId: thing.id, language: lang, index: i, text: e.target.value })),
          })),
        slot(i + 1, line),
        h("button", {
          class: "kf-btn ghost icon", type: "button", "data-action": "remove-question", "aria-label": `Remove question ${i + 1}`, text: "✕",
          disabled: lines.length <= 1 || busy,
          onclick: () => run(Promise.resolve(store.removeQuestion({ thingId: thing.id, language: lang, index: i, examples })).then((change) => {
            if (change?.removed) shell?.toast?.(`Removed question ${i + 1}`, { undo: () => store.restoreQuestions(change.removed) });
          })),
        }),
      ),
    ),
    h("button", {
      class: "kf-btn", type: "button", "data-action": "add-question", text: "+ Add a question", disabled: lines.length >= MAX_CUE_LINES,
      onclick: () => run(store.addQuestion({ thingId: thing.id, language: lang })),
    }),
  );
}
