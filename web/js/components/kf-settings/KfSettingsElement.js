// <kf-settings>: the parent settings panel (US-5.4, 7.3, 7.4, 7.5, 8.2, 8.3, 9.1, 11.2).
// Languages (add/remove, which plays or "alternate"), sleep timer, adult check kind,
// export (pre-built so the share sheet opens inside the tap), import (confirm with counts,
// replace, Undo until next boot), storage status, privacy, Guided Access guide, delete all data,
// "Update ready", app version. Props: services, params. Dispatches kf-close.
import { h, newId, plural, joinAnd, languageName, reportFailure } from "../kf-dialog/dom.js";

const SLEEP_OPTIONS = [
  [0, "Off"],
  [5, "5 minutes"],
  [8, "8 minutes"],
  [15, "15 minutes"],
];
const GATE_OPTIONS = [
  ["keypad", "Keypad code (tap 3 digits)"],
  ["sum", "Simple sum"],
];
const COMMON_LANGUAGES = ["en", "sv", "de", "fr", "es", "it", "nl", "da", "nb", "fi", "pl", "pt", "cs", "hu", "ro", "el", "tr", "uk", "ru", "ar", "hi", "zh", "ja", "ko"];
const IMPORT_ERRORS = {
  corrupt: "This file is damaged and can't be imported. Nothing was changed.",
  newer: "This file was made with a newer version of Klara's Farm. Update the app, then try again. Nothing was changed.",
  "not-a-farm": "This isn't a Klara's Farm file. Nothing was changed.",
};

/** Survives remounts of the panel, and ends with the page (US-8.3: Undo import until next boot). */
let importedThisBoot = false;

const countsText = (c) => joinAnd([plural(c.places, "place"), plural(c.things, "thing"), plural(c.clips, "recording")]);
const countsOf = (s) => ({ places: s?.places?.length ?? 0, things: s?.things?.length ?? 0, clips: s?.clips?.length ?? 0 });

