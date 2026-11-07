// One recording slot in a parent panel: what plays for it now ("Your recording" with ▶, or "iPad
// voice for now"), Record / Re-record, a "won't play" flag, and the open <kf-recorder> with Cancel.
// Shared by the thing card (name, questions, sound) and the find game setup (questions, colour
// question, colour words), so every slot looks and works the same. It renders from what it is
// given; the host owns which slot is recording, saves the take, and says what plays (play/voice.js).
import { h } from "../kf-guided-add/dom.js";
import { capital, device } from "../../io/device.js";

/**
 * @param {{services:object, clip:object|null, kind:string, take?:number, color?:string, what:string,
 *   recordText:string, cue:string, open:boolean, clipRef:object, failed?:boolean, recorder?:HTMLElement|null,
 *   voice?:{source:string, text:string, clip?:object}|null,
 *   onOpen:() => void, onCancel:() => void, onRecorded:(detail:{clip:object, blob:object}) => void}} o
 *   clip: this slot's own recording (Re-record replaces it); what: words for the aria-labels
 *   ("question 2"); recordText: the Record button's text; cue: what to say, shown on the recorder;
 *   voice (optional): what Klara hears for this slot now, `source` one of recording | other-language | voice |
 *   skipped | none, `text` the words shown, `clip` what ▶ plays when it is not `clip`;
 *   recorder: an existing <kf-recorder> to keep (so a re-render never cuts a recording off)
 * @returns {HTMLElement} the slot, `.kf-tc-clip[data-kind][data-take][data-voice]`; its open recorder is `slot.recorder`
 */
export function clipSlot(o) {
  const { services, clip, kind, take = 1, color, what, open, failed } = o;
  const voice = o.voice ?? null;
  const plays = clip ?? voice?.clip ?? null;
  // A slot that says what plays and has no recording of its own: Record is the invitation, so it stands out.
  const invite = !!voice && !clip && !open;
  const box = h(
    "div",
    { class: "kf-tc-clip", "data-kind": kind, "data-take": String(take), "data-color": color, "data-voice": voice?.source },
    plays ? h("button", { class: "kf-btn icon", type: "button", "aria-label": `Play ${what}`, "data-action": "play", text: "▶", onclick: () => { services.audio?.unlock?.(); services.audio?.playClip?.(plays); } }) : null,
    voice ? h("span", { class: "kf-tc-voice", "data-voice": voice.source, text: voice.text }) : null,
    failed ? h("span", { class: "kf-tc-flag", role: "status", text: "Won't play: re-record" }) : null,
    open
      ? null
      : h("button", {
          class: `kf-btn${failed || invite ? " primary" : ""}`, type: "button", "data-action": "record",
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

/** Copy for a question line's voice (play/voice.js lineVoice), or null when it says nothing. */
export function lineVoiceText(source) {
  if (source === "recording") return { source, text: "Your recording" };
  if (source === "voice") return { source, text: `${capital(device().voice)} for now` };
  if (source === "skipped") return { source, text: "Not asked until recorded" };
  return null;
}
