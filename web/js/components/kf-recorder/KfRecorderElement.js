// <kf-recorder>: one recording slot (flows 5 and 6; US-4.1, 4.3, 4.4, 4.7).
// States (data-state): ready → starting → recording → processing → saved;
// errors: denied (iPad Settings steps), error (data-error = too-short | silent | failed | unsupported).
// Every take that passes the checks is handed over: the recorder dispatches 'kf-recorded' {clip, blob}
// as soon as it finishes, then shows "Saved ✓" with ▶ Play and Re-record. It never writes to the
// store, so an existing clip stays until the parent panel saves the new one over it (one take per
// slot is kept, and that is what plays); a re-record that fails or is cancelled saves nothing and
// the old clip stays.
//
// Props: services ({audio, recorder, env?, engine?}), label (cue text), clipRef
// {thingId|null, language, kind, take}, existing (Clip|null).

const ERRORS = {
  "too-short": "That was too short. Say the word a little more slowly, then try again.",
  silent: "We couldn't hear anything. Hold the iPad a little closer and speak up.",
  failed: "Something went wrong with that recording.",
  unsupported: "This browser can't record sound. You can add the recording later on another device.",
};

export class KfRecorderElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.clipRef = { thingId: null, language: "en", kind: "name", take: 1 };
    this._label = "";
    this._existing = null;
    this._state = "ready";
    this._error = null;
    this._kept = null;     // {clip, blob, cappedAt5s} of the last take this recorder saved
    this._handle = null;
    this._meter = null;
    this._built = false;
  }

  get label() { return this._label; }
  set label(v) {
    this._label = v ?? "";
    if (this._labelEl) this._labelEl.textContent = this._label;
  }

  get existing() { return this._existing; }
  set existing(v) {
    this._existing = v ?? null;
    if (this._built && (this._state === "ready" || this._state === "saved")) this._render();
  }

  get state() { return this._state; }

  connectedCallback() {
    if (!this._built) {
      this._built = true;
      this.classList.add("kf-rec");
      this._labelEl = document.createElement("p");
      this._labelEl.className = "kf-rec-label";
      this._labelEl.textContent = this._label;
      this._body = document.createElement("div");
      this._body.className = "kf-rec-body";
      this._live = document.createElement("p");
      this._live.className = "kf-rec-status kf-note";
      this._live.setAttribute("role", "status");
      this._live.setAttribute("aria-live", "polite");
      this.append(this._labelEl, this._body, this._live);
    }
    this._render();
  }

  disconnectedCallback() {
    this._handle?.cancel();
    this._handle = null;
    if (this._state === "recording" || this._state === "starting") this._set("ready");
  }

  // ---- actions ----

  async record() {
    const { audio, recorder } = this.services ?? {};
    if (!recorder) return this._fail("unsupported");
    audio?.unlock?.(); // inside the click: iPad needs the gesture
    audio?.stop?.();
    this._set("starting");
    let handle;
    try {
      handle = await recorder.start({ onLevel: (v) => this._level(v) });
    } catch {
      return this._fail("failed");
    }
    if (!this.isConnected) return handle.cancel?.();
    this._handle = handle;
    // A handle that has already finished (denied, unsupported) never shows the recording UI.
    const early = await Promise.race([handle.done, Promise.resolve(null).then(() => null)]);
    if (!early && this._handle === handle) this._set("recording");
    const result = await handle.done;
    if (this._handle !== handle) return;
    this._handle = null;
    this._onResult(result);
  }

  stop() {
    const h = this._handle;
    if (!h) return;
    this._set("processing");
    h.stop();
  }

  play() {
    const audio = this.services?.audio;
    if (!audio) return;
    audio.unlock?.();
    let clip;
    let bytes;
    if (this._kept) {
      clip = this._kept.clip;
      bytes = this._kept.blob.bytes;
    } else if (this._existing) {
      clip = this._existing;
    }
    if (!clip) return;
    audio.playClip(clip, bytes ? { bytes } : {});
    const thingId = this.clipRef?.thingId;
    if (thingId) this.services.engine?.hop?.(thingId); // the thing hops while its voice plays
  }

  // ---- internals ----

  /** A take that passed the checks is kept straight away (no Keep step). */
  _save(t) {
    const clip = this._clipFrom(t);
    const blob = { sha256: t.sha256, mime: t.mime, size: t.bytes?.byteLength ?? 0, createdAt: this._now(), bytes: t.bytes };
    this._kept = { clip, blob, cappedAt5s: !!t.cappedAt5s };
    this._set("saved");
    this.dispatchEvent(new CustomEvent("kf-recorded", { bubbles: true, composed: true, detail: { clip, blob } }));
  }

  _onResult(r) {
    if (r?.ok) {
      this._save(r);
    } else if (r?.error === "denied") {
      this._set("denied");
    } else if (r?.error === "cancelled") {
      this._set(this._kept ? "saved" : "ready"); // a cancelled re-record keeps the saved take
    } else {
      this._fail(r?.error in ERRORS ? r.error : "failed");
    }
  }

  _fail(code) {
    this._error = code;
    this._set("error");
  }

  _set(state) {
    this._state = state;
    if (state !== "error") this._error = null;
    this._render();
  }

  _clipFrom(t) {
    const ref = this.clipRef ?? {};
    const clip = {
      thingId: ref.thingId ?? null,
      language: ref.language,
      kind: ref.kind,
      take: ref.take ?? 1,
      blobSha256: t.sha256,
      mime: t.mime,
      durationMs: t.durationMs,
      trimStartMs: t.trimStartMs,
      trimEndMs: t.trimEndMs,
      gainDb: t.gainDb,
    };
    const env = this.services?.env;
    if (env?.newId) clip.id = env.newId();
    clip.createdAt = this._now();
    return clip;
  }

  _now() {
    return this.services?.env?.now?.() ?? new Date().toISOString();
  }

  _level(v) {
    if (this._meter) this._meter.style.transform = `scaleX(${Math.max(0.02, Math.min(1, v)).toFixed(3)})`;
  }

  _btn(text, cls, onClick, aria) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `kf-btn ${cls}`.trim();
    b.textContent = text;
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", onClick);
    return b;
  }

  _micButton(label) {
    const b = this._btn("", "kf-rec-mic", () => this.record(), label);
    const span = document.createElement("span");
    span.className = "kf-rec-mic-text";
    span.textContent = label;
    const wrap = document.createElement("div");
    wrap.className = "kf-rec-start";
    wrap.append(b, span);
    span.setAttribute("aria-hidden", "true");
    return wrap;
  }

  _render() {
    if (!this._built) return;
    this.dataset.state = this._state;
    if (this._error) this.dataset.error = this._error;
    else delete this.dataset.error;
    const body = this._body;
    body.replaceChildren();
    this._meter = null;
    const row = document.createElement("div");
    row.className = "kf-row";
    let status = "";

    switch (this._state) {
      case "ready": {
        const hasOld = !!this._existing;
        body.append(this._micButton(hasOld ? "Re-record" : "Record"));
        if (hasOld) row.append(this._btn("▶ Play", "", () => this.play()));
        break;
      }
      case "starting":
        status = "Getting the microphone ready…";
        break;
      case "recording": {
        const mic = document.createElement("div");
        mic.className = "kf-rec-mic recording";
        mic.setAttribute("aria-hidden", "true");
        const meter = document.createElement("div");
        meter.className = "kf-rec-meter";
        meter.setAttribute("aria-hidden", "true");
        this._meter = document.createElement("span");
        meter.append(this._meter);
        const note = document.createElement("p");
        note.className = "kf-note";
        note.textContent = "Listening… stops by itself when you pause";
        body.append(mic, meter, note);
        row.append(this._btn("■ Stop", "primary", () => this.stop(), "Stop"));
        status = "Recording";
        break;
      }
      case "processing":
        status = "One moment…";
        break;
      case "saved": {
        const p = document.createElement("p");
        p.className = "kf-rec-saved";
        p.textContent = "Saved ✓";
        body.append(p);
        if (this._kept?.cappedAt5s) {
          const note = document.createElement("p");
          note.className = "kf-note";
          note.textContent = "Stopped at 5 seconds. If it got cut off, re-record it a little shorter.";
          body.append(note);
        }
        row.append(this._btn("▶ Play", "", () => this.play()), this._btn("Re-record", "", () => this.record()));
        status = "Saved";
        break;
      }
      case "denied": {
        const box = document.createElement("div");
        box.className = "kf-warning kf-rec-denied";
        box.innerHTML =
          "<p><strong>The microphone is turned off for Klara's Farm.</strong> To turn it on:</p>" +
          "<ol>" +
          "<li>Open the <b>Settings</b> app on the iPad.</li>" +
          "<li>Tap <b>Apps</b>, then <b>Safari</b> (on older iPads, scroll down to <b>Safari</b>).</li>" +
          "<li>Tap <b>Microphone</b> and choose <b>Allow</b> (or <b>Ask</b>).</li>" +
          "<li>Come back here and tap <b>Try again</b>.</li>" +
          "</ol>" +
          '<p class="kf-note">You can keep going without a recording and add it later from the thing\'s card.</p>';
        body.append(box);
        row.append(this._btn("Try again", "primary", () => this.record()));
        status = "Microphone is off";
        break;
      }
      case "error": {
        const p = document.createElement("p");
        p.className = "kf-rec-error";
        p.textContent = ERRORS[this._error] ?? ERRORS.failed;
        body.append(p);
        if (this._error !== "unsupported") row.append(this._btn("Try again", "primary", () => this.record()));
        if (this._kept || this._existing) {
          const kept = document.createElement("p");
          kept.className = "kf-note";
          kept.textContent = "The recording you already have is still saved.";
          body.append(kept);
          row.append(this._btn("▶ Play", "", () => this.play(), "Play the saved recording"));
        }
        status = p.textContent;
        break;
      }
    }
    if (row.childElementCount) body.append(row);
    this._live.textContent = status;
  }
}
