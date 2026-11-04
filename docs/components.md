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
- `web/css/tokens.css` (design tokens, `--tap: 44px`, `--stitch` for stitched edges), `web/css/parent.css` (sheets, buttons, fields, tabs), `web/css/main.css` (base, stage, and `@import` of every component stylesheet).

Elements (one folder per tag):

- `kf-board`: the child's 4:3 letterboxed felt canvas, the `Renderer`, pointer handling.
- `kf-find-buttons`: the child's two 96 px icon buttons. A tap starts a find game (animal, colour) on the finger's lift; a hold of `FIND_HOLD_MS` (1 s, flag `findHoldMs`) shows the hold ring and, after the adult check, opens that game's setup panel. The tap/hold machine is pure (`press.js`: `idle → down → held`); the hold itself runs through `session.holdStart(e, el, {then: {name: 'find-setup', params: {game}}, holdMs, edges: false})`.
- `kf-find-setup`: the grown-ups' find game setup, panel `find-setup` with `params.game`.
  - "Find game" (`animal`): per thing in the scene, its questions (the shared questions section below) with a recording per line.
  - "Colour game" (`color`): the colour question per language (takes 1 to 6, "+ Another way to ask"), then tap a thing (its colour) or a swatch of the scene's colours to record that colour word. Swatches show ✓ when recorded and an orange ring when missing; a status line and the language tabs ("English · 2 to record") say what is still missing.
  - Pure state in `setup.js` (`initialSetup`, `nextSetup`: `lang`, `pick`, `record`, `cancel`, `saved`, `add-ask`; `askSlots`, `colorMissing`, `missingText`). The element renders from that state and the store after every event; clips are saved through `store.saveClip` with `thingId: null`.
- `kf-hold-ring`: felt ring that fills during hold-to-edit; created by `session.js`, attribute driven.
- `kf-adult-check`: the parental gate (keypad code or sum, keys at least 64 px).
- `kf-edit-layer`: edit bar (Scenes, Change scene, + Add, Settings, Done) and per-thing badges.
- `kf-guided-add`: add a thing in eight steps (the step bar reads Body for the first step, whose id is still `draw`): Body, Felt (felt colour and Size: Small, Medium, Big), Eyes, Legs, Moves (Walks, Hops, Scuttles, Floats, with a live CSS preview), Name, Ask (the same 1 to 6 editable questions as the thing card, each with Record / Re-record; "Skip for now" until one is recorded, then "Next"), Sound.
- `kf-thing-card`: one card per thing: languages, names, clips, questions (1 to 6 editable lines, "Examples, change them freely", each with its recording), colour, motion (the same four), Size, Redraw, Re-stamp eyes, Place legs, Delete.
- Size has no field in the Thing; it is baked into the outline. `kf-guided-add/steps.js` owns it: `THING_SIZES` (Small 0.7, Medium 1, Big 1.3 of `THING_SIZE`), `sizeScale(outline)` reads it back, `nearestSize` picks the pressed button, `resizeThing(thing, scale)` scales outline, eyes and legs about the bottom centre (the feet stay put) and keeps them on the board, `sizeBox(scale)` is the box `fitOutline` fills, and `sizedFill` makes the Felt-step and card previews show the size. A redraw (more shapes in Draw, or Redraw on the card) keeps the current size.
- `kf-recorder`: one recording slot; keeps every passing take and offers Play and Re-record.
- `kf-draw-pad`: overlay that captures one stroke at a time (`outline`, `shape`, `yarn`); a touch too short to be a stroke is reported as `kf-tap`.
- `kf-scenes`: the scenes shelf with felt thumbnails, switch, rename, delete, new scene.
- `kf-scene-tools`: draw and arrange the scene: Shape, Line, Move (with resize handle, To back, Let go), Colour, Sky, Ground, Delete, Start (template: Blank, Meadow, Sea, Room), Undo, Done. UI state is the pure machine `edit/scene-tools.js`.
- `kf-settings`: languages, sleep timer, things per scene (1 to 12, `maxThings`), gate kind, music, export and import, storage, delete all data, update, version.
- `kf-welcome`: one-time first-run card for the parent.
- `kf-dialog`: shared confirm dialog and toast with Undo; removes itself.

