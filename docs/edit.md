# Edit

## Purpose

Edit is how a grown-up gets from the toddler's play board into edit mode and back. A long hold opens an adult check. Passing it opens edit mode, where panels (thing card, guided add, scenes, settings) sit over the board. Edit mode always ends, either with Done or by itself after a minute without activity. `Session` owns this state and is the only writer.

## Files

- `web/js/edit/hold.js`: pure reducer for the hold-to-edit gesture, plus `isPalm`, the palm rule the board also uses.
- `web/js/edit/adult-check.js`: pure parental gate (keypad code or a sum).
- `web/js/edit/session.js`: pure session state machine (`nextSession`).
- `web/js/edit/leg-flow.js`: pure state machine for adding and changing a thing's legs (used by `kf-guided-add/legs.js`).
- `web/js/edit/scene-tools.js`: pure state machine of the scene tools UI (`nextSceneTools`), templates.
- `web/js/edit/selection.js`: pure state machine of the edit-mode selection and resize of things (`nextSelection`), and the resize gesture's scale for the board.
- `web/js/session.js`: `Session`, the state owner. Wraps the reducers with a clock, timers, window listeners, the hold ring and chimes.
- Tests: `web/js/edit/*.test.js`, `web/js/session.test.js`.

## Public API and state machines

### Session state (`edit/session.js`)

```
state = {mode: 'play'|'gate'|'edit'|'scene', panel: null | {name, params}, then: null | {name, params}, back: null | 'play', lastActivityAt, graceUntil}

play ──hold-armed──▶ gate ──gate-pass──▶ edit ⇄ scene ──done──▶ play
  │                   └──gate-fail──▶ play        (scene-tools / scene-done)
  └──hold-armed within grace──▶ edit (no check)
edit|scene ──tick, 60 s no activity, no panel──▶ play, grace for 5 min
```

- `AUTO_CLOSE_MS = 60000`, `GRACE_MS = 300000`.
- `initialSession(nowMs)`, `nextSession(state, event, nowMs)`. Returns the same object when nothing changed.
- Events: `hold-armed {then?}` (a panel to open once in: the find buttons pass `find-setup`), `gate-pass` (opens `then` as the panel and sets `back: 'play'`), `gate-fail`, `done` (to play, clears grace), `activity`, `open-panel {name, params}` (clears `back`), `close-panel` (with `back: 'play'`, a panel a hold opened from play, such as the find setup, returns to play with the grace window open; otherwise back to edit), `scene-tools` (edit to scene), `scene-done` (scene to edit), `tick`, `play-tap` (cancels grace).
- Panels open only in edit or scene. An open panel pauses auto-close.
- During grace the hold alone reopens edit (with `then` as its panel). A play tap cancels grace. `gate-fail` drops `then`.
- Panel names in use: `card`, `guided`, `scenes`, `settings`. `shell.js` maps them to components.

### Scene tools (`edit/scene-tools.js`)

`<kf-scene-tools>` keeps one of these states and renders from it after every event.

