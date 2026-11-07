// "Where is the…" scripts: pure template filling with per-language fallback (US-4.8).
// Script files are data: web/data/scripts/<lang>.json
//   { "lang": "de", "articles": ["der","die","das"], "templates": ["Wo ist {the} {name}?", …],
//     "findQuestion": "Wo ist…", "colorQuestion": …, "colorTemplates": […], "colors": {…} }
// templates are the device voice's find questions; findQuestion is the cue for the family's
// recorded find question, which the thing's recorded name follows.
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

/**
 * What the device voice may ask for a thing in `lang` when the family's question is not recorded
 * (US-4.8): the script's templates filled with the typed name and the chosen article.
 * @param {Object<string, any>} files
 * @param {{names:Object<string,string>, cues?:Object<string, {article?:string}>}} thing
 * @param {string} lang
 * @returns {{lines:string[], fallback:boolean, articles:string[]}}
 *   fallback: the language has no script, so the lines are English
 */
export function askLines(files, thing, lang) {
  const { file, fallback } = scriptFileFor(files, lang);
  const name = thing.names?.[lang] || thing.names?.[FALLBACK_LANG] || Object.values(thing.names ?? {}).find(Boolean) || "…";
  const article = fallback ? "" : (thing.cues?.[lang]?.article ?? "");
  const lines = (file?.templates ?? []).map((t) => fillTemplate(t, { name, article }));
  return { lines, fallback, articles: fallback ? [] : (file?.articles ?? []) };
}

/**
 * What the parent says for the find game's recorded question in `lang` ("Where is the…"); the
 * thing's recorded name follows it. Falls back to English.
 */
export function findQuestionText(files, lang) {
  const { file } = scriptFileFor(files, lang);
  return file?.findQuestion ?? files[FALLBACK_LANG]?.findQuestion ?? "";
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
