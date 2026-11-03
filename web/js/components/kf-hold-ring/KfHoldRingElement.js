// <kf-hold-ring>: a felt ring at the finger that fills while a hold-to-edit is held (US-11.1).
// Driven by attributes so it works before upgrade: x, y (client px), progress (0..1), hidden.
// Session keeps it hidden for the first 0.5 s; it never takes pointer events.
export class KfHoldRingElement extends HTMLElement {
  static observedAttributes = ["x", "y", "progress"];

  connectedCallback() {
    if (!this.firstChild) {
      const ring = document.createElement("div");
      ring.className = "kf-hold-ring__felt";
      const stitch = document.createElement("div");
      stitch.className = "kf-hold-ring__stitch";
      ring.append(stitch);
      this.append(ring);
    }
    this.setAttribute("aria-hidden", "true");
    this._apply();
  }

  attributeChangedCallback() {
    this._apply();
  }

  /** 0..1, as last set. */
  get progress() {
    return Number(this.getAttribute("progress") ?? 0);
  }

  _apply() {
    this.style.setProperty("--x", `${Number(this.getAttribute("x") ?? 0)}px`);
    this.style.setProperty("--y", `${Number(this.getAttribute("y") ?? 0)}px`);
    this.style.setProperty("--p", String(Math.max(0, Math.min(1, this.progress))));
  }
}
