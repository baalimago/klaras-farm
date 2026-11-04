// Editing sounds (parent UI): the one helper every edit action goes through, so the feedback is a
// consistent family (dsp/chimes.js EDIT_CHIMES, plus `poof` for a delete). The iPad has no
// navigator.vibrate, so this soft sound is the "haptic" reward. Call it synchronously inside the
// gesture handler: it unlocks audio first (iPad rules) and never throws, so it can never eat a tap.

/**
 * @param {{audio?: {unlock?: () => void, chime?: (kind: string) => number}} | null | undefined} services
 * @param {'select'|'pick'|'drop'|'tool'|'colour'|'add'|'undo'|'next'|'back'|'toggle'|'save'|'poof'} kind
 */
export function editSound(services, kind) {
  const audio = services?.audio;
  if (!audio) return;
  try {
    audio.unlock?.();
    audio.chime?.(kind);
  } catch {
    // sound trouble never breaks editing
  }
}
