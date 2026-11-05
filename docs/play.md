# Play

## Purpose

Play is the live board a toddler touches. Things wander, blink, jump and speak when tapped, fall asleep after a while, and run the two Find games when the child presses a find button. The world is ephemeral. It is rebuilt from the FarmStore at any time and is never saved. `PlayEngine` owns it and is the only writer.

## Files

- `web/js/play/world.js`: the pure simulation. Actors, wandering, blinking, reactions, drop-in, edit wiggle, sleep, fixed timestep, `isIdle` and `nextWakeMs`.
- `web/js/play/spread.js`: `spreadBoxes(boxes, opts)`, moves overlapping boxes apart for edit mode (below); `crowding(box, others, opts)`, the same overlap test for one box; `EDIT_SPREAD`, the edit-mode room.
- `web/js/play/placement.js`: `placeThing(thing, occupied, place)`, where a new thing lands (below); `thingBox`, `thingBoxes`, `isWalker`, `GROUND_AT`.
- `web/js/play/hit.js`: point in polygon, `hitTest` with a 1.3x outline and a minimum radius, `centroid`, `extents`, `ASPECT = 0.75`.
- `web/js/play/mash.js`: mash policy for taps (restart after 300 ms, nothing queues).
- `web/js/play/sleep.js`: the sleep timer.
- `web/js/play/find.js`: the Find games state machine (animal and colour rounds).
- `web/js/play/ask.js`: what a find question plays, in order (pure plans: `planAnimalAsk`, `planColorAsk`, `colorAskLanguage`, `recordedColorLangs`). A plan is `{ask, clue, recorded}`.
- `web/js/play/voice.js`: what the child hears for each recording slot, the one rule shared by play and the parent panels (QA round 3): `spokenName(thing, lang)`, `nameVoice(s, thing, lang, canSpeak)` (`recording`, `other-language`, `voice` or `none`), `soundVoice(s, thingId)`, `lineVoice(recordedTakes, take, canSpeak)` and `questionVoice(...)` (`recording`, `skipped`, `voice` or `none`). The thing card and the find setup show its answer on every slot, so what the card says is what plays.
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
| `release(commit = true)` | Puts it down. With `commit` it stays and the result `{thingId, dx, dy}` is how far to move its outline in the store (`geometry/transform.js` `movedThingPatch`); without, it goes back and returns null. `held` is the id being dragged or resized. Leaving edit mode drops the hold. A resize released: see `grabResize`. |
| `grabResize(thingId)` | Edit mode only: pick a thing up to resize it (held still, like `grab`). Returns `{x, y, px, py}`: its anchor and the pivot, the bottom centre of its outline (its feet), or null. `dragTo` does nothing during a resize. |
| `resizeTo(k)` | Shows the held thing `k` times its size about the pivot (the caller clamps k: `geometry/transform.js` `clampThingScale`) and fires `wake`. Number writes only, no store writes. |
| `release(commit)` after a resize | With `commit` and a size change: `{thingId, s, dx, dy}`, saved by the board as `scaledThingPatch(thing, s)` moved by `(dx, dy)` (non-zero only if the thing was off its home when picked up). Otherwise (cancel, no change, leaving edit mode) it goes back to its old size and returns null. |
| `fingerDown(bool)` | All things pause while a finger is down (US-5.3). |
| `startFind(kind)` | `'animal'` or `'color'`. Starts a round, or repeats the question if that game is already running. Call inside the press. |
| `stopFind()` | Ends a round quietly. |
| `asking`, `findRound`, `findAvailable` | Current animal target, current round `{kind, thingId, color}`, and whether the find buttons should show. |
| `dropIn(thingId)` | A newly added thing falls in. Works before or after the store's change event. |
| `isIdle()`, `nextWakeMs()` | For the renderer's 0 fps idle (below). |
| `settling` | Things are gliding apart (edit-mode spread) or dropping in. `<kf-edit-layer>` places no badges until it is false. |
| `hitMinRadius` | Board widths. The board sets it to `60 / boardWidthPx` (targets at least 120 CSS px across). |
| `actorFor(id)`, `dispose()` | Live actor lookup; removes the store listener and its occupancy. |
| `occupied(placeId)` | Where the things of the place on the board stand now (`standingBoxes`), or null for another place. The engine registers it with `store.setOccupancy`, so a new thing lands beside the animals where they are, not where they were saved. |

Events (all `CustomEvent`):

