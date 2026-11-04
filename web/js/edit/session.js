// Edit session state machine (US-11.4), pure. Times are ms numbers passed in.
//   mode:  play → gate (adult check) → edit ⇄ scene → play
//   panel: null | {name, params}  (a card, guided add, scenes, settings … over the edit view)
//   then:  null | {name, params}  the panel a hold asked for (a long press on a find game button
//          opens that game's setup): kept through the adult check, opened when edit mode starts
// Edit mode always ends: Done ends it fully; 60 s without activity in the plain edit/scene view
// closes it and opens a 5-minute grace in which the hold alone reopens it. A play tap cancels grace.

export const AUTO_CLOSE_MS = 60000;
export const GRACE_MS = 5 * 60000;

export function initialSession(nowMs = 0) {
  return { mode: "play", panel: null, then: null, lastActivityAt: nowMs, graceUntil: 0 };
}

const editing = (s) => s.mode === "edit" || s.mode === "scene";

/**
 * @param {{mode:'play'|'gate'|'edit'|'scene', panel:null|{name:string, params:object}, lastActivityAt:number, graceUntil:number}} s
 * @param {{type:string, name?:string, params?:object, then?:{name:string, params?:object}|null}} e
 * @param {number} now
 * @returns the next state; the same object when nothing changed
 */
export function nextSession(s, e, now) {
  switch (e.type) {
    case "hold-armed": {
      if (s.mode !== "play") return s;
      const then = e.then ? { name: e.then.name, params: e.then.params ?? {} } : null;
      if (now < s.graceUntil) return { ...s, mode: "edit", panel: then, then: null, lastActivityAt: now, graceUntil: 0 };
      return { ...s, mode: "gate", panel: null, then, lastActivityAt: now };
    }
    case "gate-pass":
      return s.mode === "gate" ? { ...s, mode: "edit", panel: s.then ?? null, then: null, lastActivityAt: now, graceUntil: 0 } : s;
    case "gate-fail":
      return s.mode === "gate" ? { ...s, mode: "play", panel: null, then: null } : s;
    case "done":
      return s.mode === "play" ? s : { ...s, mode: "play", panel: null, graceUntil: 0 };
    case "activity":
      return s.mode === "play" || s.lastActivityAt === now ? s : { ...s, lastActivityAt: now };
    case "open-panel":
      if (!editing(s)) return s;
      return { ...s, panel: { name: e.name, params: e.params ?? {} }, lastActivityAt: now };
    case "close-panel":
      return s.panel ? { ...s, panel: null, lastActivityAt: now } : s;
    case "scene-tools":
      return s.mode === "edit" ? { ...s, mode: "scene", panel: null, lastActivityAt: now } : s;
    case "scene-done":
      return s.mode === "scene" ? { ...s, mode: "edit", panel: null, lastActivityAt: now } : s;
    case "tick":
      if (!editing(s) || s.panel) return s;
      if (now - s.lastActivityAt < AUTO_CLOSE_MS) return s;
      return { ...s, mode: "play", panel: null, graceUntil: now + GRACE_MS };
    case "play-tap":
      return s.mode === "play" && s.graceUntil ? { ...s, graceUntil: 0 } : s;
    default:
      return s;
  }
}
