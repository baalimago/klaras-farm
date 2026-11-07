# io: device adapters

Keep this file current: update it in the same commit as any change to this domain.

## Purpose

`web/js/io/` is where the app meets the device: IndexedDB, Web Audio, the microphone, canvas painting, the share sheet, storage and the service worker, the wake lock, hashing and error reporting. Each module wraps one device API behind a small class or function set, so the pure domains and the state owners never see a browser global. Everything here degrades quietly when the API is missing or refused.

## Files

- `idb-repo.js`: `openIdbRepo()` and `IdbRepo`, the IndexedDB Repository; `closeAllConnections()`.
- `memory-repo.js`: `MemoryRepo`, the in-memory Repository (tests, and fallback when IndexedDB is unavailable). Its clip uniqueness uses `clipKey`, so colour game clips (`thingId` null) are unique too, and a clip put under a new key (a renumbered take) frees its old key.
- `audio.js`: `AudioEngine` (one AudioContext for voices, chimes and music), device TTS, chime synthesis.
- `mic.js`: `Recorder`, one take from the microphone with live level, auto-stop and analysis.
- `music.js`: `MusicPlayer`, schedules the generated lullaby on the music bus; `renderMusic()`.
- `renderer.js`: `Renderer`, owns `requestAnimationFrame` and draws the board.
- `felt.js`: the felt painter: texture, backgrounds, thing sprites, eye, shadow and confetti sprites.
- `share.js`: export zip, share sheet, import with backup, verify and undo.
- `storage.js`: device id, persistence, estimates, Delete all data, service worker registration and updates.
- `starter.js`: turns `web/data/starter.json` into a fresh Snapshot.
- `wake.js`: `WakeLock`, keeps the screen on while playing (US-1.4).
- `prefs.js`: `Prefs`, the grown-up's device preferences outside the farm (like the music switch): `recordingTips` ("Show recording tips", on unless `localStorage` key `kf.recordingTips` is `off`). Setting it saves at once and fires `change`; a blocked `localStorage` keeps the choice for this page only. Not in the snapshot, so not in exports, and no data format change.
- `device.js`: which device the app runs on and the words the parent UI uses for it. `detectKind(nav)` is `ipad` (also iPadOS reporting itself as a Mac, told apart by `maxTouchPoints > 1`), `iphone` or `other`; `isSafari(nav)` is Safari or any iOS browser (the Home Screen nudge and Apple-only steps use `ios`, since a Mac has no Home Screen); `deviceFor(nav)` gives `{kind, name, voice, ios, safari}` with name iPad / iPhone / device and voice iPad voice / iPhone voice / built-in voice; `device()` reads the real navigator once per page; `capital(s)` for sentence starts. The iPad is the main target, but no copy names it unless this says so.
- `sha.js`: `sha256Hex(data)` with `crypto.subtle`.
- `report.js`: sends uncaught errors to `POST /api/client-log`. Installed by `web/js/report-boot.js`.

## Public API / contracts

### Repository port (`idb-repo.js`, `memory-repo.js`)