- `reaction` `{thingId, x, y, celebrate?}`: a tap reaction started. The renderer bursts confetti.
- `wake` `{}`: something started moving without a frame being requested (tap, drop, mode change, store change, finger lifted, prompt ended). The renderer calls `wake()`.
- `ask` `{kind, thingId, color, repeat, recorded}`: a find question started. `recorded` is false when nothing is recorded for that question (no prompt for the animal in any language; for the colour game, no question plus this colour's word in the language played), so the device voice or a fallback asks. `<kf-find-buttons>` then shows the grown-up its recording tip.
- `answer` `{thingId, outcome}`: a tap during a round, `correct` or `wrong`.
- `find` `{round, available}`: a round started or ended, or the buttons should show or hide. `<kf-find-buttons>` listens.
- `spread` `{moves: [{thingId, dx, dy}]}`: edit mode spread things apart; a microtask after the spread (never inside a store change). `<kf-board>` saves each move with `movedThingPatch`, like a drop.

### World (`play/world.js`)

`createWorld(things, {rng, presets, mode, reduceMotion})`, `syncWorld(world, things, rng, {drop})`, `setMode`, `react`, `dropActor`, `sleepAll`, `step(world, dt, {fingerDown}, rng)`, `isIdle`, `nextWakeMs`, `hitTargets`, `actorFor`, `spreadActors`, `takeSpreadMoves` and `isSettling` (edit-mode spread, below), `standingBoxes(world)` (each actor's spread box where it stands, or where it glides to), and for the edit drag `holdActor` (still, settled wiggle), `placeActor(world, id, x, y)` and `settleActor` (the drop point becomes home; the actor's outline moves with it so taps hit it before the store catches up; returns `[dx, dy]`), and for the edit resize `footPivot(world, id)` (the bottom centre of the actor's outline where it is), `scaleActor(world, id, k, x0, y0, px, py)` (actor `scale = k`, anchor scaled about the pivot from `(x0, y0)`) and `settleResize` (the scaled actor is home, its outline scaled so taps hit the new size; returns `{s, dx, dy}`). `scale` (1 by default) is read by the renderer: it draws the cached sprite, legs, eyes and shadow scaled about the anchor. `fitThing` resets it to 1 when the farm has a new outline for the thing, so the preview ends exactly when the resized drawing arrives; its extents stay the old ones until then, so `syncWorld` sees the size change and spreads again. Constants: `TICK = 1/60`, `GROUND_TOP = 0.55`, `GLIDE_S = 0.3`.

Actor states:

```
idle ──rest timer──▶ moving ──arrived──▶ idle
  any ──tap──▶ react (1 s jump) ──▶ idle
  new / place switched ──▶ drop (0.7 s, staggered 0.12 s) ──▶ idle | wiggle | sleep
  setMode('edit') ──▶ wiggle (decays over 2 s, then still); overlapping things glide apart (0.3 s)
  edit: grab ──▶ wiggle, settled (held still, follows dragTo) ──release──▶ same, home = drop point
  edit: grabResize ──▶ wiggle, settled (scale follows resizeTo, feet still) ──release──▶ home = scaled anchor, scale 1 once the farm has the new outline
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

- When: entering edit mode (`setMode('edit')`), and when `syncWorld` in edit mode adds things (a new thing, an undone delete, a place switched to) or a thing's extents change (the resize handle, Redraw). Never in play or scene mode. A thing a parent drops onto another stays there: the parent chose the spot; the next edit session spreads it.
- `spreadBoxes(boxes, {gap, padTop, minHalfWidth, margin, obstacles})` works in board widths on both axes. A box may carry a `floor`, the highest its anchor may be moved to: the world gives each walker (travel mode `ground` or `hop`) `GROUND_TOP - ext.bottom`, so a spread never lifts its feet out of the ground band (a box already above it may stay, as at an edge). `crowding(box, others, opts)` is the overlap of one box where it stands, 0 exactly when the spread leaves it there. A box that overlaps nothing (boxes or obstacles) keeps its exact position. The others are placed one by one in drawing order: each keeps its spot if free, else takes the nearest free spot flush beside a placed box or obstacle (or a board edge), clamped onto the board; if nothing is free, the spot with the least overlap. Greedy placement instead of pairwise pushes, because pushes jam when a row is wider than the board. Deterministic; about n³ candidate checks for n ≤ 12, once per spread.
- Settings (`EDIT_SPREAD` in `spread.js`, used by the world and by placement): gap 0.015, `padTop` 0.03 (the 52 px badges sit centred on each thing's top edge), `minHalfWidth` 0.055 (pencil and cross sit at most 70 px each side of the top centre), margin 0.01, and the edit bar as an obstacle (x 0.24 to 0.76, y from 0.9). A thing with legs counts `farm/legs.js` `LEG_MAX` below its outline. A moved box never goes further past an edge than it already was.
- Each moved actor glides over `GLIDE_S` (smoothstep, `glideT`, from `gx, gy` to `tx, ty`) and is marked `spreadPending`. `isIdle` is false while gliding. Picking a thing up (`holdActor`, `placeActor`) stops its glide under the finger and drops its pending move (its drop saves it); leaving edit mode finishes a glide at once.
- Saved, so it sticks: `PlayEngine` calls `takeSpreadMoves` a microtask later and sends the `spread` event. Like `settleActor`, the glide target becomes the actor's home and its outline moves with it. When the store catches up (new home = glide target) `syncWorld` lets the glide carry on; any other store change finishes it first and keeps the offset.

### Placing a new thing (`play/placement.js`)

One rule for a library copy (`copyThing`), the animals seeding a new scene (`createPlace` with `seed`) and an animal drawn in guided add (`addThing` with `spot: "free"`). QA round 3 review: each used the farm's saved positions while the animals had wandered, so the edit-mode spread pushed the newcomer into the sky.

- `placeThing(thing, occupied, place)` returns `{dx, dy}` (3 decimals). `occupied` is where the scene's things stand: `PlayEngine.occupied(placeId)` (live actors via `standingBoxes`, legs included) for the place on the board, which `FarmStore` asks through `setOccupancy`; else `thingBoxes(s, placeId)`, the saved positions.
- Candidates: 13 columns (nearest the middle first) by 15 rows. Rows put the outline's bottom from 0.05 below the backdrop's `GROUND_AT` (meadow 0.6, sea 0.55, room 0.68, blank 0.82; never above `GROUND_TOP`) down to where the legs' tips reach the board's margin. A spot counts only if `crowding` with `EDIT_SPREAD` (plus 0.002 for rounding) is 0, so the spread leaves it there. The free spot farthest from the others wins; ties to the middle, then the lowest.
- A walker (`isWalker`: every motion but `float` and `swim`) stays on the walking ground: the band first, then rows up to feet at `GROUND_TOP`; when all of it is full it takes the ground spot that overlaps least, and the spread's `floor` keeps it there. A floater tries the same rows, then rows above them.
- `thingBox(thing)`: the thing's spread box where it is saved (centroid anchor, extents, `LEG_MAX` below when it has legs, a `floor` for walkers), as the world boxes an actor.

## Idle rules (0 fps)

- `engine.isIdle()` is true when no actor reacts, drops, wiggles, settles into sleep, stirs, walks or blinks, and no hint glow shows.
- `engine.nextWakeMs()` is the soonest of: the next wander or blink, the sleep timer, a find nudge or timeout (play only). Infinity when nothing is scheduled.
- `io/renderer.js` stops `requestAnimationFrame` when idle and sets one `setTimeout(nextWakeMs)`. A `wake` event restarts it.
- Every outside call (`tap`, `setMode`, `fingerDown`, `startFind`, store change) first runs `_catchUp()` to account for the idle gap.

## Audio during play

- A tap plays the thing's name then its sound (`farm/intents.tapClips`; `_sayThing`, shared with a correct answer). No recorded name: a chime, then the device voice says the typed name (`play/voice.js` `spokenName`), then the recorded sound if there is one.
- A thing has one sound for every language (`farm/intents.soundClip`, the newest sound clip). Before QA round 3 the sound was per language and a tap played the play language's take, so a sound re-recorded on another language tab never played ("I don't know what the animals say anymore").
- Language: fixed, or with "mix" (`playLanguage: "alternate"`) a random language among those recorded for that thing, per tap (`playLanguageFor` with the injected rng).
- Animal question: the parent's recorded prompt in the play language (a random take among the recorded lines; unrecorded lines are skipped), else a cue line in the device voice, else a prompt recorded in another language, else the recorded name; only then the thing's sound as a clue (`play/ask.js`). Colour question: the recorded colour question then the recorded colour word (`audio.playSequence`), else "Tap on an animal that is yellow!" in the device voice, else a chime.
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

- `web/js/play/world.test.js`: centroids, unknown presets, speed cap, ground band, edges, rests, finger pause, react, drop, wiggle, sleep, idle and `nextWakeMs`, frame-rate independence, the edit-mode spread keeping walkers in the ground band.
- `web/js/play/spread.test.js` and `placement.test.js`: the spread (with `floor`, `crowding`), and where a new thing lands: on the ground, clear of the live boxes, never moved by the spread, a floater up only when the ground is full.
- `tests/unit/play-engine.test.js` "a library copy lands beside the animals where they stand now": a wandered animal on the saved free spot; the copy lands elsewhere and nothing glides.
- `web/js/play/hit.test.js`, `mash.test.js`, `sleep.test.js`, `find.test.js`: each pure module, with fixed rng.
- `tests/unit/play-engine.test.js`: the engine with a fake audio and a MemoryRepo-backed store. Taps, sounds, confetti, 1.3x hit target, catch-up after idle.
- `web/js/play/ask.test.js`: question plans and their fallbacks.
- `web/js/play/voice.test.js`: what each slot says plays. `tests/unit/find-it.test.js` "QA round 3" checks the engine plays exactly that: a sound re-recorded on another tab, a sound without a recorded name, a language without recorded questions.
- `tests/unit/find-it.test.js`: find games end to end. Never starts by itself, button visibility, voice fallbacks, the question before the sound (also when the device voice is not heard), random takes, colour question plus word, nudges, hints, timeouts.
- `tests/browser/animals.test.js`: eight walking things (the designed Farm) on the real `PlayEngine` and `Renderer`: over 50 fps and a small frame-work budget at 1x and 2x, then idle at 0 fps once edit mode settles.
- `tests/browser/find-games.test.js`: the 🔍 asks first in the real app; the colour round plays the recorded question then word.
- `tests/browser/`: the board in Chromium. Run with `npm test` and `npm run test:browser`.

Keep this file current: update it in the same commit as any change to this domain.
