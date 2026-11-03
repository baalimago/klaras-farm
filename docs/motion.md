# Motion

## Purpose

Motion is data. A small set of pure building blocks turns time and parameters into a pose. Presets in `web/data/motions/*.json` are the data for those blocks. A thing picks a preset and may override single numbers. Motion never changes a thing's drawing. It only produces a transform that the renderer applies to a cached sprite.

## Files

- `web/js/motion/blocks.js`: the building blocks (`travel`, `bob`, `squash`, `tilt`, `legs`, `blink`) and the reaction overlays (`jump`, `drop`, `wiggle`, `yawn` and friends) with their durations.
- `web/js/motion/pose.js`: `resolveMotion` (preset plus dotted overrides), `newPose`, `restPose`, `pose` (writes a resolved motion at time t into a reusable Pose), and the `STILL` fallback preset.
- `web/data/motions/walk.json`: ground walker with leg swing, bounce bob, squash and a little tilt.
- `web/data/motions/float.json`: water floater, slow sine bob, tilt, no legs.
- `web/data/motions/hop.json`: hopper, leaves the ground once per step.
- `web/data/motions/swim.json`: faster water mover.
- `web/data/motions/scuttle.json`: fast ground walker with quick leg swing.
- `web/js/motion/blocks.test.js`, `web/js/motion/pose.test.js`: unit tests and golden pose tables.

## Units

Shared by every block and preset.

- `t`: seconds of motion time.
- `speed`: fraction 0..1 of `MAX_SPEED`.
- `amp`, `height`: board units. Vertical offsets are a fraction of board height. Negative dy is up.
- `rate`: steps or cycles per second.
- Angles (`swing`, tilt `amp`): radians.
- `squash` returns `s`. The renderer uses `sx = 1 + s`, `sy = 1 - s`.
- A missing parameter means no motion. The block returns its rest value.

## Public API

### Blocks (`blocks.js`)

| Export | What it returns |
|---|---|
| `MAX_SPEED = 0.029` | Board widths per second. 40 CSS px/s on a 1366 px board (US-5.3 cap). |
| `travelSpeed(p)` | Ground speed in board widths per second, `speed` clamped to 0..1. |
| `travel(t, p)` | Vertical offset from the way of travelling. Only `mode: "hop"` leaves the ground. `ground` and `water` return 0. |
| `bob(t, p)` | `shape: "bounce"`: up only, one bounce per step. `shape: "sine"`: gentle up and down. |
| `squash(t, p)` | Widest on contact (`t = k / rate`), tallest mid-step. |
| `tilt(t, p)` | Body rotation in radians. |
| `legs(t, p, i)` | Swing of leg i. Neighbours swing opposite. |
| `blink(tb, p)` | Eye openness 0..1. `tb` is seconds since the blink started, negative means no blink. Default duration 0.18 s. |

Reaction overlays, used by `play/world.js` on top of the base pose:

| Export | Meaning |
|---|---|
| `REACT_S = 1.0` | Tap reaction length. US-5.2: every reaction is back to idle within 3 s. |
| `jump(t)`, `jumpStretch(t)` | Two hops, the second lower, tall in the air. |
| `jumpSpin(t)` | Extra decaying spin for water things when tapped. |
| `DROP_S = 0.7`, `drop(t)`, `dropStretch(t)` | A new thing falls in from above and lands with a squash. |
| `WIGGLE_S = 2`, `wiggle(t, amp, rate, duration)` | Edit-mode wiggle that decays to still, so the board can idle while a parent edits. |
| `YAWN_S = 1.6`, `SLEEP_SETTLE_S = 2.2`, `yawn(t, out)` | Sleep: yawn, eyes close, then a still slumped pose. Writes `sx`, `sy`, `eyeOpen`. |

### Poses (`pose.js`)

- `STILL`: frozen preset used when a thing names a preset that is not loaded. Stands still and blinks.
- `resolveMotion(preset, params)`: deep copy of the preset with dotted overrides applied (`"travel.speed": 0.8`). Only finite numbers override. Keys must be exactly `block.field`. `__proto__` keys are ignored. Never mutates the preset.
- `newPose(nLegs)`: `{dx, dy, rot, sx, sy, legs[], eyeOpen}` at rest.
- `restPose(out, nLegs)`: puts a pose at rest and resizes its legs array in place.
- `pose(resolved, t, {move, blinkT}, out)`: writes the pose at time t into `out`. `move` (0..1) scales every motion so walks ramp in and out without pops. Writes one angle per entry of `out.legs`. Returns `out`.