Helper modules inside element folders:

- `kf-dialog/dom.js`: `h()` DOM builder, `newId`, `plural`, `joinAnd`, `swatches`, `reportFailure`, `languageName`.
- `kf-dialog/press-guard.js`: `pressGuard(el, render)`. `request()` renders now, or, while a press is in progress inside `el`, once that press's click has run (fallback `RELEASE_MS` 400 ms after pointerup, or at pointercancel); a press whose target has left the DOM (a hold that closed an overlay) holds nothing. The thing card and the find setup route store-driven renders through it, because a text field commits on blur inside the tap and a rebuild before `click` would swallow the tap. Both also keep their sheet's scroll position across renders.
- `kf-dialog/feedback.js`: `editSound(services, kind)`, the one helper every edit action plays its sound through (unlocks audio, then `audio.chime(kind)`; never throws). Kinds are `dsp/chimes.js` `EDIT_CHIMES` plus `poof` for a delete.
- `kf-guided-add/`: `dom.js` (`h`, `ensureElement`), `drawing.js` (`ShapeDrawing`, pure: up to 6 shapes merged with `geometry/union.js`, each editable, with an undo history), `shape-edit.js` (pure shape editing state machine), `shape-editor.js` (`ShapeEditor`, the shape editing UI over the pad), `guide.js` (the "Draw the body only" guidance with its picture), `eyes.js` (`EyeStamper`, `attachEyeDrag`), `legs.js` (`LegPlacer`, a view over `edit/leg-flow.js`), `preview.js` (`ThingPreview`; `legMarkRadius(thing, count)` shrinks the numbered leg rings above 4 legs to fit the spread spacing, while taps still use `legRadius`), `steps.js` (pure step helpers; `cleanCues` keeps every question line, dropping only three empty ones), `draft-questions.js` (pure: `setDraftLine`, `addDraftQuestion`, `removeDraftQuestion`, `draftClips`, the store's question rules applied to a draft's cues and clips), `geometry.js` and `shape.js` (geometry loader and fallback).
- `kf-scene-tools/pieces.js` (pure hit testing, moving, resizing (`resizeScale`, `scaleStroke`, `strokeBox`) and reordering (`sendToBack`) of pieces), `kf-scenes/thumbnail.js`, `kf-thing-card/languages.js`.
- `kf-thing-card/clip-slot.js`: `clipSlot()`, one recording slot (`.kf-tc-clip[data-kind][data-take][data-color]`, Play, Record, Cancel), shared by the thing card and the find setup.
- `kf-thing-card/questions.js`: `questionsSection()`, a thing's questions in one language: article, one input per line (the value is the parent's text, the placeholder the example), remove (at least 1) and "+ Add a question" (up to 6), each line with its prompt recording. It calls `setQuestionLine`, `addQuestion` and `removeQuestion` (passing the examples) on the store; a removal offers Undo through `shell.toast` (`restoreQuestions`). With `busy` (a recorder is open) the remove buttons are off, because a removal renumbers the recordings.
- `kf-find-buttons/press.js`, `kf-find-setup/setup.js`: pure state machines (above).

## Public API / contracts

### Component conventions

- One folder per tag: `<Name>Element.js` (the class), `define.js` (registers it, guarded by `customElements.get`), `<tag>.css` (imported by `css/main.css`).
- Light DOM, no shadow roots. Build DOM with `h()`. User text goes in as text nodes only, never `innerHTML` with data.
- Services are injected as a property before connecting: `el.services = services`, and panels also get `el.params`. Elements must not import `main.js` or reach for globals.
- Components read state from `services.store`, `services.session` and `services.engine`, and change it only through store intents and session methods.
- A panel dispatches `kf-close` (bubbling) when done. The Shell then calls `session.closePanel()`.
- Other events: `kf-thing-tap {thingId}` (board, edit mode), `kf-thing-grab {thingId}` and `kf-thing-drop {thingId}` (board, edit mode drag), `kf-stroke {points, closed}` and `kf-stroke-open {points, gap}` and `kf-tap {point}` (draw pad), `kf-recorded {clip, blob}` (recorder), `kf-added {thingId}` (guided add).
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

