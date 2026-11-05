# Play

## Purpose

Play is the live board a toddler touches. Things wander, blink, jump and speak when tapped, fall asleep after a while, and run the two Find games when the child presses a find button. The world is ephemeral. It is rebuilt from the FarmStore at any time and is never saved. `PlayEngine` owns it and is the only writer.

## Files

- `web/js/play/world.js`: the pure simulation. Actors, wandering, blinking, reactions, drop-in, edit wiggle, sleep, fixed timestep, `isIdle` and `nextWakeMs`.
- `web/js/play/spread.js`: `spreadBoxes(boxes, opts)`, moves overlapping boxes apart for edit mode (below).
- `web/js/play/hit.js`: point in polygon, `hitTest` with a 1.3x outline and a minimum radius, `centroid`, `extents`, `ASPECT = 0.75`.
- `web/js/play/mash.js`: mash policy for taps (restart after 300 ms, nothing queues).
- `web/js/play/sleep.js`: the sleep timer.
- `web/js/play/find.js`: the Find games state machine (animal and colour rounds).
- `web/js/play/ask.js`: what a find question plays, in order (pure plans: `planAnimalAsk`, `planColorAsk`, `colorAskLanguage`, `recordedColorLangs`). A plan is `{ask, clue, recorded}`.
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
| `grab(thingId)` | Edit mode only: pick a thing up to drag it. It holds a still rest pose. Returns its anchor `{x, y}` or null. |
| `dragTo(x, y)` | Puts the held thing's anchor at (x, y) exactly (no smoothing) and fires `wake`. |
| `release(commit = true)` | Puts it down. With `commit` it stays and the result `{thingId, dx, dy}` is how far to move its outline in the store (`geometry/transform.js` `movedThingPatch`); without, it goes back and returns null. `held` is the id being dragged. Leaving edit mode drops the hold. |
| `fingerDown(bool)` | All things pause while a finger is down (US-5.3). |
| `startFind(kind)` | `'animal'` or `'color'`. Starts a round, or repeats the question if that game is already running. Call inside the press. |
| `stopFind()` | Ends a round quietly. |
| `asking`, `findRound`, `findAvailable` | Current animal target, current round `{kind, thingId, color}`, and whether the find buttons should show. |
| `dropIn(thingId)` | A newly added thing falls in. Works before or after the store's change event. |
| `isIdle()`, `nextWakeMs()` | For the renderer's 0 fps idle (below). |
| `settling` | Things are gliding apart (edit-mode spread) or dropping in. `<kf-edit-layer>` places no badges until it is false. |
| `hitMinRadius` | Board widths. The board sets it to `60 / boardWidthPx` (targets at least 120 CSS px across). |
| `actorFor(id)`, `dispose()` | Live actor lookup; removes the store listener. |

Events (all `CustomEvent`):