### Preset format

```json
{ "id": "walk", "version": 1,
  "travel": { "mode": "ground", "speed": 0.7, "restMin": 4, "restMax": 10,
              "distMin": 0.08, "distMax": 0.22, "rangeY": 0.03 },
  "bob": { "shape": "bounce", "amp": 0.006, "rate": 1.6 },
  "squash": { "amp": 0.06, "rate": 1.6 },
  "tilt": { "amp": 0.02, "rate": 0.8 },
  "legs": { "swing": 0.45, "rate": 1.6 },
  "blink": { "duration": 0.18, "intervalMin": 2.5, "intervalMax": 6 } }
```

- `travel.mode`: `ground`, `water` or `hop`. `ground` and `hop` keep the feet in the ground band (see `docs/play.md`).
- `travel.restMin/restMax`: seconds of rest between walks. `distMin/distMax`: walk length in board widths. `rangeY`: how far up or down from home a walk may go. `height`, `rate`: hop only.
- `blink.intervalMin/intervalMax`: seconds between blinks. The world never blinks more often than every 2 s.
- A thing stores `motion: {kind: "preset", preset: "walk", params: {"travel.speed": 0.8}}`. `kind` defaults to `"preset"`.

### Legs

How many legs a thing has comes from the thing (`Thing.legs`, 0 to 8 hips placed by the parent). It never comes from the preset. The caller sizes `pose.legs` to `thing.legs.length`. The preset's `legs` block only says how they swing. Old files (format 2, no `Thing.legs`) get their preset's legs once, on migrate, in `farm/legs.js`.

## State machines

None. Every function here is a pure function of time and parameters. State (motion time, `move`, blink timers, which overlay runs) lives in the play world.

## How it fits

- `play/world.js` is the only caller. It resolves each thing's preset in `fitThing`, calls `pose()` for idle and moving actors, and uses the overlays for react, drop, wiggle and sleep.
- `main.js` loads presets with `loadJsonMap("data/motions/", ["walk", "float"])` and passes them to the `PlayEngine`.
- `io/renderer.js` reads `actor.pose` and applies it to the cached sprite with `setTransform`, `rotate` and `scale`. Leg angles drive the yarn legs.
- Guided add and the thing card offer only Walks and Floats.
- `motion/` is a pure domain. It imports only other pure domains and `types.js`. No DOM, no time, no randomness: time is passed in as `t`. `tests/unit/boundaries.test.js` enforces this.

## Rules and gotchas

- No allocation on the hot path. `pose()` writes into a reusable Pose and keeps the same legs array. Do not return new objects from blocks.
- Every reaction ends. Overlays return 0 after their duration, and wiggle and yawn settle to a still pose. That is what lets the world report idle and the renderer drop to 0 fps.
- Keep the speed cap. Wander speed is at most `MAX_SPEED`. Reduce motion halves it in the world (`speedFactor`), not here.
- Tuning a preset or a block changes the golden pose tables. That diff is the review. Update the table in the same commit.
- Only `walk` and `float` are loaded at boot. `hop`, `swim` and `scuttle` ship and have golden tables, but a thing that names them stands still (`STILL`) until `main.js` loads them.
- The renderer draws a ground contact shadow only for `preset === "walk"`. That check lives in `io/renderer.js`, not here.
- Performance budget on the base iPad (A16): under 2 ms of frame work with 4 things moving. Blocks are a few `sin` calls each. Keep them that way.

## Tests

- `web/js/motion/blocks.test.js`: speed cap and clamping, each block's shape (hop leaves the ground once per step, bounce is up only, squash phase, leg alternation, blink), reactions end within their durations.
- `web/js/motion/pose.test.js`: `resolveMotion` overrides, bad keys and prototype keys ignored, missing preset gives `STILL`, `pose` reuses its object, and golden pose tables for walk, float, hop, swim and scuttle at fixed times.
- `web/js/play/world.test.js`: unknown presets stand still instead of failing.
- `tests/browser/legs.test.js`: legs from `Thing.legs` survive a reload and are drawn; format 2 things get their preset's legs.
- Run with `npm test`.

Keep this file current: update it in the same commit as any change to this domain.
