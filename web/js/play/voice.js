// What the child hears for each recording slot (QA round 3: "I re-recorded the sound … I don't
// know what the animals say anymore"). One rule, used by the play engine to choose what plays and by
// the parent panels (thing card, find setup) to say what plays, so the two can never disagree.
// Pure: data in, data out.
//
//   name      the recording in that language; else another language's recording (tapClips falls
//             back to it); else the device voice says the typed name (spokenName); else nothing.
//   sound     one per thing, every language (farm/intents.js soundClip); there is no voice for it.
//   question  a take of the find question or the colour question, in one language: its own
//             recording plays; while other takes of that language are recorded only those are
//             asked, so this one is skipped; with none recorded the device voice asks. A recording is
//             heard only with the answer's word recorded in the same language (the thing's name,
//             the colour's word; planAnimalAsk, planColorAsk); for the others the device voice says
//             the whole line, so the setup says for how many it plays.
import { tapClips, soundClip } from "../farm/intents.js";

/**
 * The typed name the device voice says: in `lang` if typed, else its base language, else any.
 * @returns {{text: string, lang: string}|null}
 */
export function spokenName(thing, lang) {
  const names = thing?.names;
  if (!names) return null;
  const base = String(lang).split("-")[0];
  if (names[lang]) return { text: names[lang], lang };
  if (names[base]) return { text: names[base], lang: base };
  const [l, text] = Object.entries(names).find(([, v]) => v) ?? [];
  return text ? { text, lang: l } : null;
}

/**
 * What a tap on the thing says as its name when the play language is `lang`.
 * @returns {{source:'recording'|'other-language', clip:object} | {source:'voice', text:string, lang:string} | {source:'none'}}
 */
export function nameVoice(s, thing, lang, canSpeak = true) {
  const clip = tapClips(s, thing.id, lang).find((c) => c.kind === "name");
  if (clip) return { source: clip.language === lang ? "recording" : "other-language", clip };
  const said = canSpeak ? spokenName(thing, lang) : null;
  return said ? { source: "voice", ...said } : { source: "none" };
}

/** The thing's sound. @returns {{source:'recording', clip:object} | {source:'none'}} */
export function soundVoice(s, thingId) {
  const clip = soundClip(s, thingId);
  return clip ? { source: "recording", clip } : { source: "none" };
}

/**
 * One question take in one language, before the answer's word is considered.
 * @param {number[]} recordedTakes  the takes recorded in that language
 * @returns {'recording'|'skipped'|'voice'|'none'}
 */
export function lineVoice(recordedTakes, take, canSpeak = true) {
  if (recordedTakes.includes(take)) return "recording";
  if (recordedTakes.length) return "skipped";
  return canSpeak ? "voice" : "none";
}

/**
 * A find or colour question take in one language. The round plays the recording only together with
 * the answer's word in the same language (the thing's name, the colour's word); without that word
 * the device voice says the whole line. So a recorded take is heard for the answers whose word is
 * recorded, and not for the rest.
 * @param {number[]} recordedTakes  question takes recorded in that language
 * @param {{needed: string[], words: string[]}} answers  needed: the scene's answers (thing ids, colour
 *   groups); words: the answers with a word recorded in that language
 * @returns {{source: 'recording'|'partial'|'skipped'|'voice'|'none', recorded: number, total: number, missing: string[]}}
 *   partial: the recording plays for `recorded` of `total` answers; `missing` get the device voice (or less)
 */
export function questionVoice(recordedTakes, take, { needed, words }, canSpeak = true) {
  const missing = needed.filter((c) => !words.includes(c));
  const counts = { recorded: needed.length - missing.length, total: needed.length, missing };
  const line = lineVoice(recordedTakes, take, canSpeak);
  if (line !== "recording" || !missing.length) return { source: line, ...counts };
  if (counts.recorded) return { source: "partial", ...counts };
  return { source: canSpeak ? "voice" : "none", ...counts };
}
