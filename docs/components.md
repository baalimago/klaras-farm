# components: custom elements, shell and boot

Keep this file current: update it in the same commit as any change to this domain.

## Purpose

This domain is everything on screen and the code that starts the app: the custom elements in `web/js/components/`, the `Shell` that mounts parent panels, the composition root `main.js`, `index.html`, the CSS, the service worker template and the flags. The child sees only the felt board and two icon buttons. Everything with text is for the parent and lives in `#parent-layer`.

## Files

Boot and shell:

- `web/index.html`: one document. `#stage` holds `<kf-board id="board">`; `#parent-layer` holds parent UI. Loads `js/report-boot.js` then `js/main.js` as modules. `<base href="%ASSET_BASE%">` is filled by the server.
- `web/js/main.js`: composition root. Opens the repository, hydrates or loads starter content, builds services, connects the board, mounts `kf-find-buttons` and the `Shell`, wires wake lock, music and updates, sets `data-ready`.
- `web/js/shell.js`: `Shell`, mounts panels into `#parent-layer` from `session.state`; shared `confirm()` and `toast()`.
- `web/js/flags.js`: `DEFAULT_FLAGS` and `readFlags(search)` for `?flag=name:value`. Read only in `main.js`.
- `web/js/report-boot.js`: installs `io/report.js` error reporting before anything else loads.
- `web/sw.template.js`: service worker; the server fills `__VERSION__` and `__PRECACHE__`.
- `web/css/tokens.css` (design tokens, `--tap: 44px`), `web/css/parent.css` (sheets, buttons, fields, tabs), `web/css/main.css` (base, stage, and `@import` of every component stylesheet).

Elements (one folder per tag):

- `kf-board`: the child's 4:3 letterboxed felt canvas, the `Renderer`, pointer handling.
- `kf-find-buttons`: the child's two 96 px icon buttons that start the find games (animal, colour).
- `kf-hold-ring`: felt ring that fills during hold-to-edit; created by `session.js`, attribute driven.
- `kf-adult-check`: the parental gate (keypad code or sum, keys at least 64 px).
- `kf-edit-layer`: edit bar (Scenes, Change scene, + Add, Settings, Done) and per-thing badges.
- `kf-guided-add`: add a thing in eight steps: Draw, Felt, Eyes, Legs, Moves, Name, Ask, Sound.
- `kf-thing-card`: one card per thing: languages, names, clips, cues, colour, motion, Redraw, Re-stamp eyes, Place legs, Delete.
- `kf-recorder`: one recording slot; keeps every passing take and offers Play and Re-record.
- `kf-draw-pad`: overlay that captures one stroke at a time (`outline`, `shape`, `yarn`).
- `kf-scenes`: the scenes shelf with felt thumbnails, switch, rename, delete, new scene.
- `kf-scene-tools`: change the scene: Shape, Yarn, Paint, Move, Delete, Undo.
- `kf-settings`: languages, sleep timer, gate kind, music, export and import, storage, delete all data, update, version.
- `kf-welcome`: one-time first-run card for the parent.
- `kf-dialog`: shared confirm dialog and toast with Undo; removes itself.

Helper modules inside element folders:

- `kf-dialog/dom.js`: `h()` DOM builder, `newId`, `plural`, `joinAnd`, `swatches`, `reportFailure`, `languageName`.
- `kf-guided-add/`: `dom.js` (`h`, `ensureElement`), `drawing.js` (`ShapeDrawing`, up to 6 shapes merged with `geometry/union.js`), `eyes.js` (`EyeStamper`), `legs.js` (`LegPlacer`), `legplace.js` (pure leg rules), `preview.js` (`ThingPreview`), `steps.js` (pure step helpers), `geometry.js` and `shape.js` (geometry loader and fallback).
- `kf-scene-tools/pieces.js` (pure hit testing and moving of pieces), `kf-scenes/thumbnail.js`, `kf-thing-card/languages.js`.

## Public API / contracts

### Component conventions

- One folder per tag: `<Name>Element.js` (the class), `define.js` (registers it, guarded by `customElements.get`), `<tag>.css` (imported by `css/main.css`).
- Light DOM, no shadow roots. Build DOM with `h()`. User text goes in as text nodes only, never `innerHTML` with data.
- Services are injected as a property before connecting: `el.services = services`, and panels also get `el.params`. Elements must not import `main.js` or reach for globals.
- Components read state from `services.store`, `services.session` and `services.engine`, and change it only through store intents and session methods.
- A panel dispatches `kf-close` (bubbling) when done. The Shell then calls `session.closePanel()`.
- Other events: `kf-thing-tap {thingId}` (board, edit mode), `kf-stroke {points, closed}` and `kf-stroke-open {points, gap}` (draw pad), `kf-recorded {clip, blob}` (recorder), `kf-added {thingId}` (guided add).
- Lazy children: guided add and thing card load `kf-draw-pad` and `kf-recorder` with `ensureElement(tag, () => import(define.js))`.

### Shell

- `session.state = {mode: 'play'|'gate'|'edit'|'scene', panel: null | {name, params}}`.
- Slots: `mode` (gate shows `kf-adult-check`; edit shows `kf-edit-layer`; scene shows `kf-scene-tools`), `panel` (`card`, `guided`, `scenes`, `settings`), and `welcome`.
- On every session `change`, `render()` removes elements no longer wanted and imports `components/<tag>/define.js` on first use. A render token drops results of an older render that finished late.
- `confirm(opts)` resolves true or false; `toast(message, {undo})` resolves true when undone. Both use a fresh `kf-dialog`.
- `welcome()` mounts the first-run card. `updateReady()` sets `services.updateReady` and fires `update-ready` on the session.

