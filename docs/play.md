# Play

## Purpose

Play is the live board a toddler touches. Things wander, blink, jump and speak when tapped, fall asleep after a while, and run the two Find games when the child presses a find button. The world is ephemeral. It is rebuilt from the FarmStore at any time and is never saved. `PlayEngine` owns it and is the only writer.

## Files

- `web/js/play/world.js`: the pure simulation. Actors, wandering, blinking, reactions, drop-in, edit wiggle, sleep, fixed timestep, `isIdle` and `nextWakeMs`.
- `web/js/play/hit.js`: point in polygon, `hitTest` with a 1.3x outline and a minimum radius, `centroid`, `extents`, `ASPECT = 0.75`.
- `web/js/play/mash.js`: mash policy for taps (restart after 300 ms, nothing queues).
- `web/js/play/sleep.js`: the sleep timer.
- `web/js/play/find.js`: the Find games state machine (animal and colour rounds).
- `web/js/play/colors.js`: folds felt palette keys into simple colour words, and the hex for each colour button.
- `web/js/play-engine.js`: `PlayEngine`, the state owner. Wires the pure parts to the store, audio and renderer.
- Tests: `web/js/play/*.test.js`, `tests/unit/play-engine.test.js`, `tests/unit/find-it.test.js`.

## Public API

### PlayEngine (`play-engine.js`)

`new PlayEngine({store, audio, presets, scripts, rng, flags, now})`. `rng` and `now` (monotonic ms) are injected. `main.js` passes `performance.now`.

| Member | What it does |
|---|---|
| `actors` | The world's actor array, mutated in place. The renderer reads `pose`, `x`, `y`, `facing`, `glow`. |
| `mode`, `setMode(m)` | `play`, `edit` or `scene`. Called by `Session` (gate maps to `play`). Leaving play ends any find round and pauses the sleep timer. Entering play restarts the sleep timer. |
| `step(dt)` | Advances by the frame delta. After an idle gap it counts the gap with its own clock, so a wake-up step may pass any dt, even 0. |
| `tap(x, y)` | A child's tap in board coordinates, play only. Returns the thing id or null. |
| `pick(x, y)` | Which thing is at (x, y), any mode. Used for edit taps and the edit-mode hold. |
| `fingerDown(bool)` | All things pause while a finger is down (US-5.3). |
| `startFind(kind)` | `'animal'` or `'color'`. Starts a round, or repeats the question if that game is already running. Call inside the press. |
| `stopFind()` | Ends a round quietly. |
| `asking`, `findRound`, `findAvailable` | Current animal target, current round `{kind, thingId, color}`, and whether the find buttons should show. |
| `dropIn(thingId)` | A newly added thing falls in. Works before or after the store's change event. |
| `isIdle()`, `nextWakeMs()` | For the renderer's 0 fps idle (below). |
| `hitMinRadius` | Board widths. The board sets it to `60 / boardWidthPx` (targets at least 120 CSS px across). |
| `actorFor(id)`, `dispose()` | Live actor lookup; removes the store listener. |

Events (all `CustomEvent`):

- `reaction` `{thingId, x, y, celebrate?}`: a tap reaction started. The renderer bursts confetti.
- `wake` `{}`: something started moving without a frame being requested (tap, drop, mode change, store change, finger lifted, prompt ended). The renderer calls `wake()`.
- `ask` `{kind, thingId, color, repeat}`: a find question started.
- `answer` `{thingId, outcome}`: a tap during a round, `correct` or `wrong`.
- `find` `{round, available}`: a round started or ended, or the buttons should show or hide. `<kf-find-buttons>` listens.

### World (`play/world.js`)

`createWorld(things, {rng, presets, mode, reduceMotion})`, `syncWorld(world, things, rng, {drop})`, `setMode`, `react`, `dropActor`, `sleepAll`, `step(world, dt, {fingerDown}, rng)`, `isIdle`, `nextWakeMs`, `hitTargets`, `actorFor`. Constants: `TICK = 1/60`, `GROUND_TOP = 0.55`.

Actor states:

```
idle ──rest timer──▶ moving ──arrived──▶ idle
  any ──tap──▶ react (1 s jump) ──▶ idle
  new / place switched ──▶ drop (0.7 s, staggered 0.12 s) ──▶ idle | wiggle | sleep
  setMode('edit') ──▶ wiggle (decays over 2 s, then still)
  sleepAll ──▶ sleep (yawn 1.6 s, settled at 2.2 s; a tap only stirs for 0.6 s)
```

- Fixed 1/60 s timestep with an accumulator, so 30, 60 and 120 fps behave the same.
- At most 15 active ticks (0.25 s) per step. A long hitch is dropped, not replayed.
- Idle gaps are skipped cheaply: timers advance in one jump (`advanceIdle`), up to one day.
- `move` ramps 0..1 over 0.25 s, so walks start and stop without pops.
- First rest is 1 to 4 s. Back to play from edit, rest is 1 to 3 s.
- Walkers (`ground`, `hop`) keep their feet below `GROUND_TOP`. Everyone stays inside the board and turns at the edges.
- Reduce motion sets `speedFactor = 0.5`.
- Surviving things keep their offset when the store changes. A redrawn thing that was walking rests and picks a new target.

### Mash (`play/mash.js`)

`decideTap(state, thingId, nowMs)` returns `{action: 'play'|'restart'|'ignore', stopCurrent}`. Nothing playing: play. A different thing: stop the current clip and play at once. The same thing: ignore within `RESTART_MS = 300`, else restart. Nothing ever queues. `startPlaying` and `stopPlaying` use a token so a stale clip ending changes nothing.

### Sleep (`play/sleep.js`)

