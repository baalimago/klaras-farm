# Implementation contracts (v1)

How the first version is split into parallel work packages, and the interfaces between them. Read with `ARCHITECTURE.md` (the why), `USER_STORIES.md` (the acceptance criteria) and `sketches/ux-flows.html` (the screens). Where this file and the architecture differ on a detail, this file wins: it records what was actually built.

Already on main (do not rewrite; extend only if your package needs it and say so in your report):
- `web/js/types.js`: all shared types (Snapshot, Place, Thing, Clip, Actor, Pose, Repository, Env, Write).
- `web/js/farm/`: `palette.js`, `snapshot.js`, `intents.js`, `scripts.js` with tests.
- `web/js/farm-store.js` (FarmStore), `web/js/io/memory-repo.js`, `tests/contracts/repository.contract.js`, `tests/builders.js`.
- `web/js/main.js` (composition root), `web/js/shell.js` (mounts panels by session state), `web/js/flags.js`.
- `web/index.html`, `web/css/{tokens,parent,main}.css`, `web/sw.template.js`, `web/manifest.webmanifest`.
- `backend/` (ASGI app, archive on volume, db, migrations) and `main.py`.

## Ground rules for every package

- **Test first.** Pure modules get `*.test.js` next to them, run by `npm test` (Node's built-in runner, no dependencies). Browser behaviour gets a test in `tests/browser/<package>.test.js` using `node:test` + `require('playwright')` Chromium (no `@playwright/test`; see `tests/browser/harness.js`). Until integration the full app cannot boot (other packages are missing), so test your modules and elements with `h.modulePage(html)`: a same-origin page with the app CSS and `<base>` set, where you `import()` your modules and mount your elements with fake services. `h.newPage()` (full app boot) is for the integration phase.
- **Pure domain folders** (`farm geometry motion play edit dsp`) import only each other and `types.js`; no DOM, time, randomness, timers or device APIs. `tests/unit/boundaries.test.js` enforces this. Pass time as numbers (ms or s) and randomness as an `rng()` argument.
- **Components**: `web/js/components/<tag>/<Tag>Element.js` (the class, no side effects), `define.js` (`customElements.define` guarded by `customElements.get`), `<tag>.css` (already imported by `css/main.css`; replace the placeholder). Elements get dependencies by property: `el.services` (below) and `el.params`. Panels dispatch `new CustomEvent('kf-close', {bubbles:true})` when finished. Build DOM with `document.createElement`/`textContent` or `innerHTML` with static strings only; user text only via `textContent`. Parent UI: English, labelled controls, targets ≥ 44 px (`--tap`), reuse classes from `css/parent.css` (`kf-sheet`, `kf-btn`, `kf-field`, `kf-swatch`, `kf-steps`, `kf-tabs`, `kf-warning`).
- **The child view has no text and no buttons** (US-5.2). Anything parent-facing is mounted into `#parent-layer` by the Shell.
- **Performance** (ARCHITECTURE §7): idle board draws nothing; per frame only `drawImage` with transforms plus a few cheap strokes; no `shadowBlur`, dashes, filters or clipping per frame; no per-frame allocation in the hot loop.
- **No new runtime dependencies.** `web/vendor/fflate.js` is available (zip).
- Run `npm test` and `python -m pytest backend/tests -q` before you finish. Commit on your branch with a clear message ending with the attribution lines from your brief.

## Services object (built in `main.js`, passed to every element as `el.services`)

```js
services = {
  store,      // FarmStore: snapshot, intents (createPlace … updateSettings), drafts, getBlob, currentPlace, thingsIn
  session,    // Session (package C): state {mode, panel}, methods below, 'change' events
  engine,     // PlayEngine (package B)
  audio,      // AudioEngine (package D)
  recorder,   // Recorder (package D)
  board,      // <kf-board> element (package A): coordinate helpers, renderer
  shell,      // Shell: confirm(opts) → Promise<bool>, toast(msg, {undo}) → Promise, welcome(), updateReady()
  scripts,    // {en: {...}, sv: {...}} from web/data/scripts/*.json
  presets,    // {walk: {...}, float: {...}} from web/data/motions/*.json
  share,      // module io/share.js (package E)
  storage,    // module io/storage.js (package E)
  flags, env, appVersion, warnings, updateReady
}
```

## Package A: geometry, felt rendering, board, drawing, starter content

Files: `web/js/geometry/*.js`, `web/js/io/felt.js`, `web/js/io/renderer.js`, `web/js/components/kf-board/`, `web/js/components/kf-draw-pad/`, `web/js/io/starter.js`, `tools/make-starter.mjs`, `web/data/starter.json`.

- `geometry/stroke.js`: `simplify(points, tol)` (Ramer–Douglas–Peucker), `smooth(points, iterations)` (Chaikin), `pathLength`, `closeGap(points, {maxGapRatio=0.08})` → `{closed, points, gap: null | {a:Point, b:Point}}` (US-3.1), `polygonArea`, `centroid`, `bbox` → `{x,y,w,h}`, `pointInPolygon(pt, poly)`, `snapInside(pt, poly)` (nearest point strictly inside, for eye stamping US-3.2), `fitOutline(points, {maxW, maxH, cx, cy})` (scale a drawn outline to thing size, keep aspect), `translate(points, dx, dy)`, `toBoard(clientX, clientY, rect)`/`fromBoard` helpers for a 4:3 rect.
- `geometry/hit.js`: `hitTest(targets, pt, {scale=1.3, minRadius})` where `targets` are `{id, poly, x, y}` in drawing order; returns topmost hit id, else nearest centre among overlapping, else `null` (US-5.1: 1.3× and ≥ 120 CSS px; caller converts px to board units).
- `io/felt.js`: felt texture tile (made once), `paintBackground(ctx, place, size)` (sky, backdrop ground for meadow/sea/room/blank, clouds/sun as felt, scene pieces as felt shapes or yarn lines, stitched border), `paintThingSprite(thing, pxPerBoardUnit, dpr)` → `{canvas, ax, ay}` (anchor = outline centroid, in sprite px) with fill, texture, inset dashed stitch and soft shadow baked in. Eyes and legs are not baked (they move): legs as yarn strokes, eyes as button circles with blink.
- `io/renderer.js`: `class Renderer { constructor(canvas, {store, engine}); setSize(cssW, cssH, dpr); invalidate('background'|'sprites'|thingId); wake(); stop(); }`. Owns `requestAnimationFrame`. Each frame: `engine.step(dt)` (fixed timestep lives in the engine), draw background cache with dirty rectangles (or full blit if simpler and within budget), then actors from `engine.actors` using `actor.pose` (dx, dy, rot, sx, sy, legs, eyeOpen) and `actor.facing`. Stops the loop when `engine.isIdle()` is true and schedules `wake()` after `engine.nextWakeMs()` with `setTimeout`. Mode visuals: `engine.mode === 'edit'` → wiggle; `'scene'` → things faded, piece outlines dashed (drawn once into the cache, not per frame). Felt confetti: small fixed pool of pre-rendered pieces, ≤ 1 s, on `engine` 'reaction' events.
- `<kf-board>`: `connect(services)` creates the canvas, a 4:3 letterboxed board (CSS `aspect-ratio`), the Renderer, pointer handling and the hold recogniser hook. Pointer rules (US-5.1, US-11.1): only `isPrimary`; ignore palm (`width`/`height` > 60); `touch-action:none`; `contextmenu` prevented. On `pointerdown`: `services.audio.unlock()` synchronously, `engine.fingerDown(true)`, start the hold (`services.session.holdStart(...)`, package C). On a short tap in play: `engine.tap(x, y)` (board coords) and `session.playTap()`. In edit mode taps go to `engine.pick(x, y)` → dispatch `kf-thing-tap` with `{thingId}` (the edit layer listens). Public helpers: `boardRect()` (client rect of the 4:3 board), `toBoard(clientX, clientY)`, `toClient(x, y)`, `actorRect(thingId)` (client rect of a thing, for badges), `renderer`.
- `<kf-draw-pad>`: full-board overlay for drawing. Attributes/props: `mode = 'outline' | 'shape' | 'yarn'`, `color`. Draws the live stroke as a simple line, emits `kf-stroke` with `{points}` (board coords, simplified, smoothed; for `outline`/`shape` run `closeGap`, and if not closed emit `kf-stroke-open` with the gap ends and show both ends highlighted). Pencil and finger both work.
- `io/starter.js`: `loadStarter(env, lang)` fetches `data/starter.json` and returns a valid Snapshot with fresh ids (via `env.newId`), settings language from `navigator.language` base, `currentPlaceId` = Farm.
- `tools/make-starter.mjs` → `web/data/starter.json`: Farm (meadow; barn, fence, sun pieces; pig, cow, chicken), Sea (sea; seaweed, rocks; fish, octopus, crab — crab walks, others float), Kitchen (room; window, table; spoon, teapot, cat, chair — objects float or walk). Outlines are single closed polygons in board coords (union of ellipses/rects traced into a polygon), 2 eyes where it makes sense, `names: {en: "Pig"}` etc., no clips.
- Tests: geometry unit tests (property-style for `simplify`, `closeGap`, `pointInPolygon`, `snapInside`, `hitTest`), a starter.json validity test (`validateSnapshot`), a browser test that boots the app, sees a non-blank canvas, taps a thing and that an idle board stops requesting frames.

## Package B: motion and play

Files: `web/js/motion/*.js`, `web/data/motions/{walk,float}.json`, `web/js/play/*.js`, `web/js/play-engine.js`.

- Motion as data (ARCHITECTURE §6). `motion/blocks.js`: `travel`, `bob`, `squash`, `tilt`, `legs`, `blink` as pure functions of `(t, params)`. `motion/pose.js`: `resolveMotion(preset, params)` (dotted overrides) and `pose(resolved, t, state, out)` writing into a reusable Pose object (no allocation). Golden pose tables per preset in tests.
- `play/world.js` (pure): `createWorld(things, {rng})` → actors at their outline centroids; `step(world, dt, input, rng)` with a fixed 1/60 s timestep and accumulator; wander slowly (≤ 40 CSS px/s equivalent; board units), rest between walks, stay inside the ground band of the board, turn around at edges, blink; everything pauses while a finger is down; a reacting thing stops; `drop` state for newly added things; `wiggle` in edit mode; `sleep` when the sleep timer fires (yawn, eyes closed). `isIdle(world)` and `nextWakeMs(world)` so the renderer can stop (rest periods are long and idle).
- `play/mash.js` (pure): `decideTap(state, thingId, nowMs)` → `{action:'play'|'restart'|'ignore', stopCurrent}`; restart the playing thing only after 300 ms; a different thing stops the current clip; nothing queues.
- `play/sleep.js` (pure): sleep timer from settings (`sleepMinutes`, 0 = off).
- `play-engine.js`: `class PlayEngine extends EventTarget { constructor({store, audio, presets, rng, flags}); actors; mode; setMode('play'|'edit'|'scene'); step(dtSeconds); tap(x, y) → thingId|null; pick(x, y) → thingId|null; fingerDown(bool); isIdle(); nextWakeMs(); dropIn(thingId) }`. Listens to `store` 'change' to rebuild actors for the current place (keep positions of surviving things). `tap`: hit test (geometry/hit.js), mash policy, `react` state (jump, ≤ 3 s back to idle), `audio.playThing(clips)` with `farm/intents.tapClips` and `playLanguageFor`, chime (`audio.chime('tap')`) when there's no clip; dispatches `reaction` `{thingId, x, y}` for confetti. Usage counters are out of scope.
- Tests: pure tests for blocks, presets (golden tables), world step (fixed rng), mash policy, sleep; engine tests in Node with a fake audio and MemoryRepo-backed store.

## Package C: edit mode

Files: `web/js/edit/*.js`, `web/js/session.js`, `web/js/components/{kf-hold-ring,kf-adult-check,kf-edit-layer}/`.

- `edit/hold.js` (pure reducer, US-11.1): events `down{x,y,t,width,height,vw,vh,pointerId}`, `move`, `up`, `cancel`, `second-pointer`, `tick{t}`; phases `idle → pending (0–0.5 s, nothing shown) → showing (0.5–1.5 s, ring fills) → armed` or `cancelled`. Cancels on release, movement > 10 px, a second touch, palm, cancel; never starts in the bottom 40 px or within 20 px of the side edges. `progress` 0..1 for the ring.
- `edit/adult-check.js` (pure, US-11.2): `newChallenge(rng, kind='keypad'|'sum')` → keypad: shuffled 1–9 and a random 3-digit code (digits 1–9); sum: `a + b` with answer keys. `press(state, key, tMs)` → `{state, result:'continue'|'pass'|'fail'}`; wrong key or a tap between keys (`key=null`) fails; 10 s idle fails (`tick`).
- `edit/session.js` (pure, US-11.4): `nextSession(state, event, nowMs)`. State `{mode:'play'|'gate'|'edit'|'scene', panel:null|{name, params}, lastActivityAt, graceUntil}`. Events: `hold-armed` (play → gate, or → edit directly if within grace), `gate-pass` (→ edit), `gate-fail` (→ play), `done` (→ play, no grace), `activity`, `open-panel{name, params}`, `close-panel`, `scene-tools` (edit → scene), `scene-done` (scene → edit), `tick` (auto-close after 60 s without activity in the plain edit/scene view, paused while a panel is open; sets `graceUntil = now + 5 min`), `play-tap` (cancels grace).
- `session.js`: `class Session extends EventTarget` wrapping `nextSession` with a 1 s ticker only while in edit/scene; methods `holdArmed()`, `gatePassed()`, `gateFailed()`, `done()`, `activity()`, `openPanel(name, params)`, `closePanel()`, `sceneTools()`, `sceneDone()`, `playTap()`, `holdStart(pointerEvent, boardEl)` (drives `edit/hold.js` and the `<kf-hold-ring>` and the soft tone via `services.audio.holdTone(on)`; emits 'hold-armed'); `state`; dispatches `change`. Plays `audio.chime('enter')` / `chime('leave')`. Also a keyboard shortcut (`e` on desktop) and a visually hidden "Edit" button for VoiceOver that open the gate (US-7.6).
- `<kf-hold-ring>`: felt ring at the finger, fills with `progress`; nothing for the first 0.5 s.
- `<kf-adult-check>`: shows the code ("Tap 4 7 2") and the shuffled keypad (≥ 44 pt), silent return to play on fail/timeout; on pass → `session.gatePassed()`.
- `<kf-edit-layer>`: the bar (Scenes, Change scene, + Add, Settings, Done; + Add disabled with a reason at 4 things, US-3.5), and badges per thing (pencil → `session.openPanel('card', {thingId})`, cross → confirm delete via `services.shell.confirm` naming the recordings, then `store.deleteThing` and `shell.toast('Deleted', {undo})`). Badges are positioned with `services.board.actorRect(id)`, stay still and ≥ 44 pt. Holding an empty spot in edit mode starts + Add at that spot. Shows "Add a thing" in an empty place (US-2.5). Shows a quiet "Update ready" dot on Settings when `services.updateReady`.
- Tests: pure reducers with fake time; browser test: hold 1.5 s on the board → keypad → enter code → edit bar visible → Done → back to play; wrong key returns to play.

## Package D: audio, recording, DSP

Files: `web/js/dsp/*.js`, `web/js/io/audio.js`, `web/js/io/mic.js`, `web/js/io/wake.js`, `web/js/components/kf-recorder/`.

- `dsp/` (pure): `rms(samples)`, `dbfs(x)`, `noiseFloor(levels)`, `autoStop` reducer (noise floor from the first 300 ms, stop after ~800 ms below floor + margin once speech has been heard, 5 s cap), `trimPoints(samples, sampleRate, opts)` → `{startMs, endMs}`, `peak(samples, start, end)`, `gainFor(peak, ceilingDb=-1)` (peak normalisation, max +18 dB), `validateTake({durationMs, trimmedMs, peak})` → `ok | 'too-short' | 'silent'` (US-4.4).
- `io/audio.js`: `class AudioEngine { constructor({getBlob}); unlock(); resume(); get state; preload(clips); playThing(clips) → Promise (plays name then sound, stops anything playing); playClip(clip); stop(); chime(kind) for 'tap','enter','leave','start','stop','plink','poof','hold-done'; holdTone(on); setSessionType('playback'|'play-and-record'); }`. Master `DynamicsCompressorNode` as limiter; chimes ≥ 6 dB below voice; `navigator.audioSession.type` where supported; handles `suspended` and `interrupted`; decode cache keyed by sha with a byte budget; `decodeAudioData` gets a copy. Clips that fail to decode are reported via a `decode-failed` event `{clipId}` and the thing still chimes (US-4.5).
- `io/mic.js`: `class Recorder { constructor({audio}); async permission() → 'granted'|'denied'|'prompt'|'unsupported'; async start({onLevel}) → {stop(): Promise<Result>}; }`. `getUserMedia` with AGC, noise suppression and echo cancellation off; `MediaRecorder` without timeslice; real `mimeType` read after start; `AnalyserNode` feeding the `autoStop` reducer; tracks stopped afterwards. Result: `{ok:true, bytes, mime, sha256, durationMs, trimStartMs, trimEndMs, gainDb, cappedAt5s}` or `{ok:false, error:'denied'|'too-short'|'silent'|'failed'|'unsupported'}`. SHA-256 via `crypto.subtle.digest`, computed before any IndexedDB transaction.
- `io/wake.js`: `class WakeLock { request(); release(); }` degrading silently.
- `<kf-recorder>`: one recording slot. Props: `services`, `label` (cue text shown big), `clipRef = {thingId|null, language, kind, take}`, `existing` (clip or null). States: ready (Record) → recording (level meter, Stop always visible, start/stop blips) → saved (every take that passes the checks is kept at once: "Saved ✓", ▶ Play, Re-record; the thing hops while playing if `thingId`); errors: mic denied (plain steps to re-enable in iPad Settings, US-4.3), too short / silent → "Try again" and nothing is saved, 5 s cap note on the saved take. When a take finishes it dispatches `kf-recorded` with `{clip, blob}` where `clip` has `language, kind, take, blobSha256, mime, durationMs, trimStartMs, trimEndMs, gainDb` and `blob` is a BlobRecord. It does not write to the store itself (the parent panel decides: draft or `store.saveClip`). Old clip stays until a new take is saved; a re-record that fails or is cancelled keeps it (US-4.7).
- Tests: DSP with synthetic signals (sine bursts in noise): trim points, auto-stop timing, gain; browser test with Chromium's fake media stream (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`) that records and saves without an extra tap.

## Package E: storage, export and import, service worker

Files: `web/js/io/idb-repo.js`, `web/js/io/share.js`, `web/js/io/storage.js`, `web/js/io/sha.js`, `web/js/farm/import.js` (pure import checks), browser tests.

- `io/idb-repo.js`: `openIdbRepo({name='klaras-farm', onBlocked, onVersionChange})` → Repository (ARCHITECTURE §9.3 stores and indexes; unique index on clips `[thingId, language, kind, take]`; blobs as ArrayBuffer; one transaction per `write`, `durability:'strict'`; `onversionchange` closes; rejects with the IndexedDB `VersionError` unchanged). Must pass `tests/contracts/repository.contract.js` in Chromium (browser test).
- `io/sha.js`: `sha256Hex(arrayBuffer)`.
- `io/share.js`: `buildExport(store)` → `{file: File, name, counts}` (zip, stored not compressed: `manifest.json` = canonical snapshot from `store.exportSnapshot()`, `blobs/<sha256>`; ARCHITECTURE §9.4); `shareFile(file)` (Web Share with `canShare`, falling back to a download link only outside standalone mode); `readImport(arrayBuffer)` → `{snapshot, blobs}` after `farm/import.js` checks (schema, `minReaderFormat`, recomputed SHA-256 of every blob, every clip resolves, no duplicate keys) or throws `ImportError{code:'corrupt'|'newer'|'not-a-farm'}`; `importReplacing(store, arrayBuffer)` → writes a pre-import backup (`store.setMeta('preImport', zipBytes)`), `store.replaceAll`, returns counts; `undoImport(store)`.
- `io/storage.js`: `deviceId()` (stable, localStorage, try/catch), `requestPersist()` → bool, `estimate()`, `isStandalone()`, `deleteAllData()` (IndexedDB, Cache Storage, service worker registrations, localStorage; US-7.5), `registerServiceWorker()`, `watchForUpdates(onReady)` (a waiting worker → `onReady()`), `applyUpdate()` (post `skip-waiting`, reload on `controllerchange`).
- Tests: contract suite on IndexedDB in Chromium; export → wipe → import → byte-identical canonical snapshot and blobs; corrupt and newer files rejected with storage unchanged; delete all data leaves nothing; offline reload works after the service worker installs (browser test against the real Python server).

## Package F1: add a thing, thing card

Files: `web/js/components/kf-guided-add/`, `web/js/components/kf-thing-card/`.

- `<kf-guided-add>` (flow 1, US-3.1–3.5, 3.10, 4.1, 4.2, 4.8): steps Draw, Felt, Eyes, Moves, Name, Ask, Sound with the step bar, Back and ✕ (Keep draft / Discard) on every step; a draft saved via `store.saveDraft` after each step (resume an existing draft for this place on open); Draw uses `<kf-draw-pad mode="outline">` and `fitOutline` to thing size at `params.at` (the held spot) or a free spot; Felt shows the felt preview with `THING_COLORS` swatches; Eyes is full screen with no controls for Klara, a hold-1 s strip at the top for the parent to take over, taps snap inside, third tap moves the oldest eye; Moves: walks / floats with a live preview; Name: typed name per language (`settings.languages[0]` first) and `<kf-recorder>` for the name clip; Ask: three cue lines from `farm/scripts.js` `cueLines` with article picker and editable lines, a recorder per line (skippable); Sound: optional recorder. Finish → `store.addThing({..., clips})` (blobs saved with `store.saveClip` flow: put blobs first, see below), `store.discardDraft`, `engine.dropIn(id)`, `audio.chime('plink')`, stay in edit mode.
  - Blobs while drafting: write each kept recording's blob immediately with `store.saveDraft` carrying the clip and a separate write `{store:'blobs', op:'put', value: blob}` (use `store.repo.write([...])` through a small helper `store.putBlob(blob)` you may add to FarmStore).
- `<kf-thing-card>` (flow 2, US-3.6–3.8, 4.7, 9.1): one tab per language plus "+ Language" (adds to `settings.languages`), typed name, name clip (play / re-record), 3 questions with editable cues, sound clip; recolour (swatches), motion (walks/floats), Redraw (draw pad, keeps eyes/clips; eyes re-snapped inside), Re-stamp eyes, Delete (confirm naming the recordings, then Undo toast). Changes save immediately (`store.updateThing`, `store.saveClip`); no Save button. Flags clips that failed to decode as "re-record".
- Tests: browser tests with stubbed recorder (`services.recorder` replaced by a fake returning a fixed result) covering add-a-thing end to end, keep draft and resume, card rename/recolour/delete+undo, re-record keeps the old clip on cancel.

## Package F2: scenes, scene tools, settings, welcome, dialogs

Files: `web/js/components/{kf-scenes,kf-scene-tools,kf-settings,kf-welcome,kf-dialog}/`.

- `<kf-scenes>` (flow 4, US-2.1, 2.3, 2.4): shelf of places (felt thumbnails via `io/felt.js` `paintBackground` into a small canvas), tap to switch (`store.setCurrentPlace`), "…" for rename and delete (confirm naming things and recordings), "+ New scene": name + backdrop (meadow, sea, room, blank) + sky and ground colours → `store.createPlace` → `session.sceneTools()`.
- `<kf-scene-tools>` (flow 3, US-2.2): tool rail Shape, Yarn, Paint, Move, Delete, Undo, plus sky/ground paint and "Back to animals" (`session.sceneDone()`); uses `<kf-draw-pad mode="shape|yarn">`; Paint: tap a piece (hit test on pieces) or sky/ground, pick a colour; Move: drag a piece (translate stroke); Delete: tap then confirm; Undo: a local stack of previous `pieces` arrays applied with `store.updatePlace({patch:{pieces}})`.
- `<kf-settings>` (US-7.3, 7.4, 7.5, 8.2, 8.3, 9.1, 5.4, 11.2): languages (add/remove, which plays or "alternate"; language names via `Intl.DisplayNames`), sleep timer (off, 5, 8, 15 min), adult check kind (keypad or sum), Export (pre-built file, share sheet), Import (file input → confirm with counts → replace; Undo import until next boot), persistence status and warning when `requestPersist()` is false, storage estimate, Privacy (plain-language statement, US-7.4), Guided Access guide (one page, US-7.3), Delete all data (confirm, then `storage.deleteAllData()` and reload), "Update ready" button when `services.updateReady` (`storage.applyUpdate()`), app version.
- `<kf-welcome>` (US-1.2): one-time card: Add to Home Screen nudge (Safari, not standalone), persistent-storage request, "hold for 1.5 s to edit", co-play tip; dismissing → `store.updateSettings({patch:{welcomed:true}})` and `kf-close`. No mic request.
- `<kf-dialog>`: `confirm({title, body, confirmLabel, danger})` → Promise<bool> (modal, focus trapped, Escape cancels) and `toast(message, {undo, ms=5000})` → Promise; removes itself.
- Tests: browser tests for switching/creating/renaming/deleting places, drawing a scene piece and undo, settings export/import round trip through the UI, delete all data, welcome shows once.

## Integration (done after the packages land)

`main.js` wiring, e2e suite (`backend/tests/e2e`: real Postgres via testcontainers, temp dir volume, two app processes), full browser run, deploy to Wasmer, smoke check.