- `connect(services)`, `boardRect()`, `toBoard(clientX, clientY)`, `toClient(x, y)`, `actorRect(thingId)`, `setLift(lift)` (scene tools: forwards to `Renderer.setLift`), `renderer`.
- `pointerdown`: primary pointer only, palms ignored. Each step is guarded so one failure never eats the tap: `audio.unlock()`, `engine.fingerDown`, `session.holdStart`, then in play `engine.tap(x, y)` and `session.playTap()`; in edit mode (no panel) a press on a thing calls `engine.grab(id)`.
- Edit mode drag (US-11.3): the board rect is read once at pointerdown; each `pointermove` calls `engine.dragTo(x0 + dx/width, y0 + dy/height)` with the newest position (exact, no smoothing), and the renderer draws it in its next frame. Past the 10 px tap slop it plays `pick` and fires `kf-thing-grab`. On `pointerup` the last position is applied, then `engine.release()`, `drop` sound, `kf-thing-drop`, and one `store.updateThing` with `geometry/transform.js` `movedThingPatch` (outline, eyes and legs). A press that never left the slop goes back and counts as a tap; `pointercancel` puts the thing back.

### kf-edit-layer

- Selection: the thing last tapped or dragged is `selected` and gets a dashed felt ring (`.kf-edit-ring`, decorative). Tapping empty board never clears it.
- Badges hide while a thing is dragged (`.dragging`) and are placed again on `kf-thing-drop` from the actor's live position.
- Bar buttons and the pencil play `select`; Done plays nothing extra (the session plays `leave`).

### kf-scene-tools

- State: `edit/scene-tools.js` (`tool`, `selected`, `sheet`, `drag`, `colors`, `lifted`, `undo`, `undoing`, `seq`). `send(event)` runs the reducer and `render()` rebuilds the rail, panel, sheet and selection outline from the state and the store. The store's `change` re-renders and sends `pieces {ids}`.
- Foreground: the side panel, the sheet and Done have `z-index: 20`; the stage over the board is `z-index: 1`, so `kf-draw-pad`'s fixed overlay (z 5) stays inside it. While a sheet is open the stage is `inert` and the pad gets `pointer-events: none` and is cleared: a tap meant for a colour never draws.
- Sheets: `draw` (felt colour for the next shape or line; closes on pick), `piece`, `sky`, `ground` (apply at once, stay open to try colours), `start` (templates; asks first when pieces would be cleared). Close with "Close".
- Move: a press on a piece selects it and starts a `move` drag; the round handle on the selected piece starts a `resize` drag. Moves call `board.setLift({id, dx, dy})` or `{id, s, cx, cy}` and move the outline with a transform once per frame. Nothing is written until release; then `drop` and one `updatePiece` (`moveStroke` or `scaleStroke`). The lift stays while `state.lifted` is set, until the store's change arrives, so the piece never jumps back. Pointer handlers run guarded (`_guard`), and `setPointerCapture` and the board rect each on their own, so one failure never eats the tap; `boardRect()` falls back to a 4:3 letterbox.
- Taps: Colour and Delete select on tap; Delete then confirms. Tapping empty board keeps the selection; "Let go" or another piece changes it.
- Sounds: `tool` (tool, sheet), `select`, `pick`, `drop` (drop, To back), `colour`, `add`, `poof`, `undo`, `back` (close sheet, Let go), `save` (Done, template).
- Edits show at once: `edit(change)` calls the store intent synchronously in the tap (FarmStore emits `change` before returning and queues the write), sends `edited` and renders in the same task, and only watches the promise to send `edit-failed` and show the failure (the store has already rolled back). Undo sends `undo` and calls `store.updatePlace` with the entry's `before` at once; its promise sends `undo-saved` or `undo-failed`. Nothing waits on IndexedDB.
- Device pixel ratio is capped at 2. Hit targets are at least 120 CSS px across (`engine.hitMinRadius`).

### Eye stamping (`kf-guided-add/eyes.js`, `EyeStamper`)