- `load()` returns `{places, things, clips, settings|null, meta}`.
- `write(writes)`: a batch of `{store, op: 'put'|'delete', value|key}`. All or nothing. Stores: `places things clips blobs drafts meta settings`.
- `getBlob(sha256)` returns a `BlobRecord` or null. `listBlobShas()`, `listDrafts()`.
- `replaceAll(snapshot, blobs)`: one transaction replaces places, things, clips, blobs and settings; meta and drafts stay.
- `sweepOrphanBlobs(olderThanIso)`: deletes old blobs no clip or draft references; returns the count.
- `clear()`. `failOn(writes, n)` is a test hook that injects a failure on the nth write.
- Clips are unique on `[thingId, language, kind, take]`. A batch that breaks this rejects and applies nothing; delete then put in one batch is allowed.
- Both implementations must pass `tests/contracts/repository.contract.js`.
- IndexedDB rules: database `klaras-farm` version 4 (`DB_VERSION`; versions 2, 3 and 4 have no schema change: each only makes the app of the previous format (3, then 4, then 5; version 4 for format 6's `find-question` clips) stop with VersionError and "update needed" instead of misreading the newer records as corrupt). The clip `key` index skips colour game clips (null `thingId`), so `saveClip` and validation enforce their uniqueness. Hashing and `blob.arrayBuffer()` happen before a transaction opens. One transaction per call; readwrite ones use `durability: 'strict'` and resolve only on `complete`. Blobs are stored as `ArrayBuffer`, never `Blob`. `onversionchange` closes the connection. `openIdbRepo` rejects with IndexedDB's own error (`VersionError` unchanged). Store names, keys and the clip index are one-way doors; upgrades are additive only.

### AudioEngine (`audio.js`)

```
clip source -> clip gain (trim fades, gainDb) -> voice bus ─┐
synth notes -> chime bus (-8 dB) ───────────────────────────┼-> limiter -> output -> speakers
music notes -> music bus (faded by MusicPlayer) -> duck ────┘
```

- `new AudioEngine({getBlob, budgetBytes?, AudioContextClass?})`. The context is created on first use.
- `unlock()`: create, resume and prime the output. Call it synchronously in a gesture handler. `resume()` after visibility changes.
- `state`: `'unsupported' | 'locked' | 'running' | 'suspended' | 'interrupted' | 'closed'`.
- `setSessionType('playback' | 'play-and-record')` sets `navigator.audioSession.type` where supported.
- `preload(clips)`, `playThing(clips)` (name then sound, stops anything playing, resolves true when all played), `playSequence(clips)` (the same without the failure chime: the colour game's question then colour word; all clips decode up front so the second follows the first without a gap), `playClip(clip, {bytes?})`, `stop()`.
- `speak(text, lang)`: device text-to-speech fallback while there is no recording. Call it synchronously inside the gesture. Resolves `true` only when the voice started and finished, `false` when it was not heard: an idle synthesiser is never cancelled first (cancel then speak in one tick drops the utterance on WebKit); an utterance that ends or errors without starting is tried once more after `SPEECH_RETRY_MS` (120 ms); one that has not started after `SPEECH_START_MS` (2.5 s, option `speechStartMs`) is cancelled and counts as not heard. Voices come from `getVoices()`, refreshed on `voiceschanged` (empty at first on iOS), picked with `pickVoice`. Never rejects.
- `stopSpeaking()`: pending `speak()` calls resolve `false`, without a retry. `primeSpeech()`: once, in an activation event (`pointerup`), a silent utterance that unlocks iOS speech for later questions; skipped when something already spoke. `canSpeak`.
- `chime(kind)` returns its length in seconds, or 0 when skipped: an editing sound (`EDIT_CHIMES`) of the same kind again within `CHIME_REPEAT_S` (40 ms, `performance.now`) plays once (mash-safe); the child's chimes are never skipped here. Any kind in `dsp/chimes.js` `CHIMES`, including the editing family. Components play edit sounds through `components/kf-dialog/feedback.js` `editSound`. `holdTone(on)`.
- `musicBus` (null before the context exists). `talking` is true while a clip or speech plays; the duck dips to `MUSIC_DUCK_DB` in 0.12 s and comes back over 0.9 s.
- `decode(arrayBuffer)` decodes a copy. `isBroken(clip)` after a decode failure (US-4.5).
- Decoded buffers are cached by SHA-256 in an LRU with a 24 MB budget; concurrent loads share one decode.
- Events: `clip-start {clipId, offsetS, durationS, gainDb}`, `clip-end {clipId}`, `chime {kind}`, `speak {text, lang}`, `decode-failed {clipId, sha256, reason}`, `statechange {state}`.
- Exports for tests and music: `synthNotes(ctx, dest, notes, when)`, `synthChime`, `renderChime(kind)` (offline), `pickVoice(voices, lang)`.

### Recorder (`mic.js`)

- `new Recorder({audio, mediaDevices?, MediaRecorderClass?})`. `supported`, `permission()` (never prompts).
- `start({onLevel})` resolves to a handle `{stop(), cancel(), done}` once recording has begun or failed.
- It unlocks audio, switches to `play-and-record`, opens the mic with AGC, noise suppression and echo cancellation off, plays the start blip and waits for it so it is not recorded, then runs `MediaRecorder` without a timeslice.
- An `AnalyserNode` is polled every 30 ms for the meter and `dsp/autostop.js`. A timer backs up the 5 s cap.
- Result: `{ok: true, bytes, mime, sha256, durationMs, trimStartMs, trimEndMs, gainDb, cappedAt5s}` or `{ok: false, error: 'denied'|'too-short'|'silent'|'failed'|'unsupported'|'cancelled'}`.
- Bytes are never modified. The take is decoded once for `analyseTake`. SHA-256 is computed before any storage transaction.

### MusicPlayer (`music.js`)

- `new MusicPlayer({audio, shouldPlay, storage?, seed?})`. `update()` starts or stops to match `enabled && shouldPlay() && audio.state === 'running'`.
- `main.js` calls `update()` on session changes, visibility changes, audio state changes and every `pointerup`.
- One timer per bar schedules the next bar about a bar ahead on the AudioContext clock. The renderer can stay idle while music plays.
- `enabled` is a device preference in `localStorage` key `kf.music`, not part of the farm.

### Renderer (`renderer.js`) and felt painter (`felt.js`)

- `new Renderer(canvas, {store, engine})`, `setSize(cssW, cssH, dpr)`, `invalidate('background'|'sprites'|thingId)`, `wake()`, `stop()`, `destroy()`, `burst(x, y)`, `actorBounds(thingId)`, `setLift(lift)`, `running`, `frames`, `pieceSprites`, `lift`.
- The Renderer is the only owner of `requestAnimationFrame`. Each frame: `engine.step(dt)`, one background blit, in scene mode one `drawImage` per scene piece, then per actor a contact shadow, yarn legs, one sprite `drawImage` and button eyes, plus felt confetti from a fixed pool of 24.
- Scene mode: the background is painted without pieces (`paintBackground(..., {pieces: false})`) and each piece is a cached sprite (`paintPieceSprite`, dashed outline baked in). `setLift({id, dx, dy, s, cx, cy})` (board units) draws that piece moved and scaled about (cx, cy) until `setLift(null)`; it only writes numbers and requests a frame, so the scene tools call it on every pointermove. A piece change does not repaint the background (the key is place id, backdrop, sky and ground); only a recoloured, reshaped or resized piece gets a new sprite. Leaving scene mode repaints the background once with the pieces baked in.
- Moves keep sprites: when a thing's or piece's new geometry is a pure translation of the old (`geometry/transform.js` `translationBetween`, within the store's 3-decimal rounding) and the colour is the same, the old felt sprite is reused at the new place. A drag therefore costs no felt painting at all, during or after.
- When `engine.isIdle()` and no confetti is alive, the loop stops (0 fps). It schedules a `setTimeout` for `engine.nextWakeMs()` and wakes on engine `wake`, `mode`, `change` and store `change` events.
- Contact shadow: only for things whose preset is grounded (`motion/pose.js` `isGrounded`, the preset's `ground` flag), looked up in `engine.presets` when the sprite is built. Walk, hop and scuttle get one; float and swim do not. An engine without presets draws no shadows.
- Sprites are cached per thing in `entries`. Snapshots are immutable, so a changed thing is a new object and its sprite is rebuilt. Background is repainted only when the place or scene mode changes.
- `felt.js` does all slow work once: felt tile, `paintBackground(c, place, size, {scene, border, pieces})`, `paintPieceSprite(piece, W, H, {scene})` returning `{canvas, ox, oy}`, `paintThingSprite(thing, pxPerBoardUnit, dpr)` returning `{canvas, ax, ay, ox, oy}`, `eyeSprite`, `groundShadowSprite`, `glowSprite`, `confettiSprites`. `releaseCanvas` zeroes canvases because iOS caps canvas memory.

### Share, storage, starter, wake, sha, report

- `share.js`: `buildExport(store)` returns `{file, name, bytes, counts}`. `shareFile(file)` returns `'shared'|'cancelled'|'downloaded'|'unsupported'`. `readImport(buffer)` writes nothing and throws `ImportError`. `importReplacing(store, buffer)` stores a backup in meta `preImport`, replaces, verifies by reading back, and restores on a mismatch. `canUndoImport`, `undoImport`, `discardImportBackup`.
- Zip layout: `manifest.json` (canonical snapshot) and `blobs/<sha256>`, stored not compressed (vendored `fflate`).
- `storage.js`: `deviceId()`, `requestPersist()`, `isPersisted()`, `estimate()`, `isStandalone()`, `deleteAllData()` returning `{blocked}`, `registerServiceWorker()` for `/sw.js`, `watchForUpdates(onReady)`, `applyUpdate()` (posts `skip-waiting`, reloads on `controllerchange`).
- `starter.js`: `starterSnapshot(template, env, lang, appVersion)` gives fresh ids and timestamps; `loadStarter(env, lang)` fetches `data/starter.json`; `baseLanguage(tag)`.
- `web/data/starter.json` and `web/data/library.json` come from `tools/make-starter.mjs` (`--check` says when either is stale). `library.json` is `{version: 1, examples: Thing[]}`, the animal library's pre-made examples: every starter thing exactly as drawn in its scene (all eight per scene, so the bunny too), then nine library-only animals (fox, frog, bird, turtle, snail, elephant, hedgehog, whale, owl), each moved to stand centred with its body ending at y 0.9. Ids `example-<kind>`, `placeId` `library`, no cues, no clips. Every species has en, sv, fi, de, fr and es names. It is static data, not a snapshot: no format version applies; copies made from it are ordinary things. Scenes as designed: Farm with eight animals (pig, cow, chicken, sheep, horse, duck, dog, bunny), Sea (fish, octopus, crab), Kitchen (teapot, cat, chair, spoon, mouse, spider). Every thing has its real number of legs (chicken and duck 2, crab and spider 8, chair 4, fish 0), sizes vary, and things stand apart so each keeps a 120 px tap target. Each scene keeps its first `STARTER_MAX = min(8, DEFAULT_MAX_THINGS - 1)` things (seven), best spread first, so a fresh scene with the default of 8 things per scene always has room for the parent's first own thing. The Farm has seven animals on day one; the bunny is left out.
- `wake.js`: `request()` and `release()`, never throw. The browser drops the lock when hidden; `main.js` requests again on `visibilitychange`.
- `report.js`: `report(kind, detail)` (at most 8 per page load, text only, no farm data, `sendBeacon` then `fetch`), `installErrorReporting(win)` hooks `error`, `unhandledrejection` and `console.error`.

## How it fits

- Imports: `dsp/` (audio math), `farm/` (palette, legs, snapshot, import checks), `geometry/stroke.js`, `vendor/fflate.js`, and other `io/` modules.
- Wired up in `web/js/main.js`, the composition root. `FarmStore` gets a Repository; `PlayEngine` gets the `AudioEngine`; `<kf-board>` creates the `Renderer`; parent panels get everything through `services`.
- `tests/unit/boundaries.test.js` enforces that only `io/`, `components/` and `main.js` read IndexedDB, create an `AudioContext` or call `getUserMedia`.
- `report-boot.js` loads before `main.js` as its own module, so a module that fails to parse on the device is still reported.

## Rules and gotchas

- iOS audio: `unlock()` must run synchronously inside `pointerdown` or `pointerup`. The first unlock plays a one-sample buffer to open the output. `speak()` must also start inside the gesture, and the first utterance of a page only plays from an activation event (`pointerup`, `click`), which is why the find buttons start on `pointerup` and `main.js` calls `primeSpeech()` on the first `pointerup`.
- Root cause of the silent "Where is the …?" (playtest round 3): the find button started the device voice on `pointerdown`, which is not a user activation for touch, so iOS dropped the utterance without any event; `speak()` then resolved `true` from its safety timeout and the engine played the animal's sound as if the question had been asked. The engine's `stop()` before asking also cancelled an idle synthesiser right before speaking. Fixed by starting on `pointerup`, priming speech, not cancelling an idle synthesiser, the heard/not-heard result with a retry, and the engine falling back to a recorded clip when the voice is not heard.
- WebKit `interrupted` and unexpected `suspended` states: the engine tries to resume when visible; otherwise the next tap's `unlock()` does it.
- Use `playback` while playing so the mute switch does not silence voices. Use `play-and-record` only while recording, and always switch back.
- Never `await` device promises (`storage.persist()`, permission queries) before closing UI after a gesture. They can hang on iPad.
- Build the export when the screen opens, so `navigator.share` still runs inside the tap. The download fallback is skipped in standalone mode, where `<a download>` can navigate away.
- No per-frame allocation, `shadowBlur`, dashes, filters or clipping in the Renderer. Put slow work in `felt.js` caches.
- `decodeAudioData` gets a copy: it detaches its input.
- Offline: the service worker precaches every hashed asset (see `docs/components.md` for `sw.template.js`). A new version waits until the next cold launch or "Update ready".

## Tests

- Unit (Node, `npm test`): `io/share.test.js`, `io/prefs.test.js` (on by default, remembered, blocked storage), `io/library-data.test.js` (`library.json` is current, the starter things plus at least six more, names in en/sv/fi and the rest, palette colours, shipped motions, eyes and hips inside, real leg counts, an untouched starter folds into its example), `io/starter.test.js` (the file is current; the full eight-thing scenes have real leg counts, hips inside the body, no overlaps, 120 px tap spacing and varied sizes), `tests/unit/memory-repo.test.js` (runs the contract on `MemoryRepo`), `tests/unit/wake.test.js`, `tests/unit/audio-speech.test.js` (speech with a fake synthesiser), `tests/unit/audio-play.test.js` (a fake AudioContext: the colour question then word in order, failures without a chime, stop mid-sequence, the editing-sound mash guard), `tests/unit/export-fixture.test.js` (the golden export must import forever; never regenerate it).
- Browser (`npm run test:browser`, Playwright Chromium against the real Python app):
  - `package-a.test.js`: felt rendering, idle loop at 0 fps, pointer rules, letterboxing.
  - `drag.test.js`: frame cost while dragging a thing (edit) and a piece (scene) at dpr 2, exact tracking, no background repaint, sprites reused after a move.
  - `package-d.test.js`: AudioEngine, chime levels, decode failures, Recorder with a fake mic (`setup({fakeMedia: true})`).
  - `package-e.test.js`: the Repository contract on IndexedDB, export, wipe and import, rejected imports, Delete all data, offline after the service worker installs.
  - `music.test.js`: lullaby level, fades, ducking, off switch.
- Harness quirks: `modulePage(html)` gives a same-origin page with `<base>` and app CSS without booting the app; import modules with `page.evaluate(() => import('./js/io/...'))`. Custom elements in `modulePage` HTML do not upgrade; create them with `document.createElement` after importing `define.js`.
- Device-only behaviour (audio session, mute switch, wake lock, share sheet) goes in `tests/manual-ipad.md`.