- State `{tool, selected, sheet, drag, colors, lifted, undo, undoing, seq}`. `tool`: `TOOLS` = shape, line, move, colour, sky, ground, delete. `selected`: a piece id or null. `sheet`: null, `draw`, `piece`, `sky`, `ground` or `start`. `drag`: null or `{mode: 'move'|'resize', id}`. `colors`: `{shape, line}` for the next drawn piece. `lifted`: the id of a dropped piece the board still shows lifted until the store's change arrives. `undo`: up to `UNDO_LIMIT` (50) entries `{seq, placeId, before, merge?}`, newest last, where `before` is the place's `{pieces, skyColor, groundColor, backdrop}` before the edit, and `merge` (`sky` or `ground`) marks an open run of colour-picker edits. `undoing`: entries taken back whose Undo write has not committed. `seq`: the last entry's number.
- `initialSceneTools()`, `nextSceneTools(state, event)` (the same object when nothing changes), `isPaused(state)` (a sheet is open: the board takes no input), `isDrawTool(tool)`, `undoTop(state)`, `canUndo(state)`, `placeBefore(place)` (the `before` of an entry), `templatePatch(backdrop)` and `TEMPLATES` (blank, meadow, sea, room with their sky and ground colours).
- Events: `tool {tool}` (Sky/Ground open their sheet; Colour with a selection opens the piece sheet; the selection stays), `open-sheet {sheet}`, `close-sheet`, `tap-piece {id}` (Move, Colour, Delete), `tap-empty` (changes nothing: tap-away keeps the selection), `deselect`, `drag-start {mode, id}` (Move only, no sheet; resize only on the selected piece), `drag-end`, `drag-cancel`, `draw-colour {key}`, `drop` (a drag that moved ends; its piece stays `lifted`), `lift-done`, `pieces {ids}` (the store changed: the lift ends; a gone piece's selection, sheet and drag end), `edited {placeId, before, merge?, seal?}` (push an entry; the oldest goes past 50. With `merge`, while the newest entry is an open run with the same `merge` and place, the edit folds into it: it keeps its `before` and takes the new `seq`, so dragging through the colour picker is one Undo. `seal`, sent when the picker commits, closes the run after this edit), `seal` (closes an open run; `close-sheet`, `tool` and `undo` close it too), `edit-failed {seq}` (that edit's write failed: its entry goes from `undo` or `undoing`), `undo` (the newest entry moves to `undoing`), `undo-saved {seq}` (gone for good), `undo-failed {seq}` (back on top of `undo`).
- A run's entry carries its newest edit's `seq`, so if that write fails the whole run's entry goes (an earlier pick's failure fails every later queued write too).
- Undo follows FarmStore's contract (docs/farm.md): an intent shows at once and its write commits later in call order; a failed write rolls the store back to its last committed snapshot and fails every write queued after it. So each failure drops exactly the entries whose edits the store no longer has, and an Undo whose write fails puts its entry back only if the edit itself was saved (a failed edit's `edit-failed` arrives first and removes it).
- Nothing happens under an open sheet: taps and drags are ignored while paused.

### Selection and resize of things (`edit/selection.js`)

`<kf-edit-layer>` keeps one of these and renders the selection ring, its resize handle and the badges from it after every event; `<kf-board>` keeps a resize gesture for the scale.

```
none ──tap | grab | pencil {id}──▶ selected(id) ──handle-down {id, pointerId, pivot, corner}──▶ resizing(id)
selected(id) ──tap {id}──▶ selected(id)   (tapAction: 'open-card')       tap-empty: unchanged
resizing ──handle-move {pointerId, k}──▶ resizing (k)
resizing ──handle-up | handle-cancel | lost-capture {pointerId}──▶ selected(id)
any ──things {ids} without the id──▶ none            any ──leave──▶ none
```

- States: `{phase: 'none', id: null}` (`NO_SELECTION`), `{phase: 'selected', id}`, `{phase: 'resizing', id, pointerId, pivot, corner, k}`. `pivot` is the thing's feet and `corner` where the handle was placed, both client px; `k` is the scale shown now (already clamped by the board). Unchanged events return the same object.
- `initialSelection()`, `nextSelection(state, event)`, `selectedId(state)`, `isResizing(state)`, `ownsPointer(state, pointerId)`, `tapAction(state, id)` (`select`, `open-card` for the selected thing, `ignore` while resizing or without an id), `handleOffset(state)` (`[dx, dy]` of the handle: the corner scaled by `k` about the pivot), `resizeOutcome(prev, next, event)` (`commit` when `handle-up` ends a resize, `cancel` when anything else does, else null).
- Resizing ignores `tap`, `grab`, `pencil` and a second `handle-down`; move and end events of another pointer are ignored. `handle-down` needs the thing selected and a pivot and corner (the board could start). `things` and `leave` from `resizing` cancel the resize.
- The board's half: `resizeGesture(id, thing, pivot, at)` and `resizeGestureTo(gesture, at)`: the scale `s` is the finger's distance from the pivot over the distance at the start (1 when the press was within 1 px of the feet), clamped by `geometry/transform.js` `clampThingScale`.

### Hold (`edit/hold.js`)

```
idle ──down──▶ pending (0 to 0.5 s, nothing shown) ──▶ showing (ring fills) ──▶ armed (1.5 s)
pending|showing ──up, cancel, move > 10 px, second pointer, palm──▶ cancelled
```