- Full screen (`.kf-eyes`, z-index 30). Every tap on the stage stamps an eye snapped inside the outline; a third tap moves the oldest.
- The grown-up's bar is always at the top: the line "Grown-up: hold Done for 1 second when the eyes are on" and two 56 px buttons, Cancel and Done (`data-action` `eyes-cancel`, `eyes-done`). Each acts after a 1 s hold (`holdMs`) with a fill; a keyboard or VoiceOver click acts at once. Letting go early shows "Keep holding for 1 second" for 2.5 s. Nobody can get stuck on this screen.
- The bar renders from its own small state `{holding, hint}` through `_setBar`. The hold buttons `preventDefault` on `pointerdown` and capture the pointer, so iOS callouts and finger wobble do not cancel the hold.
- `onDone(eyes)` gets the stamped eyes, `onCancel(before)` the eyes from before stamping. Guided add saves either and returns to the Eyes panel; the thing card saves on Done only.

### Leg placing (`kf-guided-add/legs.js`, `LegPlacer`)

- The flow is the pure state machine `edit/leg-flow.js` (see `docs/edit.md`): choose-count → placing (leg k of n) → done. `LegPlacer` turns canvas pointer events into its events (`pressLeg`, `moveLeg` after 6 px of travel, `releaseLeg`, `cancelPress`) and, after every event, renders the whole panel from `legView(state)` and redraws the preview. Pointer steps are guarded so one failure never eats the tap.
- Panel (`data-testid="leg-placing"`, `data-phase`): heading ("How many legs?", "Tap where leg 3 of 4 goes", "4 legs"), a note, the count buttons 0 to 8 (always shown, `aria-pressed` on the chosen one), then Spread evenly, Undo and Clear once a count is chosen, then the caller's buttons.
- A stray tap never undoes progress: a tap on a placed leg grabs it (a drag moves it, a still tap places the next leg there while legs are missing); a tap off the shape is snapped inside it; taps once all legs are placed only grab.
- `onChange({target, legs})` fires once per finished change (not per drag move). Guided add saves the draft (`thing.legs`, `thing.legTarget`); its button is Skip until a count is chosen, "Spread the rest and continue" while legs are missing (`LegPlacer.spreadRest()`, then the next step), and Next once all are placed. The markers are drawn for `max(target, placed)` legs, so they shrink as soon as more than 4 are chosen. The thing card saves on Done and keeps the old legs on Cancel.

### kf-guided-add

- The draft (`{id, placeId, step, at, thing, clips}`) is the state; every step renders from it and every change is saved after it shows (`_save`, one save after another).
- Ask: `questionsSection()` from `kf-thing-card/questions.js` with a store-shaped adapter over the draft (`clipsFor`, `setQuestionLine`, `addQuestion`, `removeQuestion`, using `draft-questions.js`). Add and remove rebuild the panel; new words do not, because the field already shows them and a rebuild as the field lets go would swallow the tap that moved the focus (Record, the next field). A question recorder is one `clipSlot`; `_recording {language, take}` says which is open, remove is disabled while it is (`busy`), and a take closes it at once, then the blob and the draft are saved in the save queue.
- Finish: `store.addThing` applies at once, so the sheet closes, the thing drops in and `plink` plays right after the tap (AGENTS.md rule 5). The draft is removed only after the commit; if the commit fails the store rolls back, the draft stays and the parent gets a toast ("The new thing didn't save. It's kept as a draft: tap + to finish it."). A scene that is full refuses on the spot and the sheet shows "This scene is full" instead of closing.

### kf-thing-card

- Every store change shows at once (the store emits synchronously, see `docs/farm.md`). `_storeChanged` renders the whole sheet, except while a text field has focus or a recorder is open: then the title and the look column (felt, moves, preview) render now and the words column follows on `focusout` or when the recorder closes. On iPad a button tap does not take the focus from a text field, so this matters.
- Overlays (Redraw, Re-stamp eyes, Place legs) are appended after the sheet; `_render` replaces only the sheet, so an overlay survives any re-render, and closing an overlay always re-renders the card. Done buttons call the intent and close at once; they never wait for the disk.

