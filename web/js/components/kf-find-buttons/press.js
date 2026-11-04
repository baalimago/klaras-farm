// A press on a find game button, as a pure state machine (playtest round 3).
// A short tap starts the game when the finger lifts: pointerup is a user activation on iOS, so the
// question's device voice is allowed to start there (it is not on pointerdown). Holding the button
// until the Session's hold arms (the ring fills, about 1 s) opens that game's setup for grown-ups
// instead, after the adult check, and the lift then starts nothing.
//
//   idle ──down──▶ down ──up (same pointer)──▶ idle, start the game
//                   │ ──armed (the hold completed)──▶ held ──up──▶ idle (nothing)
//                   └─ cancel ──▶ idle
//   A second pointer going down while pressed is ignored (primary pointer only).

/** @typedef {{phase:'idle'|'down'|'held', kind:string|null, pointerId:number|null}} PressState */

/** @returns {PressState} */
export function initialPress() {
  return { phase: "idle", kind: null, pointerId: null };
}

/**
 * @param {PressState} s
 * @param {{type:'down', kind:string, pointerId:number} | {type:'up', pointerId:number} | {type:'armed'} | {type:'cancel'}} e
 * @returns {{state: PressState, start: string|null}}  start: the game to start now, if any
 */
export function nextPress(s, e) {
  const idle = initialPress();
  switch (e.type) {
    case "down":
      if (s.phase !== "idle") return { state: s, start: null };
      return { state: { phase: "down", kind: e.kind, pointerId: e.pointerId }, start: null };
    case "armed":
      return { state: s.phase === "down" ? { ...s, phase: "held" } : s, start: null };
    case "up":
      if (s.phase === "idle" || e.pointerId !== s.pointerId) return { state: s, start: null };
      return { state: idle, start: s.phase === "down" ? s.kind : null };
    case "cancel":
      return { state: idle, start: null };
    default:
      return { state: s, start: null };
  }
}