### Boot (`main.js`)

- `services = {store, session, engine, audio, music, recorder, scripts, presets, share, storage, flags, env, appVersion, warnings, board, shell}`. Exposed as `window.__kf` for debugging and browser tests.
- `env = {now, rng, newId, deviceId}` is the only source of time, randomness and ids for the store.
- If IndexedDB fails, the app falls back to `MemoryRepo` and adds warning `no-storage`. A `VersionError` shows "Update needed".
- A fresh install loads starter content. Otherwise it drops the pre-import backup and sweeps orphan blobs older than 24 h.
- `document.documentElement.dataset.ready` becomes `"true"` (or `"error"`). Tests wait on it.

### kf-board

- `connect(services)`, `boardRect()`, `toBoard(clientX, clientY)`, `toClient(x, y)`, `actorRect(thingId)`, `renderer`.
- `pointerdown`: primary pointer only, palms ignored. Each step is guarded so one failure never eats the tap: `audio.unlock()`, `engine.fingerDown`, `session.holdStart`, then in play `engine.tap(x, y)` and `session.playTap()`.
- Device pixel ratio is capped at 2. Hit targets are at least 120 CSS px across (`engine.hitMinRadius`).

### kf-recorder

- Props: `services`, `label`, `clipRef {thingId|null, language, kind, take}`, `existing`.
- States in `data-state`: ready, starting, recording, processing, saved; errors `denied` and `error` with `data-error`.
- Every take that passes the checks is kept at once: it dispatches `kf-recorded` and shows "Saved", Play and Re-record. It never writes to the store. A failed or cancelled re-record keeps the old clip.

### Service worker (`sw.template.js`)

- Precaches every asset under the hashed `/v/<hash>/` prefix plus `/`. Cache-first. Navigations get this version's cached `/`, so assets never mix.
- Never calls `skipWaiting` on its own. A new version takes over on the next cold launch, or when the parent taps "Update ready" (`skip-waiting` message). Old `kf-*` caches are deleted on activate.

## How it fits

- `main.js` is the only module that builds `io/` objects and reads flags. `kf-board` imports `io/renderer.js`; `preview.js` and `thumbnail.js` load `io/felt.js` dynamically. Other elements use io only through `services`.
- Elements import pure helpers from `farm/`, `geometry/`, `edit/` and `play/`.
- State owners: `FarmStore` (`farm-store.js`), `Session` (`session.js`), `PlayEngine` (`play-engine.js`). See their docs.
- Only `io/`, `components/` and `main.js` may touch IndexedDB, audio and the DOM. `tests/unit/boundaries.test.js` enforces the device API part and keeps pure domains free of DOM and globals.
- The Python backend serves `index.html` with the asset base and a CSP, renders `sw.js`, and accepts `POST /api/client-log`. See `docs/backend.md`.

## Rules and gotchas

- The child view has no text and no failure states. Child buttons are icon only and at least 88 px (`kf-find-buttons` uses 96 px). Parent targets are at least 44 px (`--tap`).
- iOS audio: call `audio.unlock()` synchronously inside the gesture. Start speech inside the tap. `kf-find-buttons` acts on `pointerdown` for this reason.
- Never `await` before closing UI after a gesture. `kf-welcome` dispatches `kf-close` without waiting for `requestPersist()`, which can hang on iPad.
- Settings builds the export when it opens, so the share sheet opens inside the tap.
- CSP is `script-src 'self'`: no inline scripts and no inline event handler attributes. Inline styles are allowed.
- No build step. Every file is served as is under a hashed path. Use relative imports, and add new stylesheets to `css/main.css` so they are precached.
- Offline: everything must work from the service worker cache. Do not fetch from other origins.
- Things fade in scene mode; badges in the edit layer are placed on store changes and resize, never per frame.
- `#parent-layer` has `pointer-events: none`; its children turn them back on.
- Respect `prefers-reduced-motion`; base CSS shortens animations.

## Tests

- Unit (Node, `npm test`): pure helpers next to their element: `kf-guided-add/drawing.test.js`, `legplace.test.js`, `shape.test.js`, `steps.test.js`, `kf-scene-tools/pieces.test.js`.
- Browser (`npm run test:browser`, Playwright Chromium against the real Python app):
  - `app.test.js`: the whole app booted and driven like a parent and a child.
  - `package-a.test.js`: `kf-board` and `kf-draw-pad`.
  - `package-c.test.js`: hold ring, adult check, edit layer, Session timers with a fake clock.
  - `package-d.test.js`: `kf-recorder` with a fake mic.
  - `package-f1.test.js`: `kf-guided-add` and `kf-thing-card` with stubs (`tests/browser/stubs/f1-stubs.js`).
  - `package-f2.test.js`: scenes, scene tools, settings, welcome, dialogs (`tests/browser/stubs/f2-stubs.js`).
  - `shapes.test.js`: multi-shape drawing in guided add and Redraw. `legs.test.js`: leg placing and format migration.
- Harness: `tests/browser/harness.js` gives `setup({fakeMedia})`, `newPage()` (boots the app and waits for `data-ready`) and `modulePage(html)` (base and CSS only). Elements written into `modulePage` HTML do not upgrade; import `define.js` and create them with `document.createElement`, then set `services` before appending.
- `tests/unit/docs.test.js` checks that each domain has its doc and that `CLAUDE.md` links to `AGENTS.md`.
- Device-only checks go in `tests/manual-ipad.md`.