- `HOLD = {holdMs: 1500, showMs: 500, moveTolPx: 10, edgeBottomPx: 40, edgeSidePx: 20, palmPx: 140}`.
- `showMs` is at most a third of `holdMs`, so a normal toddler hold sees nothing.
- Never starts in the bottom 40 px or within 20 px of a side edge (system gestures).
- `isPalm(e)`: both contact sides over 140 px (`width > 140 && height > 140`). iPad Safari reports a fingertip as 40 to 90 px wide, so a smaller threshold rejected real taps.
- `initialHold()`, `nextHold(state, event, {holdMs})`. Events: `down {x, y, t, width, height, vw, vh, pointerId}`, `move`, `up`, `cancel`, `second-pointer`, `tick {t}`. `progress` 0..1 drives the ring. Cancelled states carry a `reason`. An armed state records `released`.

### Adult check (`edit/adult-check.js`)

- `newChallenge(rng, kind, nowMs)`. `keypad`: a shuffled 1 to 9 pad and a random 3-digit code of digits 1 to 9 (about 1 in 729 by chance). `sum`: "What is a + b?" with a + b between 11 and 18, typed on a shuffled 0 to 9 pad (1 in 100).
- `press(state, key, tMs)` returns `{state, result: 'continue'|'pass'|'fail'}`. A wrong key, a tap between keys (`key = null`) or `IDLE_MS = 10000` without a key fails.
- `tick(state, tMs)`: time passing without a key. `promptText(state)`: "Tap 4 7 2" or "What is 7 + 8?".
- The kind comes from `settings.gateKind` (then `flags.gateKind`, default `keypad`).

### Leg flow (`edit/leg-flow.js`)

```
choose-count ──count n──▶ placing (leg k of n) ──last leg placed──▶ done
any state ──count m──▶ placing or done (fewer than placed drops the newest legs)
placing|done ──Clear──▶ placing (leg 1 of n)      placing ──Spread evenly──▶ done
placing ──Spread the rest──▶ done (the placed legs stay; the missing ones fill the gaps)
```

- State `{target: number|null, legs: [{x, y}], history: legs[][], drag: null|{index, moved, before}}`. `legPhase(s)` is `choose-count`, `placing` or `done`.
- `LEG_CHOICES` 0 to 8 (`MAX_LEGS`), `SUGGESTED_LEGS = 2`, `UNDO_DEPTH = 30`.
- `legFlow(legs, target)`: start from a thing (done with its legs) or a draft's picked count.
- `chooseCount(s, n)`: works from every state. `spreadEvenly(s, outline)`: `farm/legs.js` `spreadLegs` along the bottom. `spreadRest(s, outline)`: keeps the placed legs and adds the missing ones, each on the evenly spread spot farthest from every leg so far (with none placed it equals `spreadEvenly`; with none missing it returns `s`). Guided add's "Spread the rest and continue" uses it, so leaving the Legs step never ends with fewer legs than chosen. `clearLegs(s)`. `undoLeg(s)` steps back one placed, moved, spread, cleared or count-dropped change.
- Pointer events, points in board coordinates already snapped inside the outline by the caller: `pressLeg(s, pt, snapped, r)` grabs a leg within `r` (`legAt`) or places the next leg while placing, else does nothing; `moveLeg(s, snapped)` drags the grabbed leg; `releaseLeg(s, snapped)` ends a drag (undoable) or, for a still press on a leg while placing, places the next leg there; `cancelPress(s)`. No event removes a leg by accident.
- `legView(s)`: everything the panel shows (heading, note, count buttons with `pressed` and `suggested`, `canSpread`, `missing` (legs still to place), `canUndo`, `canClear`). The component renders only from it.

### Session (`session.js`)

`new Session({now, holdMs, timers, win, doc, services, createRing})`. Clock, timers, window, document and ring are injectable for tests. `connect(services)` hands over `{audio, engine, store, shell}`.

| Member | What it does |
|---|---|
| `state` | The current session state. |
| `holdArmed(then?)`, `gatePassed()`, `gateFailed()`, `done()`, `activity()` | Session transitions. |
| `openPanel(name, params)`, `closePanel()`, `sceneTools()`, `sceneDone()`, `playTap()` | Panel and view transitions. |
| `holdStart(pointerEvent, el, {then, holdMs, edges}?)` | Called by `<kf-board>` on every primary `pointerdown`, and by `<kf-find-buttons>` with `then` (the setup panel), `holdMs` 1000 and `edges: false` (the buttons sit in the corners, where board holds are refused). Drives `edit/hold.js`, the `<kf-hold-ring>` and `audio.holdTone(on)`. |