`createSleep(minutes)` (0 or bad input means off), `tickSleep(state, dt)` returns true once, on the step it falls asleep, `sleepRemainingS(state)`. Paused outside play.

### Find (`play/find.js`, `play/colors.js`)

```
idle ──startRound──▶ asking ──right tap──▶ idle (celebration)
                      │ wrong tap: the thing says its name, then the question repeats
                      │   after 2 misses the right thing(s) glow and hop
                      │ 6 s quiet without the right tap: the right thing(s) hop, the question repeats once
                      └─ 30 s without the right tap: the round ends quietly, no failure sound
```

- `FIND = {nudgeAfterS: 6, timeoutS: 30, hintAfterMisses: 2}`.
- Rounds start only from `<kf-find-buttons>`. Nothing asks by itself.
- Animal: prefers things that can be asked for by name (a prompt or name clip, or a typed name when the device can speak). Never the last target when there are two or more.
- Colour: a simple colour present among the things, never the last one when there are two or more. Any thing of that colour is right. `colorGroup(key)` folds felt keys (`sky`, `water`, `deep` are all blue). `groupHex(group)` gives the button's dot colour.
- `stepFind` counts quiet time only while `calm` (no voice playing). `reconcileFind` ends a round whose answer left the scene. `findRemainingS` feeds `nextWakeMs`.
- Exports: `createFind`, `startRound`, `endRound`, `stepFind`, `isAnswer`, `answerFind`, `hinting`, `reconcileFind`, `findRemainingS`.

## Idle rules (0 fps)

- `engine.isIdle()` is true when no actor reacts, drops, wiggles, settles into sleep, stirs, walks or blinks, and no hint glow shows.
- `engine.nextWakeMs()` is the soonest of: the next wander or blink, the sleep timer, a find nudge or timeout (play only). Infinity when nothing is scheduled.
- `io/renderer.js` stops `requestAnimationFrame` when idle and sets one `setTimeout(nextWakeMs)`. A `wake` event restarts it.
- Every outside call (`tap`, `setMode`, `fingerDown`, `startFind`, store change) first runs `_catchUp()` to account for the idle gap.

## Audio during play

- A tap plays the thing's name then its sound (`farm/intents.tapClips`). No recording: a chime, then the device voice says the typed name.
- Language: fixed, or with "mix" (`playLanguage: "alternate"`) a random language among those recorded for that thing, per tap (`playLanguageFor` with the injected rng).
- Animal question: the parent's recorded prompt (takes rotate), else a scripted cue in the device voice, else the recorded name; then the thing's sound as a clue. Colour question: "Find something yellow!" in the device voice, else a chime.
- Correct: a happy jump, confetti, a `yay` chime, then the name and sound.
- Audio calls go through `_call`, which swallows errors. Audio trouble never breaks play.

## How it fits

- `<kf-board>` calls `fingerDown`, `tap`, `pick`, sets `hitMinRadius`, and filters input first (primary pointer only, palms ignored via `edit/hold.js` `isPalm`).
- `<kf-find-buttons>` calls `startFind` on `pointerdown` and listens to `find`.
- `Session` calls `setMode`. Guided add calls `dropIn`.
- `io/renderer.js` calls `step`, reads `actors`, listens to `reaction` and `wake`.
- The engine listens to the store's `change`: rebuilds actors, applies `sleepMinutes` and `reduceMotion`, drops things in on a place switch (not on hydrate or replace), ends a round whose scene or answer is gone. It reads the store and never writes it.
- `play/` is a pure domain. It imports only other pure domains (`motion/`, `farm/`) and `types.js`. No DOM, no time, no randomness: `rng` and times are arguments. `tests/unit/boundaries.test.js` enforces this. `play-engine.js` is the shell around it.

## Rules and gotchas

- Primary pointer only, palms ignored. The board filters before the engine sees anything.
- Mash policy: nothing queues, ever. Restart the same thing only after 300 ms.
- Things freeze while a finger is down and while a find question plays (DESIGN decision 7). `_advance` sets `fingerDown = finger || prompting`.
- Sleep timer: after `sleepMinutes` of play everyone yawns and sleeps. Taps then only stir, with no sound. Find rounds end and the buttons hide.
- Start audio and speech synchronously inside the gesture. iOS needs it. `tap` and `startFind` do this.
- Tokens guard every async callback (`_askToken`, `_roundToken`, mash token). An old prompt ending must never unfreeze things or repeat a question.
- No allocation in `step`. `hitTargets` allocates, so call it on taps only.
- Every reaction returns to idle within 3 s (US-5.2). Confetti lasts at most 1 s.
- Performance budget on the base iPad (A16): frame work under 2 ms with 4 things moving, tap to visible reaction in the same frame, tap to sound under 50 ms, and 0 fps when nothing moves.
- `play/hit.js` duplicates the contract of `geometry/hit.js`. Keep them in step, or merge them.

## Tests

- `web/js/play/world.test.js`: centroids, unknown presets, speed cap, ground band, edges, rests, finger pause, react, drop, wiggle, sleep, idle and `nextWakeMs`, frame-rate independence.
- `web/js/play/hit.test.js`, `mash.test.js`, `sleep.test.js`, `find.test.js`: each pure module, with fixed rng.
- `tests/unit/play-engine.test.js`: the engine with a fake audio and a MemoryRepo-backed store. Taps, sounds, confetti, 1.3x hit target, catch-up after idle.
- `tests/unit/find-it.test.js`: find games end to end. Never starts by itself, button visibility, voice fallbacks, nudges, hints, timeouts.
- `tests/browser/`: the board in Chromium. Run with `npm test` and `npm run test:browser`.

Keep this file current: update it in the same commit as any change to this domain.
