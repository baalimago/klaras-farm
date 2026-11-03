// <kf-dialog>: the shared confirm dialog and toast. One element per use; it removes itself.
//   el.confirm({title, body, confirmLabel, cancelLabel, danger}) → Promise<boolean>
//   el.toast(message, {undo, undoLabel, ms = 5000}) → Promise<boolean>  (true when undone)
// The Shell creates a fresh element, appends it to #parent-layer and calls one of these.
// `body` is a string or an array of strings (one paragraph each); it is set as text only.
import { h, newId } from "./dom.js";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class KfDialogElement extends HTMLElement {
  constructor() {
    super();
    this._settle = null;
    this._timer = 0;
    this._inerted = [];
    this._returnFocus = null;
    this._onKey = this._onKey.bind(this);
  }

  disconnectedCallback() {
    // Removed from outside: never leave a promise hanging or the page inert.
    this._finish(false);
  }

  /** Modal confirmation. Escape, Cancel and the backdrop resolve false. */
  confirm({ title = "Are you sure?", body = "", confirmLabel = "OK", cancelLabel = "Cancel", danger = false } = {}) {
    this._finish(false);
    this.dataset.kind = "confirm";
    this.replaceChildren();
    const titleId = newId("dlg-title");
    const bodyId = newId("dlg-body");
    const paragraphs = [].concat(body).filter((p) => p !== "" && p != null);
    const cancel = h("button", { type: "button", class: "kf-btn", text: cancelLabel, onclick: () => this._finish(false) });
    const ok = h("button", { type: "button", class: `kf-btn ${danger ? "danger" : "primary"}`, text: confirmLabel, onclick: () => this._finish(true) });
    const sheet = h(
      "div",
      {
        class: "kf-sheet center kf-dialog-sheet",
        role: "alertdialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "aria-describedby": paragraphs.length ? bodyId : null,
      },
      [h("h2", { id: titleId, text: title }), h("div", { id: bodyId }, paragraphs.map((p) => h("p", { text: String(p) }))), h("div", { class: "kf-row end" }, [cancel, ok])],
    );
    const backdrop = h("div", { class: "kf-dialog-backdrop", onclick: () => this._finish(false) });
    this.append(backdrop, sheet);
    this._returnFocus = document.activeElement;
    this._makeOthersInert();
    document.addEventListener("keydown", this._onKey, true);
    // Destructive actions start on the safe button.
    (danger ? cancel : ok).focus();
    return new Promise((resolve) => (this._settle = resolve));
  }

  /** A short message at the bottom, optionally with Undo. Replaces any toast already showing. */
  toast(message, { undo = null, undoLabel = "Undo", ms = 5000 } = {}) {
    this._finish(false);
    for (const other of document.querySelectorAll('kf-dialog[data-kind="toast"]')) if (other !== this) other.remove();
    this.dataset.kind = "toast";
    this.replaceChildren();
    const box = h("div", { class: "kf-toast", role: "status", "aria-live": "polite" }, [h("span", { text: String(message) })]);
    if (typeof undo === "function") {
      box.append(
        h("button", {
          type: "button",
          class: "kf-btn ghost kf-toast-undo",
          text: undoLabel,
          onclick: () => {
            try {
              undo();
            } finally {
              this._finish(true);
            }
          },
        }),
      );
    }
    this.append(box);
    const settled = new Promise((resolve) => (this._settle = resolve));
    this._timer = setTimeout(() => this._finish(false), ms);
    return settled;
  }

  _onKey(e) {
    if (this.dataset.kind !== "confirm") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this._finish(false);
    } else if (e.key === "Tab") {
      const items = [...this.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = this.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /** Everything else in the parent layer and the stage is inert while the modal is open (VoiceOver too). */
  _makeOthersInert() {
    const parent = this.parentElement;
    const roots = [...(parent ? parent.children : []), document.getElementById("stage")].filter(Boolean);
    for (const el of roots) {
      if (el === this || el.inert || el.contains(this)) continue;
      el.inert = true;
      this._inerted.push(el);
    }
  }

  _finish(value) {
    clearTimeout(this._timer);
    document.removeEventListener("keydown", this._onKey, true);
    for (const el of this._inerted) el.inert = false;
    this._inerted = [];
    const settle = this._settle;
    this._settle = null;
    if (!settle) return;
    const back = this._returnFocus;
    this._returnFocus = null;
    if (this.isConnected) this.remove();
    if (back && back.isConnected && typeof back.focus === "function") back.focus();
    settle(value);
  }
}
