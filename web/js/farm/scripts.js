// "Where is the…" scripts: pure template filling with per-language fallback (US-4.8).
// Script files are data: web/data/scripts/<lang>.json
//   { "lang": "de", "articles": ["der","die","das"], "templates": ["Wo ist {the} {name}?", …] }
// Placeholders: {name}; {the} is the chosen article (dropped with its space when there is none).

export const FALLBACK_LANG = "en";

/**
 * @param {Object<string, any>} files  scripts by language tag
 * @param {string} lang
 * @returns {{file:any, fallback:boolean}}
 */
export function scriptFileFor(files, lang) {
  const base = lang.split("-")[0];
  const file = files[lang] ?? files[base];
  if (file) return { file, fallback: false };
  return { file: files[FALLBACK_LANG], fallback: true };
}

export function fillTemplate(template, { name, article = "" }) {
  let out = template.replaceAll("{name}", name);
  out = article ? out.replaceAll("{the}", article) : out.replace(/\{the\}\s?/g, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Questions a thing has in a language before the parent adds or removes any (the script examples). */
export const DEFAULT_QUESTIONS = 3;
/** The most questions per thing and language (matches MAX_QUESTIONS in snapshot.js). */
export const MAX_CUE_LINES = 6;

/**
 * How many questions a thing has in `lang`: the length of the parent's lines, else the default 3.
 * @param {{cues?:Object<string, {lines?:(string|null)[]}>}} thing
 */
export function questionCount(thing, lang) {
  const n = thing?.cues?.[lang]?.lines?.length ?? 0;
  return n ? Math.min(n, MAX_CUE_LINES) : DEFAULT_QUESTIONS;
}

/**
 * The cue lines for one thing and language. The parent's lines are free text, 1 to 6 of them; an
 * empty line means "the example" (the script template at that position, round and round).
 * The built-in examples are only a starting point.
 * @param {Object<string, any>} files
 * @param {{names:Object<string,string>, cues:Object<string, {lines?:(string|null)[], article?:string}>}} thing
 * @param {string} lang
 * @returns {{lines:string[], examples:string[], fallback:boolean, articles:string[]}}
 *   examples: what each line says when the parent leaves it empty
 */
export function cueLines(files, thing, lang) {
  const { file, fallback } = scriptFileFor(files, lang);
  const cue = thing.cues?.[lang] ?? {};
  const name = thing.names?.[lang] || thing.names?.[FALLBACK_LANG] || Object.values(thing.names ?? {})[0] || "…";
  const article = fallback ? "" : (cue.article ?? "");
  const templates = file?.templates ?? [];
  const examples = [];
  const lines = [];
  for (let i = 0; i < questionCount(thing, lang); i++) {
    const example = templates.length ? fillTemplate(templates[i % templates.length], { name, article }) : "";
    examples.push(example);
    lines.push(String(cue.lines?.[i] ?? "").trim() || example);
  }
  return { lines, examples, fallback, articles: fallback ? [] : (file?.articles ?? []) };
}

/**
 * What the parent says for the colour game's recorded question in `lang` ("Tap on an animal that
 * is…"); the colour word clip follows it. Falls back to English.
 */
export function colorQuestionText(files, lang) {
  const { file } = scriptFileFor(files, lang);
  return file?.colorQuestion ?? files[FALLBACK_LANG]?.colorQuestion ?? "";
}

/** The colour word as the script has it ("yellow", "gult"), or null when the language has none. */
export function colorWord(files, group, lang) {
  const { file, fallback } = scriptFileFor(files, lang);
  return fallback ? null : (file?.colors?.[group] ?? null);
}

/**
 * The colour game's question in the device's voice ("Tap on an animal that is yellow!") in `lang`, from the script file's
 * `colorTemplates` (with {color}) and `colors` (simple colour → the word as it fits the templates,
 * e.g. German "Gelbes", Swedish neuter "gult"). Falls back to English when the language has none.
 * @param {Object<string, any>} files
 * @param {string} group  simple colour (play/colors.js), e.g. 'yellow'
 * @param {string} lang
 * @param {number} [n]  rotates through the templates
 * @returns {{text:string, lang:string} | null}
 */
export function colorLine(files, group, lang, n = 0) {
  let { file, fallback } = scriptFileFor(files, lang);
  let out = fallback ? FALLBACK_LANG : lang;
  if (!file?.colors?.[group] || !file?.colorTemplates?.length) {
    file = files[FALLBACK_LANG];
    out = FALLBACK_LANG;
  }
  const word = file?.colors?.[group];
  const templates = file?.colorTemplates ?? [];
  if (!word || !templates.length) return null;
  return { text: templates[n % templates.length].replaceAll("{color}", word), lang: out };
}
