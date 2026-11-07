// What a find question plays, in order (US-6.2, playtest round 3 "the question must always be
// heard"; QA round 3: the parent panels say what plays through play/voice.js, which follows this order). Pure: the engine passes clips, script lines and an rng, and runs the plan.
//
// A plan is { ask: Step[], clue: Step|null, recorded: boolean }.
//   ask   alternatives, best first. The engine plays ask[0]; when a step is not heard (resolves
//         false: the device voice never started, a clip would not decode) and the round is still
//         current, it plays the next one. A chime always ends the list, so something is heard.
//   clue  the animal's own sound. It plays only after a question step has finished: never
//         instead of the question, never on top of it.
//   recorded  true when the question plays in the parent's own voice (question and answer word both
//         recorded); false when the device voice (or a fallback) asks.
//   missing  'question' (no question recorded in that language), 'word' (the question is, but not
//         the thing's name or the colour's word), or null; the recording tip says which to record. <kf-find-buttons> then shows the grown-up
//         a tip to record their own question (playtest round 3).
// Step: {kind:'clip', clip} | {kind:'clips', clips} (one gapless sequence) | {kind:'speak', text, lang}
//       | {kind:'chime'}.

/** What keeps a round from playing fully recorded: 'question', else 'word' (the name or colour word), else null. */
const missingPart = (questions, word) => (!questions.length ? "question" : !word ? "word" : null);

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** A random item, never `lastId` again while there is another to choose. */
function pickFresh(list, rng, lastId) {
  const pool = list.length > 1 ? list.filter((c) => c.id !== lastId) : list;
  return pick(pool, rng);
}

/**
 * The animal round: "Where is the…" + "hen", then the hen's sound. Like the colour round, the
 * family's recorded question and the thing's recorded name in the same language play as one
 * sequence; otherwise the device voice asks a whole script line; otherwise the recorded name alone
 * (any language); otherwise a chime.
 * @param {{questions: import('../types.js').Clip[], names: import('../types.js').Clip[], lang: string,
 *   lines: string[], linesLang: string, sound: import('../types.js').Clip|null, canSpeak: boolean,
 *   rng: () => number, lastId?: string|null}} o
 *   questions: the find question clips in every language; names: this thing's name clips in every
 *   language; lines: the device voice's lines for it (scripts.js askLines), spoken in `linesLang`
 * @returns {{ask: object[], clue: object|null, recorded: boolean}}
 */
export function planAnimalAsk({ questions, names, lang, lines, linesLang, sound, canSpeak, rng, lastId = null }) {
  const ask = [];
  const q = questions.filter((c) => c.language === lang);
  const name = names.find((c) => c.language === lang) ?? null;
  const recorded = q.length > 0 && !!name;
  if (recorded) ask.push({ kind: "clips", clips: [pickFresh(q, rng, lastId), name] });
  if (canSpeak && lines.length) ask.push({ kind: "speak", text: pick(lines, rng), lang: linesLang });
  const anyName = name ?? names[0] ?? null;
  if (anyName) ask.push({ kind: "clip", clip: anyName });
  ask.push({ kind: "chime" });
  return { ask, clue: sound ? { kind: "clip", clip: sound } : null, recorded, missing: missingPart(q, name) };
}

/**
 * The language a find round speaks: the fixed play language, or with "Mix languages" a random
 * one among those where the question and the answer's word (the thing's name, the colour's word)
 * are both recorded (else any).
 */
export function askLanguage(settings, recordedLangs, rng) {
  if (settings.playLanguage !== "alternate") return settings.playLanguage;
  const both = settings.languages.filter((l) => recordedLangs.includes(l));
  return pick(both.length ? both : settings.languages, rng);
}

/** Languages where a round can play fully recorded: a question, and a word for the answer. */
export function recordedLangs(questions, words) {
  const asked = new Set(questions.map((c) => c.language));
  return [...new Set(words.map((c) => c.language))].filter((l) => asked.has(l));
}

/**
 * The colour round: "Tap on an animal that is…" + "yellow". Recorded question and word in the same
 * language play as one sequence; otherwise the device voice says the whole line; otherwise the
 * recorded word alone; otherwise a chime (the colour button shows the colour).
 * @param {{questions: import('../types.js').Clip[], words: import('../types.js').Clip[], lang: string,
 *   line: {text:string, lang:string}|null, canSpeak: boolean, rng: () => number, lastId?: string|null}} o
 *   questions: colour question clips, every language; words: this colour's word clips, every language
 * @returns {{ask: object[], clue: null, recorded: boolean}}
 */
export function planColorAsk({ questions, words, lang, line, canSpeak, rng, lastId = null }) {
  const ask = [];
  const q = questions.filter((c) => c.language === lang);
  const word = words.find((c) => c.language === lang) ?? null;
  const recorded = q.length > 0 && !!word;
  if (recorded) ask.push({ kind: "clips", clips: [pickFresh(q, rng, lastId), word] });
  if (canSpeak && line) ask.push({ kind: "speak", text: line.text, lang: line.lang });
  const anyWord = word ?? words[0] ?? null;
  if (anyWord) ask.push({ kind: "clip", clip: anyWord });
  ask.push({ kind: "chime" });
  return { ask, clue: null, recorded, missing: missingPart(q, word) };
}
