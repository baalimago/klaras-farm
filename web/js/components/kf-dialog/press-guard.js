// Holds a panel's re-render while a press is in progress inside it, so a render triggered mid-tap
// never replaces the button under the finger (meeting 2 review: typing a question and tapping Done
// lost the tap, because the field commits on blur, the store emits synchronously, and the panel was
// rebuilt between pointerdown and click).
//
// Contract: request() renders now when no press is in progress inside `el`; otherwise it renders
// once, right after that press's click has run its handler (or, when no click follows, after
// RELEASE_MS from pointerup, or at pointercancel). The screen still follows the state within one
// tap; nothing is dropped. flush() renders a pending request at once.

/** How long after pointerup a pending render waits for a click that may not come (a drag away). */
export const RELEASE_MS = 400;

/**
 * @param {HTMLElement} el  the panel host
 * @param {() => void} render
 * @param {{setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout}=} timers
 */
export function pressGuard(el, render, timers = globalThis) {
  let down = false;
  let pending = false;
  let timer = 0;
  const flush = () => {
    timers.clearTimeout(timer);
    down = false;
    if (!pending) return;
    pending = false;
    render();
  };
  el.addEventListener("pointerdown", (e) => { if (e.isPrimary !== false) down = true; }, true);
  el.addEventListener("pointerup", () => { timers.clearTimeout(timer); timer = timers.setTimeout(flush, RELEASE_MS); }, true);
  el.addEventListener("pointercancel", flush, true);
  // Bubble phase on the host: the button's own click handler has already run on the old DOM.
  el.addEventListener("click", () => queueMicrotask(flush));
  return {
    request() {
      if (down) pending = true;
      else render();
    },
    flush,
    get pressing() { return down; },
  };
}