Events:

- `change` `{from, to}`: only when mode or panel changes. `shell.js` remounts on it. `<kf-find-buttons>` re-renders on it.
- `hold-armed` `{x, y, then}`: a hold completed.

Side effects on a mode change: `audio.chime('enter')` going into edit or scene, `chime('leave')` coming out; `engine.setMode(...)` with `gate` mapped to `play`; a 1 s ticker runs only while in edit or scene.

Hold behaviour: holds start only in play, or in edit with no panel open. The ring refreshes every 32 ms with attribute writes only, and lingers up to 1.5 s after arming. In play, an armed hold opens the gate. In edit, holding an empty spot opens guided add at that spot. Holding a thing does nothing. A full scene (`settings.maxThings`, 8 by default) shows a toast instead. A find button hold in edit does nothing.

Ways in without the hold (US-7.6): the `e` key on a keyboard (not in a text field), and a visually hidden "Edit" button for VoiceOver, present only in play.

## How it fits

- `<kf-board>` filters input (primary pointer only, `isPalm` from `edit/hold.js`), then calls `session.holdStart` and, in play, `session.playTap`.
- `Session` listens to window `pointerdown` (capture) to record activity.
- `shell.js` mounts `<kf-adult-check>` for `gate`, the edit layer for `edit`, `<kf-scene-tools>` for `scene`, and the panel named in `state.panel`.
- `<kf-adult-check>` uses `edit/adult-check.js` and calls `gatePassed` or `gateFailed`. `<kf-edit-layer>` opens `card`, `scenes`, `settings` and calls `done`. `<kf-scenes>` calls `sceneTools`. `<kf-scene-tools>` runs `edit/scene-tools.js` and calls `sceneDone`.
- `Session` drives `PlayEngine.setMode`. Things wiggle in edit and fade in scene. Find rounds end and the sleep timer pauses outside play.
- `edit/` is a pure domain. It imports only other pure domains and `types.js`. No DOM, no time, no randomness: `rng` and times in ms are arguments. `tests/unit/boundaries.test.js` enforces this. `session.js` is the shell around it.

## Rules and gotchas

- Primary pointer only. A second finger cancels a hold. Palms never start or continue a hold.
- A toddler holding a thing sees nothing for 0.5 s, and a toddler mashing the gate fails it and lands silently back in play.
- Gate fail, Escape and the 10 s idle timeout return to play silently. No failure sound.
- Edit mode always ends. Do not add a panel that keeps it open without user activity, except while the panel is open.
- `change` fires only on mode or panel changes, not on every activity tick. Keep it that way: the shell remounts on it.
- No timers in play beyond the hold's own. The edit ticker stops when edit ends, so the board can still sit at 0 fps.
- Performance budget on the base iPad (A16): the hold ring writes DOM attributes, never canvas work. The board keeps its 2 ms frame budget while a hold runs.

## Tests

- `web/js/edit/hold.test.js`: ring timing, cancel reasons, wobble tolerance, palms, edges, second pointer.
- `web/js/edit/adult-check.test.js`: shuffles, seeded determinism, edge rng values, pass, wrong key, missed tap, idle timeout, sum kind.
- `web/js/edit/leg-flow.test.js`: every transition: count changes midway, eight close legs, grab and drag, stray presses, cancel, Spread evenly (also from 2 placed after choosing 4), Spread the rest (keeps placed legs, fills the gaps, Undo, no-ops), Clear, Undo (full legs array after a drag, also after a smaller count), bounded history.
- `web/js/edit/scene-tools.test.js`: every transition: tools, sheets, pausing, tap-away, deselect, drags, colours, pieces going away, templates, the lift after a drop, and undo: push, limit, pop, saved, failed edit, failed Undo, undo after a template Start, colour picker runs (merge, seal, what ends a run, a failed run).
- `web/js/edit/session.test.js`: gate flow, Done, auto-close in edit and scene, grace, panels pause auto-close, play tap, `then` through the gate and grace.
- `web/js/session.test.js`: `Session` with fake timers and window. Ring and soft tone, cancels, no timers left in play, chimes, engine mode, hold in edit opens guided add, find button holds, the full-scene toast uses `maxThings`.
- `tests/browser/package-c.test.js`: edit mode in Chromium. Run with `npm test` and `npm run test:browser`.

Keep this file current: update it in the same commit as any change to this domain.
