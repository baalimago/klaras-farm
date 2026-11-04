// One recording slot in a parent panel: ▶ Play, Record / Re-record, a "won't play" flag, and the
// open <kf-recorder> with Cancel. Shared by the thing card (name, questions, sound) and the find
// game setup (questions, colour question, colour words), so every slot looks and works the same.
// It renders from what it is given; the host owns which slot is recording and saves the take.
import { h } from "../kf-guided-add/dom.js";

/**
 * @param {{services:object, clip:object|null, kind:string, take?:number, color?:string, what:string,
 *   recordText:string, cue:string, open:boolean, clipRef:object, failed?:boolean, recorder?:HTMLElement|null,
 *   onOpen:() => void, onCancel:() => void, onRecorded:(detail:{clip:object, blob:object}) => void}} o
 *   what: words for the aria-labels ("question 2"); recordText: the Record button's text;
 *   cue: what to say, shown on the recorder; recorder: an existing <kf-recorder> to keep (so a
 *   re-render never cuts a recording off)
 * @returns {HTMLElement} the slot, `.kf-tc-clip[data-kind][data-take]`; its open recorder is `slot.recorder`
 */
export function clipSlot(o) {
  const { services, clip, kind, take = 1, color, what, open, failed } = o;
  const box = h(
    "div",
    { class: "kf-tc-clip", "data-kind": kind, "data-take": String(take), "data-color": color },
    clip ? h("button", { class: "kf-btn icon", type: "button", "aria-label": `Play ${what}`, "data-action": "play", text: "▶", onclick: () => { services.audio?.unlock?.(); services.audio?.playClip?.(clip); } }) : null,
    failed ? h("span", { class: "kf-tc-flag", role: "status", text: "Won't play: re-record" }) : null,
    open
      ? null
      : h("button", {
          class: `kf-btn${failed ? " primary" : ""}`, type: "button", "data-action": "record",
          text: o.recordText, "aria-label": `${clip ? "Re-record" : "Record"} ${what}`,
          onclick: () => o.onOpen(),
        }),
  );
  if (!open) return box;
  let rec = o.recorder;
  if (!rec) {
    rec = document.createElement("kf-recorder");
    rec.addEventListener("kf-recorded", (e) => o.onRecorded(e.detail ?? {}));
  }
  rec.services = services;
  rec.label = o.cue;
  rec.clipRef = o.clipRef;
  rec.existing = clip;
  box.recorder = rec;
  box.append(
    h("div", { class: "kf-tc-recorder" }, rec,
      h("button", { class: "kf-btn ghost", type: "button", "data-action": "cancel-record", text: "Cancel", onclick: () => o.onCancel() })),
  );
  return box;
}
