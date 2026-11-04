// The "Where is the…?" questions of a thing that is still a draft (Ask step; US-4.8, playtest 3).
// Same rules as the store intents setQuestionLine, addQuestion and removeQuestion in farm/intents.js,
// applied to the draft's `thing.cues` and `clips` (clips of a draft have no thingId): 1 to
// MAX_CUE_LINES free-text lines per language, an empty line plays the script example, prompt take n
// is the recording of line n, so removing a line renumbers the recordings after it.
// Pure: data in, a new {thing, clips} out; an edit that breaks the rules returns the draft unchanged.
import { questionCount, MAX_CUE_LINES } from "../../farm/scripts.js";

/** The parent's lines for a language, at its current length (empty strings stand for examples). */
export function draftLines(thing, language) {
  const lines = thing.cues?.[language]?.lines ?? [];
  return Array.from({ length: questionCount(thing, language) }, (_, i) => String(lines[i] ?? "").trim());
}

function withLines(draft, language, lines) {
  const cues = { ...(draft.thing.cues ?? {}), [language]: { ...(draft.thing.cues?.[language] ?? {}), lines } };
  return { ...draft, thing: { ...draft.thing, cues } };
}

/** Changes the text of question `index` (0-based). Empty text goes back to the example. */
export function setDraftLine(draft, { language, index, text }) {
  const lines = draftLines(draft.thing, language);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) return draft;
  lines[index] = String(text ?? "").trim();
  return withLines(draft, language, lines);
}

/** Adds a question at the end, up to MAX_CUE_LINES. Empty text means "the example". */
export function addDraftQuestion(draft, { language, text = "" }) {
  const lines = draftLines(draft.thing, language);
  if (lines.length >= MAX_CUE_LINES) return draft;
  return withLines(draft, language, [...lines, String(text).trim()]);
}

/**
 * Removes question `index` (one always stays) and its recording; later recordings move up one take
 * so each stays with its line. Empty lines after `index` keep their example as written text
 * (`examples` from scripts.js cueLines), because the example depends on the position.
 */
export function removeDraftQuestion(draft, { language, index, examples = [] }) {
  const lines = draftLines(draft.thing, language);
  if (lines.length <= 1 || !Number.isInteger(index) || index < 0 || index >= lines.length) return draft;
  for (let i = index + 1; i < lines.length; i++) if (!lines[i]) lines[i] = String(examples[i] ?? "").trim();
  lines.splice(index, 1);
  const take = index + 1;
  const isPrompt = (c) => c.language === language && c.kind === "prompt";
  const clips = draft.clips
    .filter((c) => !(isPrompt(c) && c.take === take))
    .map((c) => (isPrompt(c) && c.take > take ? { ...c, take: c.take - 1 } : c));
  return { ...withLines(draft, language, lines), clips };
}

/** The draft's clips in the shape of FarmStore.clipsFor (language and kind filters). */
export function draftClips(draft, { language, kind } = {}) {
  return draft.clips.filter((c) => (!language || c.language === language) && (!kind || c.kind === kind));
}
