// What a find question plays, in order (US-6.2, playtest round 3 "the question must always be
// heard"; QA round 3: the parent panels say what plays through play/voice.js, which follows this order). Pure: the engine passes clips, script lines and an rng, and runs the plan.
//
// A plan is { ask: Step[], clue: Step|null, recorded: boolean }.
//   ask   alternatives, best first. The engine plays ask[0]; when a step is not heard (resolves
//         false: the device voice never started, a clip would not decode) and the round is still
//         current, it plays the next one. A chime always ends the list, so something is heard.
//   clue  the animal's own sound. It plays only after a question step has finished: never
//         instead of the question, never on top of it.
//   recorded  true when the question is the parent's own recording; false when nothing is recorded
//         for it, so the device voice (or a fallback) asks. <kf-find-buttons> then shows the grown-up
//         a tip to record their own question (playtest round 3).
// Step: {kind:'clip', clip} | {kind:'clips', clips} (one gapless sequence) | {kind:'speak', text, lang}
//       | {kind:'chime'}.

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** A random item, never `lastId` again while there is another to choose. */
function pickFresh(list, rng, lastId) {
  const pool = list.length > 1 ? list.filter((c) => c.id !== lastId) : list;
  return pick(pool, rng);
}

/**
 * The animal round: "Where is the hen?", then the hen's sound.
 * @param {{prompts: import('../types.js').Clip[], lang: string, lines: string[], linesLang: string,
 *   name: import('../types.js').Clip|null, sound: import('../types.js').Clip|null, canSpeak: boolean,
 *   rng: () => number, lastId?: string|null}} o
 *   prompts: the thing's recorded questions in every language; lines: its cue lines in `lang`
 *   (spoken in `linesLang`, English when the language has no script); name: its recorded name
 * @returns {{ask: object[], clue: object|null, recorded: boolean}}
 */
export function planAnimalAsk({ prompts, lang, lines, linesLang, name, sound, canSpeak, rng, lastId = null }) {
  const ask = [];
  const own = prompts.filter((c) => c.language === lang);
  if (own.length) ask.push({ kind: "clip", clip: pickFresh(own, rng, lastId) });
  if (canSpeak && lines.length) ask.push({ kind: "speak", text: pick(lines, rng), lang: linesLang });
  // Another language's recording only when the voice is not heard: the card of a language without
  // recordings says "the iPad voice reads this" (play/voice.js), and that is what plays.
  if (!own.length && prompts.length) ask.push({ kind: "clip", clip: pickFresh(prompts, rng, lastId) });
  if (name) ask.push({ kind: "clip", clip: name });
  ask.push({ kind: "chime" });
  // recorded: a parent's own question is what asks (the find buttons' recording tip stays away)
  const voiced = canSpeak && lines.length > 0;
  const recorded = own.length > 0 || (!voiced && prompts.length > 0);
  return { ask, clue: sound ? { kind: "clip", clip: sound } : null, recorded };
}

/**
 * The language a colour round speaks: the fixed play language, or with "Mix languages" a random
 * one among those where the question and this colour's word are both recorded (else any).
 */
export function colorAskLanguage(settings, recordedLangs, rng) {
  if (settings.playLanguage !== "alternate") return settings.playLanguage;
  const both = settings.languages.filter((l) => recordedLangs.includes(l));
  return pick(both.length ? both : settings.languages, rng);
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
  return { ask, clue: null, recorded };
}

/** Languages where a colour round can play fully recorded (a question and this colour's word). */
export function recordedColorLangs(questions, words) {
  const asked = new Set(questions.map((c) => c.language));
  return [...new Set(words.map((c) => c.language))].filter((l) => asked.has(l));
}