### kf-settings

- Re-renders on every store change. The sheet's scroll position and which Help sections are open are view state kept in the element (`_scrollTop`, `_openHelp`) and restored on each render, so a change never jumps the sheet back to the top.
### Drawing a body (guided add Draw step, thing card Redraw)

- Both screens show `bodyGuide()` (guide.js): "Draw the body only. Eyes and legs come next." with a small SVG of a body without legs (`data-testid="body-guide"`). The Redraw copy says the eyes and legs come back by themselves.
- The drawing is a `ShapeDrawing` (drawing.js). Redraw starts from the thing's outline as shape 1, scaled to `DRAWING_SIZE`, and it is editable like any shape. The stored Thing keeps ONE outline (the merged drawing fitted to `THING_SIZE`); the separate shapes live only while the screen is open (guided add keeps them across Back and Next), never in the draft or the snapshot.
- `ShapeDrawing`: `add(points)`, `addOpen(points, {replace})` (an open stroke whose ends lie in other shapes, closed through them by `geometry/join.js`), `replace(i, points)`, `remove(i)`, `transform(i, {dx, dy, k})` (scale about the shape's box centre, clamped so its longer side stays 0.04 to 1.2), `clear()`, `undo()` (takes back the last change of any kind, Start over included; up to 50), `hit(pt, tol)` (smallest shape under the point), `merged` and `mergedWithout(i)` (both cached until the next change), `canUndo`, `count`, `full`.
- `ShapeEditor` (shape-editor.js) is shared by both screens. Its mode is the pure reducer `editReducer` in shape-edit.js:
  - `idle`: strokes draw new shapes; `kf-tap` on a shape selects it.
  - `selected`: the shape has an orange stitch, a dashed box and a 56 px round resize handle (on the bottom-right corner, or the next corner a panel does not cover). The row "Draw it again" / "Delete shape" shows. Drag inside the box (grown by 28 px) to move; drag the handle or pinch to resize; a press on another shape picks that one; a press on nothing deselects.
  - `dragging`: `gesture = {kind: move|resize|pinch|hold, t, lifted}`. On release the transform is committed with `ShapeDrawing.transform`.
  - `redrawing`: "Draw it again" pressed; the next stroke (closed, or open and joined) takes the shape's place. Pressing again keeps the shape.
  - `warn`: an open stroke that could not be joined shows "Close the outline: end where you started, or end inside the body." until the next accepted change.
  - Every event dispatches and `render()` draws buttons, handle and outlines from the state; hosts render their notes from `noteText()` in the `onRender` callback.
- Its layer sits inside the `kf-draw-pad`. With a shape selected the layer takes the touches (a gesture is followed on `window`, so it continues over the panel); otherwise touches go to the pad.
- No lag: `unionOutlines` runs only on commit (stroke end, drag end). During a drag the host paints `mergedWithout(i)` once and the overlay canvas repaints the moving shape (a flat fill) once per animation frame.

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
- iOS audio: call `audio.unlock()` synchronously inside the gesture (`kf-find-buttons` unlocks on `pointerdown`). Speech must start from an activation event: `pointerdown` of a touch is not one, so `kf-find-buttons` starts the game on `pointerup`, and `main.js` primes speech on the first `pointerup`. Starting the question on `pointerdown` was why the iPad stayed silent and played only the animal sound.
- Never `await` before closing UI after a gesture. `kf-welcome` dispatches `kf-close` without waiting for `requestPersist()`, which can hang on iPad.
- Settings builds the export when it opens, so the share sheet opens inside the tap.
- CSP is `script-src 'self'`: no inline scripts and no inline event handler attributes. Inline styles are allowed.
- No build step. Every file is served as is under a hashed path. Use relative imports, and add new stylesheets to `css/main.css` so they are precached.
- Offline: everything must work from the service worker cache. Do not fetch from other origins.
- Things fade in scene mode; badges in the edit layer are placed on store changes, resize and drops, never per frame.
- Editing controls always sit above the canvas. Never write the store on `pointermove`: drags move a cached sprite and persist on release.
- `#parent-layer` has `pointer-events: none`; its children turn them back on.
- Respect `prefers-reduced-motion`; base CSS shortens animations.

## Tests

- Unit (Node, `npm test`): pure helpers next to their element: `kf-dialog/press-guard.test.js`, `kf-guided-add/drawing.test.js`, `draft-questions.test.js`, `shape-edit.test.js`, `shape.test.js`, `steps.test.js`, `kf-scene-tools/pieces.test.js`, `kf-find-buttons/press.test.js`, `kf-find-setup/setup.test.js`.
- Browser (`npm run test:browser`, Playwright Chromium against the real Python app):
  - `app.test.js`: the whole app booted and driven like a parent and a child.
  - `package-a.test.js`: `kf-board` and `kf-draw-pad`.
  - `package-c.test.js`: hold ring, adult check, edit layer, Session timers with a fake clock.
  - `package-d.test.js`: `kf-recorder` with a fake mic.
  - `package-f1.test.js`: `kf-guided-add` and `kf-thing-card` with stubs (`tests/browser/stubs/f1-stubs.js`).
  - `guided-add-steps.test.js`: `kf-guided-add` steps alone at 1180 × 820 with the F1 stubs: Spread the rest and continue, Skip and 0 legs, small markers with 8 legs and a drag, the Ask step's add, edit, remove, record and language switch, typing then tapping Record in one tap, Finish closing before the save, a failed save (toast, draft kept) and a full scene.
  - `animal-panels.test.js`: Size and the four walking styles in `kf-thing-card` and `kf-guided-add`, each mounted alone (set `KF_SHOTS=<dir>` to save iPad-sized screenshots).
  - `package-f2.test.js`: scenes, scene tools, settings, welcome, dialogs (`tests/browser/stubs/f2-stubs.js`).
  - `package-f2.test.js`: scenes, settings, welcome, dialogs (`tests/browser/stubs/f2-stubs.js`; its board stub records `setLift` calls in `board.lifts`).
  - `scene-tools.test.js`: `kf-scene-tools` alone at 1180 × 820: tool bar, the picker on top of the real draw pad with the canvas paused, drawing and moving a piece with exact lifts and one write, tap-away keeps the selection, resize, To back, sky, ground, templates, undo, delete; with a slow disk, quick edits, colour and Undo show in the same task, a failed write takes its edit and Undo step back, a drop ends its lift at once; a failing pointer capture or board rect never eats a drag or tap.
  - `drag.test.js`: the real app at iPad size and dpr 2: a thing dragged in edit mode and a piece dragged in the scene tools track the pointer with zero error before release, render each frame in well under 8 ms (median), write once, and keep their cached sprites.
  - `shapes.test.js`: multi-shape drawing in guided add and Redraw. `legs.test.js`: leg placing and format migration.
  - `playtest2.test.js`: the playtest 2 bugs, each element mounted alone: changing the leg count while placing, eight close legs, drag, Undo, Clear, Spread evenly, stray taps; the eye screen's way out and hint; thing card and settings edits visible in the same task with a slow disk; an overlay surviving a focus change.
  - `shapes.test.js`: multi-shape drawing in guided add and Redraw; the body guidance and step bar; selecting, moving, resizing, deleting and redrawing a shape, Undo and Start over; an open stroke inside the body joins it; Redraw opens with the body as an editable shape. `legs.test.js`: leg placing and format migration.
  - `find-games.test.js` (emulated iPad, 1180x820, touch; screenshots in `tests/browser/.shots/`): the buttons alone (tap starts, hold opens setup), each setup panel alone, and two journeys (the question is spoken before the sound; long-press, adult check, record the colour question and word with the fake mic, then a colour round plays both).
- Harness: `tests/browser/harness.js` gives `setup({fakeMedia})`, `newPage()` (boots the app and waits for `data-ready`) and `modulePage(html)` (base and CSS only). Elements written into `modulePage` HTML do not upgrade; import `define.js` and create them with `document.createElement`, then set `services` before appending.
- `tests/unit/docs.test.js` checks that each domain has its doc and that `CLAUDE.md` links to `AGENTS.md`.
- Device-only checks go in `tests/manual-ipad.md`.
