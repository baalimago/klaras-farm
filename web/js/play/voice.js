// What the child hears for each recording slot (QA round 3: "I re-recorded the sound … I don't
// know what the animals say anymore"). One rule, used by the play engine to choose what plays and by
// the parent panels (thing card, find setup) to say what plays, so the two can never disagree.
// Pure: data in, data out.
//
//   name      the recording in that language; else another language's recording (tapClips falls
//             back to it); else the device voice says the typed name (spokenName); else nothing.
//   sound     one per thing, every language (farm/intents.js soundClip); there is no voice for it.
//   question  a line of a thing's questions, or a colour question, in one language: its own
//             recording plays; while other lines of that language are recorded only those are
//             asked, so this one is skipped; with none recorded the device voice reads the lines
//             (play/ask.js asks in that order).
import { clipsFor, tapClips, soundClip } from "../farm/intents.js";

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
 * One question line in one language.
 * @param {number[]} recordedTakes  the takes recorded in that language
 * @returns {'recording'|'skipped'|'voice'|'none'}
 */
export function lineVoice(recordedTakes, take, canSpeak = true) {
  if (recordedTakes.includes(take)) return "recording";
  if (recordedTakes.length) return "skipped";
  return canSpeak ? "voice" : "none";
}

/** A thing's question line `take` in `lang`. */
export function questionVoice(s, thingId, lang, take, canSpeak = true) {
  return lineVoice(clipsFor(s, thingId, { language: lang, kind: "prompt" }).map((c) => c.take), take, canSpeak);
}
