// Enter in a parent text field commits it and closes the tablet keyboard (QA round 3: "enter does
// not finish the form"). Blurring fires the field's `change`, which saves it, so Enter, a tap
// elsewhere and the keyboard's own dismiss key all end the same way. Pair with enterkeyhint="done".

/** keydown handler for an <input>: Enter (not while an input method is composing) blurs it. */
export function commitOnEnter(e) {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  e.target?.blur?.();
}