export class KfSettingsElement extends HTMLElement {
  constructor() {
    super();
    this.services = null;
    this.params = {};
    this._persist = null; // null unknown, true, false
    this._estimate = null;
    this._export = null; // Promise<{file, name, counts}>
    this._exportReady = null;
    this._message = "";
    this._exportTimer = 0;
    this._onChange = () => {
      this.render();
      this.scheduleExport();
    };
    this._onUpdate = () => this.render();
    this._onPointer = () => this.services?.session?.activity?.();
    this._onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector('kf-dialog[data-kind="confirm"]')) this.close();
    };
  }

  get store() { return this.services.store; }

  connectedCallback() {
    this.store.addEventListener("change", this._onChange);
    this.services.session?.addEventListener?.("update-ready", this._onUpdate);
    this.addEventListener("pointerdown", this._onPointer);
    this.addEventListener("keydown", this._onKey);
    this.render();
    this.checkStorage();
    this.prepareExport();
  }

  disconnectedCallback() {
    this.store?.removeEventListener("change", this._onChange);
    this.services?.session?.removeEventListener?.("update-ready", this._onUpdate);
    this.removeEventListener("pointerdown", this._onPointer);
    this.removeEventListener("keydown", this._onKey);
    clearTimeout(this._exportTimer);
  }

  close() { this.dispatchEvent(new CustomEvent("kf-close", { bubbles: true })); }

  /** Replaced in tests; after Delete all data the app starts from scratch. */
  reload() { location.reload(); }

  // ---------------------------------------------------------------- render

  render() {
    const focusKey = this.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const titleId = newId("settings-title");
    const s = this.store.settings;
    this.replaceChildren(
      h("div", { class: "kf-settings-scrim", onclick: () => this.close() }),
      h("section", { class: "kf-sheet full kf-settings", role: "dialog", "aria-labelledby": titleId }, [
        h("div", { class: "kf-settings-head" }, [
          h("h2", { id: titleId, text: "Settings" }),
          h("button", { type: "button", class: "kf-btn ghost icon", "aria-label": "Close", "data-key": "close", text: "✕", onclick: () => this.close() }),
        ]),
        ...this.warnings(),
        this.updateSection(),
        this.languagesSection(s),
        this.playSection(s),
        this.dataSection(),
        this.helpSection(),
        this.dangerSection(),
        h("p", { class: "kf-note kf-settings-version", text: `Klara's Farm, version ${this.services.appVersion ?? "dev"}` }),
      ]),
    );
    if (focusKey) this.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  warnings() {
    const out = [];
    const w = this.services.warnings ?? [];
    if (w.includes("no-storage")) out.push(h("p", { class: "kf-warning", text: "This browser isn't keeping anything (private browsing or storage turned off). Play works, but drawings and recordings are lost when the app closes." }));
    if (w.includes("corrupt")) out.push(h("p", { class: "kf-warning", text: "Some saved data couldn't be read. If you have an export, import it to restore your farm." }));
    if (w.includes("blocked")) out.push(h("p", { class: "kf-warning", text: "Another window of Klara's Farm is open. Close it so changes are saved properly." }));
    return out;
  }

  updateSection() {
    if (!this.services.updateReady) return null;
    return h("div", { class: "kf-settings-update" }, [
      h("p", { text: "A new version of Klara's Farm is ready." }),
      h("button", {
        type: "button",
        class: "kf-btn primary",
        "data-key": "update",
        text: "Update now",
        onclick: () => Promise.resolve(this.services.storage?.applyUpdate?.()).catch((e) => this.showMessage("The update didn't install. Try again later.", e)),
      }),
    ]);
  }

  languagesSection(s) {
    const list = h("ul", { class: "kf-lang-list" });
    for (const code of s.languages) {
      const name = languageName(code);
      list.append(
        h("li", { class: "kf-lang" }, [
          h("span", { text: name }),
          h("button", {
            type: "button",
            class: "kf-btn ghost",
            "aria-label": `Remove ${name}`,
            "data-key": `remove-${code}`,
            text: "Remove",
            disabled: s.languages.length <= 1,
            onclick: () => this.save({ languages: s.languages.filter((l) => l !== code) }),
          }),
        ]),
      );
    }
    // Languages with ready-made "Where is the…" scripts first, then other common ones.
    const byName = (a, b) => languageName(a).localeCompare(languageName(b));
    const scripted = Object.keys(this.services.scripts ?? {}).filter((c) => !s.languages.includes(c)).sort(byName);
    const others = COMMON_LANGUAGES.filter((c) => !s.languages.includes(c) && !scripted.includes(c)).sort(byName);
    const known = [...scripted, ...others];
    const addId = newId("add-lang");
    const group = (label, codes) => (codes.length ? h("optgroup", { label }, codes.map((c) => h("option", { value: c, text: languageName(c) }))) : null);
    const addSelect = h("select", { id: addId, "data-key": "add-lang" }, [group("With ready-made questions", scripted), group("Other languages", others)]);
    const playId = newId("play-lang");
    const playOptions = s.languages.map((c) => h("option", { value: c, text: languageName(c), selected: s.playLanguage === c }));
    if (s.languages.length > 1) playOptions.push(h("option", { value: "alternate", text: "Alternate between languages", selected: s.playLanguage === "alternate" }));
    const playSelect = h("select", { id: playId, "data-key": "play-lang", onchange: (e) => this.save({ playLanguage: e.target.value }) }, playOptions);
    return h("section", { class: "kf-settings-section", "aria-label": "Languages" }, [
      h("h3", { text: "Languages" }),
      h("p", { class: "kf-note", text: "Each parent can record names in their own language. Recordings stay when a language is removed." }),
      list,
      h("div", { class: "kf-row kf-lang-add" }, [
        h("div", { class: "kf-field" }, [h("label", { htmlFor: addId, text: "Add a language" }), addSelect]),
        h("button", {
          type: "button",
          class: "kf-btn",
          "data-key": "add-lang-btn",
          text: "Add language",
          disabled: known.length === 0,
          onclick: () => addSelect.value && this.save({ languages: [...s.languages, addSelect.value] }),
        }),
      ]),
      h("div", { class: "kf-field" }, [h("label", { htmlFor: playId, text: "Plays in" }), playSelect]),
    ]);
  }

  /** Find it (US-6.3): per scene. Asks in the parent's recorded voice, or the device's voice until then. */
  findItField() {
    const store = this.services.store;
    const place = store.currentPlace;
    if (!place) return null;
    const id = newId("find-it");
    const things = store.thingsIn(place.id);
    const recorded = things.filter((t) => store.clipsFor(t.id, { kind: "prompt" }).length > 0).length;
    const input = h("input", {
      type: "checkbox",
      id,
      "data-key": "find-it",
      checked: place.findIt === true,
      onchange: async (e) => {
        try {
          await store.updatePlace({ placeId: place.id, patch: { findIt: e.target.checked } });
        } catch (err) {
          e.target.checked = !e.target.checked;
          this.services.shell?.toast?.("Couldn't save that. Try again.");
        }
      },
    });
    return h("div", { class: "kf-find-it" }, [
      h("div", { class: "kf-row" }, [input, h("label", { htmlFor: id, text: `Find it in ${place.name}` })]),
      h("p", {
        class: "kf-note",
        text:
          `Now and then the scene asks "Where is the …?" and Klara taps it. ${recorded} of ${things.length} things here have your recorded questions` +
          (recorded < things.length ? "; the others are asked in the iPad's voice until you record them (thing card → Questions)." : "."),
      }),
    ]);
  }

  playSection(s) {
    const sleepId = newId("sleep");
    const gateId = newId("gate");
    return h("section", { class: "kf-settings-section", "aria-label": "Play" }, [
      h("h3", { text: "Play" }),
      h("div", { class: "kf-field" }, [
        h("label", { htmlFor: sleepId, text: "Sleep timer" }),
        h(
          "select",
          { id: sleepId, "data-key": "sleep", onchange: (e) => this.save({ sleepMinutes: Number(e.target.value) }) },
          SLEEP_OPTIONS.map(([v, label]) => h("option", { value: String(v), text: label, selected: s.sleepMinutes === v })),
        ),
      ]),
      h("p", { class: "kf-note", text: "After this long, the things yawn and fall asleep, so play ends gently." }),
      this.findItField(),
      h("div", { class: "kf-field" }, [
        h("label", { htmlFor: gateId, text: "Adult check" }),
        h(
          "select",
          { id: gateId, "data-key": "gate", onchange: (e) => this.save({ gateKind: e.target.value }) },
          GATE_OPTIONS.map(([v, label]) => h("option", { value: v, text: label, selected: s.gateKind === v })),
        ),
      ]),
      h("p", { class: "kf-note", text: "Shown after the 1.5 s hold, before edit mode opens." }),
    ]);
  }

  dataSection() {
    const status = [];
    if (this._persist === true) status.push(h("p", { text: "Your farm is kept safely on this iPad (persistent storage is on)." }));
    if (this._persist === false)
      status.push(h("p", { class: "kf-warning", text: "Safari may clear the farm's drawings and recordings if the iPad runs low on space. Export a copy now and then, and add the app to the Home Screen." }));
    if (this._estimate?.usage != null) status.push(h("p", { class: "kf-note", text: `Using ${formatBytes(this._estimate.usage)} on this iPad.` }));

    const fileInput = h("input", { type: "file", accept: ".zip,.klarasfarm,application/zip", hidden: true, "aria-label": "Import from a file" });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) this.importFile(file);
    });
    const ready = this._exportReady;
    return h("section", { class: "kf-settings-section", "aria-label": "Your data" }, [
      h("h3", { text: "Your data" }),
      ...status,
      h("div", { class: "kf-row" }, [
        h("button", { type: "button", class: "kf-btn primary", "data-key": "export", text: "Export everything", onclick: () => this.exportNow() }),
        h("span", { class: "kf-note", text: ready ? `${countsText(ready.counts)} in one file.` : "Preparing the file…" }),
      ]),
      h("p", { class: "kf-note", text: "Save the file to Files or send it to yourself. Importing it brings everything back, here or on another iPad." }),
      h("div", { class: "kf-row" }, [
        h("button", { type: "button", class: "kf-btn", "data-key": "import", text: "Import from a file", onclick: () => fileInput.click() }),
        importedThisBoot ? h("button", { type: "button", class: "kf-btn", "data-key": "undo-import", text: "Undo import", onclick: () => this.undoImport() }) : null,
        fileInput,
      ]),
      h("p", { class: "kf-settings-message", role: "status", "aria-live": "polite", text: this._message }),
    ]);
  }

  helpSection() {
    return h("section", { class: "kf-settings-section", "aria-label": "Help" }, [
      h("h3", { text: "Help" }),
      h("details", { class: "kf-settings-details" }, [
        h("summary", { text: "Privacy" }),
        h("p", { text: "Everything stays on this iPad. Drawings, names and recordings are never uploaded." }),
        h("p", { text: "The app never records during play. The microphone is on only while a parent is recording a clip, and Klara may be audible in the background of those clips." }),
        h("p", { text: "An export file contains your recordings: keep it somewhere private." }),
      ]),
      h("details", { class: "kf-settings-details" }, [
        h("summary", { text: "Lock the iPad to this app (Guided Access)" }),
        h("ol", {}, [
          h("li", { text: "Open the iPad's Settings app, then Accessibility, then Guided Access, and turn it on." }),
          h("li", { text: "Tap Passcode Settings and set a Guided Access passcode." }),
          h("li", { text: "Open Klara's Farm (from the Home Screen icon if you added it)." }),
          h("li", { text: "Triple-click the top button (or the Home button), then tap Start." }),
          h("li", { text: "To finish, triple-click again and enter your passcode." }),
        ]),
        h("p", { class: "kf-note", text: "Klara then can't leave the app, and the edit mode still needs the hold and the adult check." }),
      ]),
    ]);
  }

  dangerSection() {
    return h("section", { class: "kf-settings-section", "aria-label": "Delete" }, [
      h("h3", { text: "Start over" }),
      h("button", { type: "button", class: "kf-btn danger", "data-key": "delete-all", text: "Delete all data", onclick: () => this.deleteAll() }),
    ]);
  }

  // ---------------------------------------------------------------- actions

  async save(patch) {
    try {
      await this.store.updateSettings({ patch });
    } catch (e) {
      reportFailure(this.services, e);
      this.render();
    }
  }

  showMessage(text, err) {
    if (err) console.warn(err);
    this._message = text;
    const el = this.querySelector(".kf-settings-message");
    if (el) el.textContent = text;
  }

  async checkStorage() {
    const st = this.services.storage;
    try {
      this._persist = !!(await st?.requestPersist?.());
    } catch {
      this._persist = false;
    }
    try {
      this._estimate = (await st?.estimate?.()) ?? null;
    } catch {
      this._estimate = null;
    }
    if (this.isConnected) this.render();
  }

  /** Builds the export file ahead of the tap: the share sheet must open within the user's gesture. */
  prepareExport() {
    const share = this.services.share;
    if (!share?.buildExport) return null;
    const p = Promise.resolve().then(() => share.buildExport(this.store));
    this._export = p;
    this._exportReady = null;
    p.then(
      (built) => {
        if (this._export !== p) return;
        this._exportReady = built;
        if (this.isConnected) this.render();
      },
      (e) => console.warn("export failed", e),
    );
    return p;
  }

  scheduleExport() {
    clearTimeout(this._exportTimer);
    this._exportReady = null;
    this._export = null;
    this._exportTimer = setTimeout(() => this.prepareExport(), 300);
  }

  async exportNow() {
    const share = this.services.share;
    try {
      const built = this._exportReady ?? (await (this._export ?? this.prepareExport()));
      if (!built?.file) throw new Error("no export file");
      await share.shareFile(built.file);
      this.showMessage("");
    } catch (e) {
      if (e?.name === "AbortError") return; // the parent closed the share sheet
      if (e?.name === "NotAllowedError") return this.showMessage("The file is ready now. Tap Export everything again to share it.", e);
      this.showMessage("The export didn't work. Nothing was changed; try again.", e);
    }
  }

  async importFile(file) {
    const share = this.services.share;
    let buf;
    let incoming;
    try {
      buf = await file.arrayBuffer();
      incoming = await share.readImport(buf.slice(0));
    } catch (e) {
      return this.showMessage(IMPORT_ERRORS[e?.code] ?? IMPORT_ERRORS.corrupt, e);
    }
    const ok = await this.services.shell.confirm({
      title: "Replace everything?",
      body: [
        `This replaces everything on this iPad. ${countsText(countsOf(this.store.snapshot))} will be lost.`,
        `The file has ${countsText(countsOf(incoming?.snapshot))}.`,
      ],
      confirmLabel: "Replace everything",
      cancelLabel: "Keep what's here",
      danger: true,
    });
    if (!ok) return;
    try {
      const counts = (await share.importReplacing(this.store, buf)) ?? countsOf(incoming?.snapshot);
      importedThisBoot = true;
      this.showMessage(`Imported ${countsText(counts)}.`);
      this.render();
      this.services.shell.toast?.("Imported", { undo: () => this.undoImport() });
    } catch (e) {
      this.showMessage(IMPORT_ERRORS[e?.code] ?? "The import didn't work. Nothing was changed.", e);
    }
  }

  async undoImport() {
    try {
      await this.services.share.undoImport(this.store);
      importedThisBoot = false;
      this.showMessage("The import was undone.");
      this.render();
    } catch (e) {
      this.showMessage("The import couldn't be undone.", e);
    }
  }

  async deleteAll() {
    const ok = await this.services.shell.confirm({
      title: "Delete all data?",
      body: [
        `This deletes ${countsText(countsOf(this.store.snapshot))} from this iPad, and the app's offline copy.`,
        "Export first if you want to keep them. This can't be undone.",
      ],
      confirmLabel: "Delete everything",
      cancelLabel: "Keep my farm",
      danger: true,
    });
    if (!ok) return;
    try {
      await this.services.storage.deleteAllData();
    } catch (e) {
      return this.showMessage("Not everything could be deleted. Close the app and try again.", e);
    }
    this.reload();
  }
}

function formatBytes(n) {
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}
