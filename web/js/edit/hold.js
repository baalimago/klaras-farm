// Hold-to-edit gesture (US-11.1), as a pure reducer over pointer events with times in ms.
// Phases: idle → pending (nothing shown) → showing (ring fills) → armed, or cancelled.
// The first third of the hold (0.5 s of 1.5 s) shows nothing, so a normal toddler hold sees nothing.

export const HOLD = Object.freeze({
  holdMs: 1500,
  showMs: 500,
  moveTolPx: 10,
  edgeBottomPx: 40,
  edgeSidePx: 20,
  palmPx: 60,
});

const IDLE = Object.freeze({ phase: "idle", progress: 0 });

export function initialHold() {
  return IDLE;
}

const isPalm = (e) => (e.width ?? 0) > HOLD.palmPx || (e.height ?? 0) > HOLD.palmPx;
const active = (s) => s.phase === "pending" || s.phase === "showing";
const cancel = (s, reason) => ({ phase: "cancelled", progress: 0, reason, pointerId: s.pointerId, x: s.x, y: s.y });

function startsAllowed(e) {
  if (isPalm(e)) return "palm";
  if (e.vh != null && e.y > e.vh - HOLD.edgeBottomPx) return "edge";
  if (e.vw != null && (e.x < HOLD.edgeSidePx || e.x > e.vw - HOLD.edgeSidePx)) return "edge";
  return null;
}

/**
 * @param {object} s  previous hold state
 * @param {{type:'down'|'move'|'up'|'cancel'|'second-pointer'|'tick', x?:number, y?:number, t?:number,
 *          width?:number, height?:number, vw?:number, vh?:number, pointerId?:number}} e
 * @param {{holdMs?:number}} [opts]
 * @returns the next state; the same object when nothing changed
 */
export function nextHold(s, e, opts = {}) {
  const holdMs = opts.holdMs ?? HOLD.holdMs;
  const showMs = Math.min(HOLD.showMs, holdMs / 3);
  switch (e.type) {
    case "down": {
      if (active(s)) return e.pointerId === s.pointerId ? s : cancel(s, "second-pointer");
      const blocked = startsAllowed(e);
      if (blocked) return { phase: "cancelled", progress: 0, reason: blocked, pointerId: e.pointerId, x: e.x, y: e.y };
      return { phase: "pending", progress: 0, pointerId: e.pointerId, x: e.x, y: e.y, t0: e.t, holdMs, showMs };
    }
    case "move": {
      if (!active(s) || e.pointerId !== s.pointerId) return s;
      if (isPalm(e)) return cancel(s, "palm");
      if (Math.hypot(e.x - s.x, e.y - s.y) > HOLD.moveTolPx) return cancel(s, "moved");
      return s;
    }
    case "up":
    case "cancel": {
      if (e.pointerId != null && s.pointerId != null && e.pointerId !== s.pointerId) return s;
      if (active(s)) return cancel(s, e.type === "up" ? "released" : "cancel");
      if (s.phase === "armed" && !s.released) return { ...s, released: true };
      return s;
    }
    case "second-pointer":
      return active(s) ? cancel(s, "second-pointer") : s;
    case "tick": {
      if (!active(s)) return s;
      const elapsed = e.t - s.t0;
      if (elapsed >= s.holdMs) return { ...s, phase: "armed", progress: 1, released: false };
      if (elapsed >= s.showMs) {
        const progress = (elapsed - s.showMs) / (s.holdMs - s.showMs);
        return s.phase === "showing" && s.progress === progress ? s : { ...s, phase: "showing", progress };
      }
      return s;
    }
    default:
      return s;
  }
}
