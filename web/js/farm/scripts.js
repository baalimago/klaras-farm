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

/**
 * The three cue lines for one thing and language, honouring the parent's edits.
 * @param {Object<string, any>} files
 * @param {{names:Object<string,string>, cues:Object<string, {lines?:string[], article?:string}>}} thing
 * @param {string} lang
 * @returns {{lines:string[], fallback:boolean, articles:string[]}}
 */
export function cueLines(files, thing, lang) {
  const { file, fallback } = scriptFileFor(files, lang);
  const cue = thing.cues?.[lang] ?? {};
  const name = thing.names?.[lang] || thing.names?.[FALLBACK_LANG] || Object.values(thing.names ?? {})[0] || "…";
  const article = fallback ? "" : (cue.article ?? "");
  const lines = (file?.templates ?? []).slice(0, 3).map((t, i) => cue.lines?.[i] || fillTemplate(t, { name, article }));
  return { lines, fallback, articles: fallback ? [] : (file?.articles ?? []) };
}

/**
 * The colour game's question ("Find something yellow!") in `lang`, from the script file's
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
