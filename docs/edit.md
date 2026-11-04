# Edit

## Purpose

Edit is how a grown-up gets from the toddler's play board into edit mode and back. A long hold opens an adult check. Passing it opens edit mode, where panels (thing card, guided add, scenes, settings) sit over the board. Edit mode always ends, either with Done or by itself after a minute without activity. `Session` owns this state and is the only writer.

## Files

- `web/js/edit/hold.js`: pure reducer for the hold-to-edit gesture, plus `isPalm`, the palm rule the board also uses.
- `web/js/edit/adult-check.js`: pure parental gate (keypad code or a sum).
- `web/js/edit/session.js`: pure session state machine (`nextSession`).
- `web/js/edit/leg-flow.js`: pure state machine for adding and changing a thing's legs (used by `kf-guided-add/legs.js`).
- `web/js/session.js`: `Session`, the state owner. Wraps the reducers with a clock, timers, window listeners, the hold ring and chimes.
- Tests: `web/js/edit/*.test.js`, `web/js/session.test.js`.

## Public API and state machines

### Session state (`edit/session.js`)

```
state = {mode: 'play'|'gate'|'edit'|'scene', panel: null | {name, params}, lastActivityAt, graceUntil}

play ──hold-armed──▶ gate ──gate-pass──▶ edit ⇄ scene ──done──▶ play
  │                   └──gate-fail──▶ play        (scene-tools / scene-done)
  └──hold-armed within grace──▶ edit (no check)
edit|scene ──tick, 60 s no activity, no panel──▶ play, grace for 5 min
```

- `AUTO_CLOSE_MS = 60000`, `GRACE_MS = 300000`.
- `initialSession(nowMs)`, `nextSession(state, event, nowMs)`. Returns the same object when nothing changed.
- Events: `hold-armed`, `gate-pass`, `gate-fail`, `done` (to play, clears grace), `activity`, `open-panel {name, params}`, `close-panel`, `scene-tools` (edit to scene), `scene-done` (scene to edit), `tick`, `play-tap` (cancels grace).
- Panels open only in edit or scene. An open panel pauses auto-close.
- During grace the hold alone reopens edit. A play tap cancels grace.
- Panel names in use: `card`, `guided`, `scenes`, `settings`. `shell.js` maps them to components.

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
```

- State `{target: number|null, legs: [{x, y}], history: legs[][], drag: null|{index, moved, before}}`. `legPhase(s)` is `choose-count`, `placing` or `done`.
- `LEG_CHOICES` 0 to 8 (`MAX_LEGS`), `SUGGESTED_LEGS = 2`, `UNDO_DEPTH = 30`.
- `legFlow(legs, target)`: start from a thing (done with its legs) or a draft's picked count.
- `chooseCount(s, n)`: works from every state. `spreadEvenly(s, outline)`: `farm/legs.js` `spreadLegs` along the bottom. `clearLegs(s)`. `undoLeg(s)` steps back one placed, moved, spread, cleared or count-dropped change.
- Pointer events, points in board coordinates already snapped inside the outline by the caller: `pressLeg(s, pt, snapped, r)` grabs a leg within `r` (`legAt`) or places the next leg while placing, else does nothing; `moveLeg(s, snapped)` drags the grabbed leg; `releaseLeg(s, snapped)` ends a drag (undoable) or, for a still press on a leg while placing, places the next leg there; `cancelPress(s)`. No event removes a leg by accident.
- `legView(s)`: everything the panel shows (heading, note, count buttons with `pressed` and `suggested`, `canSpread`, `canUndo`, `canClear`). The component renders only from it.

### Session (`session.js`)

`new Session({now, holdMs, timers, win, doc, services, createRing})`. Clock, timers, window, document and ring are injectable for tests. `connect(services)` hands over `{audio, engine, store, shell}`.

| Member | What it does |
|---|---|
| `state` | The current session state. |
| `holdArmed()`, `gatePassed()`, `gateFailed()`, `done()`, `activity()` | Session transitions. |
| `openPanel(name, params)`, `closePanel()`, `sceneTools()`, `sceneDone()`, `playTap()` | Panel and view transitions. |
| `holdStart(pointerEvent, boardEl)` | Called by `<kf-board>` on every primary `pointerdown`. Drives `edit/hold.js`, the `<kf-hold-ring>` and `audio.holdTone(on)`. |

Events:

- `change` `{from, to}`: only when mode or panel changes. `shell.js` remounts on it. `<kf-find-buttons>` re-renders on it.
- `hold-armed` `{x, y}`: a hold completed.

Side effects on a mode change: `audio.chime('enter')` going into edit or scene, `chime('leave')` coming out; `engine.setMode(...)` with `gate` mapped to `play`; a 1 s ticker runs only while in edit or scene.

Hold behaviour: holds start only in play, or in edit with no panel open. The ring refreshes every 32 ms with attribute writes only, and lingers up to 1.5 s after arming. In play, an armed hold opens the gate. In edit, holding an empty spot opens guided add at that spot. Holding a thing does nothing. A full scene (4 things) shows a toast instead.

Ways in without the hold (US-7.6): the `e` key on a keyboard (not in a text field), and a visually hidden "Edit" button for VoiceOver, present only in play.

## How it fits

- `<kf-board>` filters input (primary pointer only, `isPalm` from `edit/hold.js`), then calls `session.holdStart` and, in play, `session.playTap`.
- `Session` listens to window `pointerdown` (capture) to record activity.
- `shell.js` mounts `<kf-adult-check>` for `gate`, the edit layer for `edit`, `<kf-scene-tools>` for `scene`, and the panel named in `state.panel`.
- `<kf-adult-check>` uses `edit/adult-check.js` and calls `gatePassed` or `gateFailed`. `<kf-edit-layer>` opens `card`, `scenes`, `settings` and calls `done`. `<kf-scenes>` calls `sceneTools`. `<kf-scene-tools>` calls `sceneDone`.
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
- `web/js/edit/leg-flow.test.js`: every transition: count changes midway, eight close legs, grab and drag, stray presses, cancel, Spread evenly, Clear, Undo (also after a smaller count), bounded history.
- `web/js/edit/session.test.js`: gate flow, Done, auto-close in edit and scene, grace, panels pause auto-close, play tap.
- `web/js/session.test.js`: `Session` with fake timers and window. Ring and soft tone, cancels, no timers left in play, chimes, engine mode, hold in edit opens guided add.
- `tests/browser/package-c.test.js`: edit mode in Chromium. Run with `npm test` and `npm run test:browser`.

Keep this file current: update it in the same commit as any change to this domain.