- `reaction` `{thingId, x, y, celebrate?}`: a tap reaction started. The renderer bursts confetti.
- `wake` `{}`: something started moving without a frame being requested (tap, drop, mode change, store change, finger lifted, prompt ended). The renderer calls `wake()`.
- `ask` `{kind, thingId, color, repeat, recorded}`: a find question started. `recorded` is false when nothing is recorded for that question (no prompt for the animal in any language; for the colour game, no question plus this colour's word in the language played), so the device voice or a fallback asks. `<kf-find-buttons>` then shows the grown-up its recording tip.
- `answer` `{thingId, outcome}`: a tap during a round, `correct` or `wrong`.
- `find` `{round, available}`: a round started or ended, or the buttons should show or hide. `<kf-find-buttons>` listens.
- `spread` `{moves: [{thingId, dx, dy}]}`: edit mode spread things apart; a microtask after the spread (never inside a store change). `<kf-board>` saves each move with `movedThingPatch`, like a drop.

### World (`play/world.js`)

`createWorld(things, {rng, presets, mode, reduceMotion})`, `syncWorld(world, things, rng, {drop})`, `setMode`, `react`, `dropActor`, `sleepAll`, `step(world, dt, {fingerDown}, rng)`, `isIdle`, `nextWakeMs`, `hitTargets`, `actorFor`, `spreadActors`, `takeSpreadMoves` and `isSettling` (edit-mode spread, below), and for the edit drag `holdActor` (still, settled wiggle), `placeActor(world, id, x, y)` and `settleActor` (the drop point becomes home; the actor's outline moves with it so taps hit it before the store catches up; returns `[dx, dy]`). Constants: `TICK = 1/60`, `GROUND_TOP = 0.55`, `GLIDE_S = 0.3`.

Actor states:

```
idle ──rest timer──▶ moving ──arrived──▶ idle
  any ──tap──▶ react (1 s jump) ──▶ idle
  new / place switched ──▶ drop (0.7 s, staggered 0.12 s) ──▶ idle | wiggle | sleep
  setMode('edit') ──▶ wiggle (decays over 2 s, then still); overlapping things glide apart (0.3 s)
  edit: grab ──▶ wiggle, settled (held still, follows dragTo) ──release──▶ same, home = drop point
  sleepAll ──▶ sleep (yawn 1.6 s, settled at 2.2 s; a tap only stirs for 0.6 s)
```

- Fixed 1/60 s timestep with an accumulator, so 30, 60 and 120 fps behave the same.
- At most 15 active ticks (0.25 s) per step. A long hitch is dropped, not replayed.
- Idle gaps are skipped cheaply: timers advance in one jump (`advanceIdle`), up to one day.
- `move` ramps 0..1 over 0.25 s, so walks start and stop without pops.
- First rest is 1 to 4 s. Back to play from edit, rest is 1 to 3 s.
- Walkers (`travel.mode` `ground` or `hop`: walk, hop and scuttle) keep their feet below `GROUND_TOP`. Everyone stays inside the board and turns at the edges.
- Reduce motion sets `speedFactor = 0.5`.
- Surviving things keep their offset when the store changes. A redrawn thing that was walking rests and picks a new target.

### Edit-mode spread (`play/spread.js`, `spreadActors`)

Owner request after meeting 2: in edit mode no two things overlap, so each one and its pencil and cross can be reached.

- When: entering edit mode (`setMode('edit')`), and when `syncWorld` in edit mode adds things (a new thing, an undone delete, a place switched to) or a thing's extents change (Size, Redraw). Never in play or scene mode. A thing a parent drops onto another stays there: the parent chose the spot; the next edit session spreads it.
- `spreadBoxes(boxes, {gap, padTop, minHalfWidth, margin, obstacles})` works in board widths on both axes. A box that overlaps nothing (boxes or obstacles) keeps its exact position. The others are placed one by one in drawing order: each keeps its spot if free, else takes the nearest free spot flush beside a placed box or obstacle (or a board edge), clamped onto the board; if nothing is free, the spot with the least overlap. Greedy placement instead of pairwise pushes, because pushes jam when a row is wider than the board. Deterministic; about n³ candidate checks for n ≤ 12, once per spread.
- World settings (`SPREAD` in `world.js`): gap 0.015, `padTop` 0.03 (the 52 px badges sit centred on each thing's top edge), `minHalfWidth` 0.055 (pencil and cross sit at most 70 px each side of the top centre), margin 0.01, and the edit bar as an obstacle (x 0.24 to 0.76, y from 0.9). A thing with legs counts `farm/legs.js` `LEG_MAX` below its outline. A moved box never goes further past an edge than it already was.
- Each moved actor glides over `GLIDE_S` (smoothstep, `glideT`, from `gx, gy` to `tx, ty`) and is marked `spreadPending`. `isIdle` is false while gliding. Picking a thing up (`holdActor`, `placeActor`) stops its glide under the finger and drops its pending move (its drop saves it); leaving edit mode finishes a glide at once.
- Saved, so it sticks: `PlayEngine` calls `takeSpreadMoves` a microtask later and sends the `spread` event. Like `settleActor`, the glide target becomes the actor's home and its outline moves with it. When the store catches up (new home = glide target) `syncWorld` lets the glide carry on; any other store change finishes it first and keeps the offset.

## Idle rules (0 fps)

- `engine.isIdle()` is true when no actor reacts, drops, wiggles, settles into sleep, stirs, walks or blinks, and no hint glow shows.
- `engine.nextWakeMs()` is the soonest of: the next wander or blink, the sleep timer, a find nudge or timeout (play only). Infinity when nothing is scheduled.
- `io/renderer.js` stops `requestAnimationFrame` when idle and sets one `setTimeout(nextWakeMs)`. A `wake` event restarts it.
- Every outside call (`tap`, `setMode`, `fingerDown`, `startFind`, store change) first runs `_catchUp()` to account for the idle gap.

## Audio during play

- A tap plays the thing's name then its sound (`farm/intents.tapClips`). No recording: a chime, then the device voice says the typed name.
- Language: fixed, or with "mix" (`playLanguage: "alternate"`) a random language among those recorded for that thing, per tap (`playLanguageFor` with the injected rng).
- Animal question: the parent's recorded prompt (a random take), else a cue line in the device voice, else the recorded name; only then the thing's sound as a clue (`play/ask.js`). Colour question: the recorded colour question then the recorded colour word (`audio.playSequence`), else "Tap on an animal that is yellow!" in the device voice, else a chime.
- Correct: a happy jump, confetti, a `yay` chime, then the name and sound.
- Audio calls go through `_call`, which swallows errors. Audio trouble never breaks play.

## How it fits

- `<kf-board>` calls `fingerDown`, `tap`, `pick`, sets `hitMinRadius`, and filters input first (primary pointer only, palms ignored via `edit/hold.js` `isPalm`).
- `<kf-find-buttons>` calls `startFind` on `pointerup` of a short tap (a user activation on iOS, so the device voice may start) and listens to `find`. Holding a button opens its setup panel instead.
- `Session` calls `setMode`. Guided add calls `dropIn`.
- `io/renderer.js` calls `step`, reads `actors`, listens to `reaction` and `wake`.
- The engine listens to the store's `change`: rebuilds actors, applies `sleepMinutes` and `reduceMotion`, drops things in on a place switch (not on hydrate or replace), ends a round whose scene or answer is gone. It reads the store and never writes it.
- `play/` is a pure domain. It imports only other pure domains (`motion/`, `farm/`) and `types.js`. No DOM, no time, no randomness: `rng` and times are arguments. `tests/unit/boundaries.test.js` enforces this. `play-engine.js` is the shell around it.

## Rules and gotchas

- Primary pointer only, palms ignored. The board filters before the engine sees anything.
- Mash policy: nothing queues, ever. Restart the same thing only after 300 ms.
- Things freeze while a finger is down and while a find question plays (DESIGN decision 7). `_advance` sets `fingerDown = finger || prompting`.
- Sleep timer: after `sleepMinutes` of play everyone yawns and sleeps. Taps then only stir, with no sound. Find rounds end and the buttons hide.
- Start audio and speech synchronously inside the gesture. iOS needs it. `tap` and `startFind` do this. iOS only lets speech start from an activation event (`pointerup`, `click`, not `pointerdown` of a touch) until one utterance has played; `main.js` primes the voice on the first `pointerup` (`audio.primeSpeech()`).
- Tokens guard every async callback (`_askToken`, `_roundToken`, mash token). An old prompt ending must never unfreeze things or repeat a question.
- No allocation in `step`. `hitTargets` allocates, so call it on taps only.
- Every reaction returns to idle within 3 s (US-5.2). Confetti lasts at most 1 s.
- Performance budget on the base iPad (A16): frame work under 2 ms with 8 things moving, tap to visible reaction in the same frame, tap to sound under 50 ms, and 0 fps when nothing moves.
- `play/hit.js` duplicates the contract of `geometry/hit.js`. Keep them in step, or merge them.

## Tests

- `web/js/play/world.test.js`: centroids, unknown presets, speed cap, ground band, edges, rests, finger pause, react, drop, wiggle, sleep, idle and `nextWakeMs`, frame-rate independence.
- `web/js/play/hit.test.js`, `mash.test.js`, `sleep.test.js`, `find.test.js`: each pure module, with fixed rng.
- `tests/unit/play-engine.test.js`: the engine with a fake audio and a MemoryRepo-backed store. Taps, sounds, confetti, 1.3x hit target, catch-up after idle.
- `web/js/play/ask.test.js`: question plans and their fallbacks.
- `tests/unit/find-it.test.js`: find games end to end. Never starts by itself, button visibility, voice fallbacks, the question before the sound (also when the device voice is not heard), random takes, colour question plus word, nudges, hints, timeouts.
- `tests/browser/animals.test.js`: eight walking things (the designed Farm) on the real `PlayEngine` and `Renderer`: over 50 fps and a small frame-work budget at 1x and 2x, then idle at 0 fps once edit mode settles.
- `tests/browser/find-games.test.js`: the 🔍 asks first in the real app; the colour round plays the recorded question then word.
- `tests/browser/`: the board in Chromium. Run with `npm test` and `npm run test:browser`.

Keep this file current: update it in the same commit as any change to this domain.
