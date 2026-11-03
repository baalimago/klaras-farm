// Languages offered by "+ Language" on the thing card. Every language can be recorded; languages
// without a script file get the English cue with "say this in your language" (US-4.8).
export const LANGUAGE_CHOICES = Object.freeze([
  "am", "ar", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr", "ga", "gl",
  "gu", "he", "hi", "hr", "hu", "hy", "id", "is", "it", "ja", "ka", "kk", "km", "ko", "ku", "lt", "lv", "mk", "ml", "mn",
  "mr", "ms", "mt", "nb", "ne", "nl", "nn", "pa", "pl", "ps", "pt", "ro", "ru", "si", "sk", "sl", "so", "sq", "sr", "sv",
  "sw", "ta", "te", "th", "ti", "tl", "tr", "uk", "ur", "uz", "vi", "yo", "zh", "zu",
]);

/** Choices not yet used, sorted by English name. */
export function languageOptions(used, nameOf) {
  return LANGUAGE_CHOICES.filter((l) => !used.includes(l))
    .map((l) => ({ lang: l, name: nameOf(l) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
