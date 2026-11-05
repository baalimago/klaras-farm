// The recording tip next to a find button, as a pure state machine (playtest round 3: "the robotic
// question is fine, but encourage recording your own"). When a find question plays in the device
// voice because nothing is recorded for it, a small note for the grown-up appears beside that game's
// button: "🎤 Hold 1 s to record your own question". It never blocks a tap and fades by itself.
//
//   hidden ──ask (not recorded, tips on, this game not tipped in the last HINT_COOLDOWN_MS)──▶ showing
//   showing ──expire (HINT_SHOW_MS later) / hide (left play, buttons hidden, tips off)──▶ hidden
//   showing ──ask (recorded, same game)──▶ hidden        a question with a recording never gets the tip
//   showing ──ask (other game, qualifies)──▶ showing that game's tip instead
//
// Time comes in with the events (`now`, milliseconds), so the policy is testable without timers.

/** How long the tip stays up before it has faded away. */
export const HINT_SHOW_MS = 6000;
/** The same game shows the tip at most once per this long, however often the child presses. */
export const HINT_COOLDOWN_MS = 3 * 60 * 1000;

/** @typedef {{showing: null | {kind: string, until: number}, shownAt: Record<string, number>}} HintState */

/** @returns {HintState} */
export function initialHint() {
  return { showing: null, shownAt: {} };
}

/**
 * @param {HintState} s
 * @param {{type:'ask', kind:string, recorded:boolean, enabled:boolean, now:number} | {type:'expire', now:number} | {type:'hide'}} e
 *   ask: a find question just started; recorded: the parent's own recording plays (PlayEngine 'ask'
 *   event); enabled: Settings "Show recording tips"
 * @returns {HintState}
 */
export function nextHint(s, e) {
  switch (e.type) {
    case "ask": {
      if (!e.enabled) return hide(s);
      if (e.recorded) return s.showing?.kind === e.kind ? hide(s) : s;
      const last = s.shownAt[e.kind];
      if (last !== undefined && e.now - last < HINT_COOLDOWN_MS) return s;
      return { showing: { kind: e.kind, until: e.now + HINT_SHOW_MS }, shownAt: { ...s.shownAt, [e.kind]: e.now } };
    }
    case "expire":
      return s.showing && e.now >= s.showing.until ? hide(s) : s;
    case "hide":
      return hide(s);
    default:
      return s;
  }
}

function hide(s) {
  return s.showing ? { ...s, showing: null } : s;
}

/** The tip's words, matching the real hold time: "Hold 1 s to record your own question". */
export function hintText(holdMs) {
  const seconds = Math.round(holdMs / 100) / 10;
  return `Hold ${seconds} s to record your own question`;
}
