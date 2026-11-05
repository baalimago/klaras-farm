// "Undo changes" on the thing card (QA round 3: "go back and revert … editing an animal"). Pure.
// The card keeps the thing as it was when it opened; these say whether it has changed since, and
// the updateThing patch that puts it back. Only the Thing's own fields: recordings are never touched,
// so a take made on the card is kept (a new take replaces the old one at once, US-4.7).

/** The fields a card edit can change, all patchable through updateThing (farm/intents.js). */
export const REVERTIBLE = Object.freeze(["names", "outline", "color", "eyes", "legs", "motion", "cues"]);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields of `current` that differ from `original`. */
export function changedFields(original, current) {
  if (!original || !current) return [];
  return REVERTIBLE.filter((k) => !same(original[k], current[k]));
}

/** The updateThing patch that puts back what changed; null when nothing did. */
export function revertPatch(original, current) {
  const keys = changedFields(original, current);
  if (!keys.length) return null;
  return Object.fromEntries(keys.map((k) => [k, structuredClone(original[k])]));
}
