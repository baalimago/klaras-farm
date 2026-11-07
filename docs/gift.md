# gift: wrapping paper for a page

Keep this file current: update it in the same commit as any change to this domain.

## Purpose

`web/js/gift/` is literal wrapping paper. It covers a page with a sheet of gift paper; a finger pokes in and pulls, and the paper tears along the pull in whatever direction it goes. Torn strips tumble away showing their print and white back. Once enough is gone the rest fades off with confetti and a chime, and the page underneath is free.

Klara's Farm uses it for Klara's birthday: `main.js` wraps the farm every 7 November (device local time), in the `autumn` theme. It was asked for as a separate, reusable module so the same paper can go on other gifts on other dates: **the folder imports nothing from the app** (enforced by `tests/unit/boundaries.test.js`), owns its own DOM, canvas and audio, and can be copied onto another page as is. It is therefore the one folder outside `io/`, `components/` and `main.js` allowed to touch the device.

## Files

- `wrapper.js`: the public API and the only DOM code. `wrap(options)`, `wrapOn(when, options)`, `Wrapping`; re-exports `isGiftDay`, `parseWhen`, `THEMES`.
- `state.js`: the wrapping's state machine (pure).
- `tear.js`: tear geometry and coverage (pure, `rng` injected).
- `paper.js`: paints the sheet onto any 2D context; themes; `seeded(seed)` (mulberry32).
- `calendar.js`: `parseWhen`, `isGiftDay` (pure; today is passed in).
- `sound.js`: `RipSound`, synthesized rip, pop and chime (Web Audio; no files).
- `gift.test.js`: unit tests for the pure modules. Browser tests: `tests/browser/gift.test.js`.

## Public API

```js
import { wrap, wrapOn } from "./gift/wrapper.js";
wrapOn("11-07", { theme: "autumn" });      // every 7 November; returns null on other days
wrapOn("2027-12-24", { onOpen() {} });     // one date only
const present = wrap({ theme: "starry" }); // now
await present.opened;                      // resolves when the paper is gone (opened or destroyed)
present.open(); present.destroy(); present.phase;
```

Options (all optional): `parent` (default `document.body`), `theme` (`classic`, `autumn`, `starry`, or an object laid over `classic`: `base back wash ink motif ribbon ribbonShade ribbonShine confetti`; motifs `dots leaves stars confetti stripes`), `openAt` (share torn away that opens it, default 0.25), `openAfterTears` (or this many tears, default 8), `sound` (default true), `audioContext` (a host's own), `confetti` (default true), `zIndex` (default 2147483000), `label` (aria-label), `seed`, `rng`, `onOpen`, `today` (the date `wrapOn` checks).

## State machine (`state.js`)

```
wrapped ──down (primary pointer)──▶ tearing
tearing ──cleared──▶ tearing                      share torn away grows (never shrinks, capped at 1)
tearing ──up / cancel (same pointer)──▶ wrapped   or opening, when cleared ≥ openAt or tears ≥ openAfterTears
wrapped | tearing ──open──▶ opening               Enter, Space, Escape, or the host's open()
opening ──opened──▶ open                          the paper has faded and nothing is falling
any ──destroy──▶ open
```

It opens on the lift, never mid-pull. Non-primary pointers (palms, second fingers) and other pointers' lifts change nothing. `nextWrap` returns the same object when nothing changes.

## Tearing (`tear.js`)

- Full strip half-width `tearSize(w, h)` = 8% of the short side (min 28 px): a full-width pull clears about 15%, so two or three long pulls open it.
- Down pokes a ragged hole (radius 0.55 × half-width) at once. The tear then advances in even steps of 0.3 × half-width towards the finger, so fast and slow pulls look alike. Its width ramps from 45% to full over 1.5 × the half-width of pull. Each step yields a quad and a joint blob; each piece is a `cut` (the hole) and a larger ragged `rim` (the white torn edge).
- Coverage: a 40 × 30 grid over the viewport counts cells whose centre a cut covers. It is normalized, so it survives a rotation; no pixels are read back.
- `stripOf(tear)` is the strip torn so far, flung away on lift.

## Rendering (`wrapper.js`)

- Three canvases at up to 2× device pixels: `source` (the untouched sheet, painted once per size from `seed`), `paper` (the visible sheet; each piece paints its rim `source-atop` in the theme's `back`, then cuts `destination-out`), and `fx` (falling pieces, the curl at the finger, confetti).
- Cuts happen synchronously in the pointer handler (with coalesced events), so the tear stays under the finger. `requestAnimationFrame` runs only while pieces or confetti move or the finger moves; a still finger and an idle page draw nothing.
- A resize or rotation repaints the sheet and replays every cut scaled to the new size; a pull in progress ends.
- Opening: the root gets `pointer-events: none` at once (the page takes taps while the paper fades), the paper canvas fades and grows (650 ms, Web Animations), 90 confetti fly, the chime plays; when all is still, the root is removed, canvases are shrunk to 0, `opened` resolves and `onOpen` runs. A 4 s failsafe forces the end.
- Fails open: any exception while mounting, in an input handler or in a frame removes the paper.

## Sound (`sound.js`)

`unlock()` is called synchronously in pointerdown (iPad gesture rule) and makes the context lazily (or uses `audioContext`). One rip voice at a time: looping crackly noise through a bandpass, gain and pitch following finger speed. `pop()` on each poke, `chime()` (C E G C, triangle) on opening. A context it made is closed 1.2 s after the paper is gone.

## Klara's Farm wiring

`main.js` calls `wrapBirthday(flags.wrap)` (the `Wrapping`, or null, is `window.__kfGift` for debugging) first thing in boot, before any await, so the paper is up before the farm draws. Flag `wrap`: `auto` (default; on 7 November, never in automated browsers, which have `navigator.webdriver`), `always` (`?flag=wrap:always`, for previews and tests), `never`. It shows on every app open that day; nothing is stored.
