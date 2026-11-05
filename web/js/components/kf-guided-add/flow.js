// What covers a step of <kf-guided-add>, as a pure state machine (playtest 3). No DOM.
// The step itself and the thing live in the draft (steps.js); this is the screen state around them:
// whether Klara's full-screen eye stamping or the "Stop adding?" dialog is open, and whether the
// Name step asks for a name. Every way through it ends where the parent can leave: ‹ Back and ✕ are
// on every panel, the dialog has Keep going, and stamping has the grown-up's Cancel and Done.
//
// State: {overlay, prompt}
//   overlay  "none"   the step's panel, with ‹ Back and ✕
//            "stamp"  Klara stamps eyes full screen (only over a body that can take eyes)
//            "leave"  "Stop adding this animal?": Keep going, Keep draft, Stop adding
//   prompt   null | "name"  the Name step says a name is needed before going on
//
// Events:
//   {type: "step"}               the step changed (Back, Next, Finish needing a name): all closes
//   {type: "stamp", canStamp}    "Let Klara stamp"; ignored when there is no body to stamp on
//   {type: "stampEnded"}         stamping's Done or Cancel
//   {type: "close"}              ✕, or ‹ Back on the first step: ask
//   {type: "stay"}               Keep going
//   {type: "needName"}           Next or Finish with no name in any language
//   {type: "named"}              a name was typed
import { STEPS, hasName } from "./steps.js";

export const NONE = "none";
export const STAMP = "stamp";
export const LEAVE = "leave";

/** @returns {{overlay: string, prompt: null | string}} */
export function initialFlow() {
  return { overlay: NONE, prompt: null };
}

export function flowReducer(s, e) {
  switch (e.type) {
    case "step":
      return initialFlow();
    case "stamp":
      return s.overlay === NONE && e.canStamp ? { ...s, overlay: STAMP } : s;
    case "stampEnded":
      return s.overlay === STAMP ? { ...s, overlay: NONE } : s;
    case "close":
      return { ...s, overlay: LEAVE };
    case "stay":
      return s.overlay === LEAVE ? { ...s, overlay: NONE } : s;
    case "needName":
      return { ...s, prompt: "name" };
    case "named":
      return s.prompt ? { ...s, prompt: null } : s;
    default:
      return s;
  }
}

export const NAME_STEP = STEPS.indexOf("name");

/** ‹ Back on step `index`: the step before, or, on the first step, ask whether to stop adding. */
export function backAction(index) {
  return index > 0 ? { type: "go", step: index - 1 } : { type: "leave" };
}

/** Next on step `index`: the next step, except past Name with no name in any language. */
export function nextAction(index, thing) {
  if (index === NAME_STEP && !hasName(thing)) return { type: "needName", step: NAME_STEP };
  return { type: "go", step: Math.min(index + 1, STEPS.length - 1) };
}

/** Finish: nothing is saved without a name; the parent is sent to the Name step and asked. */
export function finishAction(thing) {
  return hasName(thing) ? { type: "finish" } : { type: "needName", step: NAME_STEP };
}

/** Nothing worth keeping yet (no body, no name, no recording): ✕ can close without asking. */
export function emptyDraft(draft) {
  const t = draft?.thing ?? {};
  return !(Array.isArray(t.outline) && t.outline.length) && !hasName(t) && !(draft?.clips?.length);
}
