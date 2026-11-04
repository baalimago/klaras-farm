// The find game setup panel's state (playtest round 3), as a pure state machine, plus what it shows
// as missing. The panel renders from this state and the store after every event.
//
//   state = {game:'animal'|'color', lang, recording:null|Slot, picked:null|colour, asks:0..6}
//   asks: how many colour question slots the parent asked to see (0 = only what is recorded)
//   error: null | 'quota' | 'failed', the last save that did not stick (shown until the next action)
//   Slot  = {kind:'prompt', thingId, take} | {kind:'color-question', take} | {kind:'color-word', color}
//
//   lang(l)        another language tab: closes the recorder (a take belongs to one language)
//   pick(colour)   the colour game: an animal or a swatch was tapped; its word slot shows
//   record(slot)   opens the recorder on one slot (only one at a time)
//   cancel | saved closes the recorder (saved: the take was stored)
//   failed {code}  a save was refused or did not reach the disk (the store already rolled back)
//   add-ask {shown} one more colour question slot than the `shown` ones (up to MAX_QUESTIONS)
import { SIMPLE_COLORS } from "../../farm/palette.js";
import { MAX_QUESTIONS } from "../../farm/snapshot.js";

/** @returns the panel's first state */
export function initialSetup(game, lang) {
  return { game: game === "color" ? "color" : "animal", lang, recording: null, picked: null, asks: 0, error: null };
}

export function nextSetup(s, e) {
  if (e.type === "failed") return { ...s, error: e.code === "quota" ? "quota" : "failed" };
  if (s.error && e.type !== "saved") s = { ...s, error: null };
  switch (e.type) {
    case "lang":
      return e.lang === s.lang ? s : { ...s, lang: e.lang, recording: null, asks: 0 };
    case "pick":
      if (!SIMPLE_COLORS.includes(e.color)) return s;
      return { ...s, picked: e.color, recording: s.recording?.kind === "color-word" ? null : s.recording };
    case "record":
      return { ...s, recording: { ...e.slot } };
    case "cancel":
    case "saved":
      return s.recording ? { ...s, recording: null } : s;
    case "add-ask":
      return { ...s, asks: Math.min(MAX_QUESTIONS, (e.shown ?? Math.max(1, s.asks)) + 1) };
    default:
      return s;
  }
}

/** True when this slot is the one recording. */
export function isRecording(s, slot) {
  const r = s.recording;
  if (!r || r.kind !== slot.kind) return false;
  return (r.thingId ?? null) === (slot.thingId ?? null) && (r.take ?? 1) === (slot.take ?? 1) && (r.color ?? null) === (slot.color ?? null);
}

/** How many colour question slots show: up to the highest recorded take, or as many as the parent asked for, at least 1. */
export function askSlots(s, questionTakes) {
  return Math.min(MAX_QUESTIONS, Math.max(1, s.asks, ...questionTakes));
}

/**
 * What the colour game still needs in a language, for the colours of the scene's things.
 * @param {{needed: string[], words: {language:string, color:string}[], questions: {language:string}[], lang: string}} o
 * @returns {{question: boolean, colors: string[]}}  question: the question is missing; colors: missing words
 */
export function colorMissing({ needed, words, questions, lang }) {
  const have = new Set(words.filter((w) => w.language === lang).map((w) => w.color));
  const colors = SIMPLE_COLORS.filter((c) => needed.includes(c) && !have.has(c));
  return { question: !questions.some((q) => q.language === lang), colors };
}

/** Parent copy for what is missing ("Still to record: the question, red, pink."), or null when done. */
export function missingText(missing, colorName = (c) => c) {
  const parts = [...(missing.question ? ["the question"] : []), ...missing.colors.map(colorName)];
  return parts.length ? `Still to record: ${parts.join(", ")}.` : null;
}
