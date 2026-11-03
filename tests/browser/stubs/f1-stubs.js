// Test stubs for package F1's dependencies, injected into a modulePage as an inline module.
// They implement exactly the documented interfaces (design/IMPLEMENTATION.md):
//   <kf-draw-pad mode color>  → dispatches `kf-stroke {points}` / `kf-stroke-open {gap}` (A)
//   <kf-recorder services label clipRef existing> → dispatches `kf-recorded {clip, blob}` when a take finishes (D)
//   audio.chime(kind), audio.playClip(clip), 'decode-failed' events (D); engine.dropIn(id) (B);
//   shell.confirm(opts) → Promise<bool>, shell.toast(msg, {undo}) (F2); session.activity() etc. (C)

class StubDrawPad extends HTMLElement {
  connectedCallback() {
    this.dataset.stub = "draw-pad";
  }
  /** Test hook: pretend the parent drew `points` (board coords). */
  emitStroke(points) {
    this.dispatchEvent(new CustomEvent("kf-stroke", { detail: { points } }));
  }
  emitOpen(gap = { a: [0.2, 0.2], b: [0.5, 0.5] }) {
    this.dispatchEvent(new CustomEvent("kf-stroke-open", { detail: { gap } }));
  }
}

let takeNo = 0;
class StubRecorder extends HTMLElement {
  connectedCallback() {
    this.dataset.stub = "recorder";
    this.replaceChildren();
    const label = document.createElement("p");
    label.className = "stub-label";
    label.textContent = this.label ?? "";
    const take = document.createElement("button");
    take.type = "button";
    take.className = "kf-btn";
    take.dataset.stub = "take";
    take.textContent = "Finish take";
    take.addEventListener("click", () => this.finishTake());
    this.append(label, take);
  }
  set label(v) {
    this._label = v;
    const p = this.querySelector(".stub-label");
    if (p) p.textContent = v;
  }
  get label() { return this._label; }
  /** What the real recorder hands over as soon as a good take finishes (no Keep step). */
  finishTake() {
    const n = ++takeNo;
    const sha = `f1${n.toString(16)}`.padStart(64, "0");
    const bytes = new Uint8Array([n & 255, 1, 2, 3]).buffer;
    const ref = this.clipRef ?? {};
    const clip = { thingId: ref.thingId ?? null, language: ref.language, kind: ref.kind, take: ref.take ?? 1, blobSha256: sha, mime: "audio/mp4", durationMs: 700, trimStartMs: 20, trimEndMs: 680, gainDb: 2 };
    const blob = { sha256: sha, mime: "audio/mp4", size: 4, createdAt: "2026-11-03T12:00:00.000Z", bytes };
    window.__f1.recorded.push({ ref: { ...ref }, existing: this.existing ?? null, sha });
    this.dispatchEvent(new CustomEvent("kf-recorded", { detail: { clip, blob } }));
  }
}

customElements.define("kf-draw-pad", StubDrawPad);
customElements.define("kf-recorder", StubRecorder);

const f1 = {
  recorded: [],
  chimes: [],
  played: [],
  dropped: [],
  confirms: [],
  toasts: [],
  confirmAnswer: true,
  makeServices({ store, scripts }) {
    const audio = new EventTarget();
    audio.chime = (kind) => f1.chimes.push(kind);
    audio.playClip = (clip) => { f1.played.push(clip.id); return Promise.resolve(); };
    audio.playThing = () => Promise.resolve();
    const session = new EventTarget();
    session.state = { mode: "edit", panel: null };
    session.activity = () => {};
    session.openPanel = () => {};
    session.closePanel = () => {};
    return {
      store,
      scripts,
      audio,
      session,
      engine: { dropIn: (id) => f1.dropped.push(id) },
      recorder: {},
      shell: {
        confirm: (opts) => { f1.confirms.push(opts); return Promise.resolve(f1.confirmAnswer); },
        toast: (message, opts = {}) => { f1.toasts.push({ message, undo: opts.undo }); return Promise.resolve(); },
      },
      flags: {},
    };
  },
};
window.__f1 = f1;
