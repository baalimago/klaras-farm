# dsp: pure audio math

Keep this file current: update it in the same commit as any change to this domain.

## Purpose

`web/js/dsp/` holds every audio calculation that can be done without a device: levels, the recording auto-stop, take trimming and gain, the chime and music score data, and WAV helpers. It is data in, data out. The device side (AudioContext, MediaRecorder, oscillators) lives in `io/audio.js`, `io/mic.js` and `io/music.js`, which import from here.

## Files

- `level.js`: RMS, peak, dBFS conversions, noise-floor estimate, per-frame levels, meter mapping.
- `autostop.js`: the recording auto-stop as a pure reducer fed with (ms since start, level dB).
- `take.js`: non-destructive take analysis: trim points, normalising gain and a verdict.
- `chimes.js`: feedback sounds as note data, the hold tone, envelope math and peak bounds.
- `music.js`: the generated music-box lullaby, one bar at a time, plus music bus levels.
- `wav.js`: mono mix-down and a 16-bit PCM WAV encoder (recorder analysis, tests, fixtures).

Each module has a `*.test.js` next to it.

## Public API / contracts

### level.js

- `FLOOR_DB = -100`. Digital silence maps here, never to `-Infinity`.
- `rms(samples, start?, end?)`, `peak(samples, start?, end?)`: ranges are clamped; an empty range gives 0.
- `dbfs(x)` linear to dB (floored at `FLOOR_DB`); `fromDb(db)` dB to linear gain.
- `noiseFloor(levels, {percentile = 0.5})`: a percentile of a list of dB levels.
- `frameLevels(samples, sampleRate, frameMs = 10)`: dB level per frame.
- `meterLevel(db, {minDb = -60, maxDb = 0})`: dB to 0..1 for the recorder's meter.

### autostop.js

- `AUTO_STOP`: `calibrateMs 300`, `silenceMs 800`, `marginDb 10`, `capMs 5000`, floor clamped to `[-70, -35]` dB.
- `autoStopInit(opts?)` returns a state. `autoStopStep(state, tMs, levelDb)` returns a new state; it never mutates.
- The first 300 ms calibrate the room's noise floor. Once a level above floor + margin has been heard, 800 ms below it stops with `stop: 'silence'`. At 5 s it stops with `stop: 'cap'`. `stopAtMs` records when.
- The floor clamp means a muted input still gets a threshold, and talking straight away does not become "the noise floor".

### take.js

- `TAKE`: frame 10 ms, margin 10 dB, floor percentile 0.05, pad 60 ms before and 150 ms after, silent below -50 dB, minimum 300 ms, ceiling -1 dB, gain between -24 and +18 dB.
- `trimPoints(samples, sampleRate, opts)` returns `{startMs, endMs}`, or `{0, 0}` when nothing stands out. `opts.floorDb` is the floor the recorder measured live; the lower of the two floors wins.
- `gainFor(peakLinear, ceilingDb?)`: dB in 0.1 steps that brings the peak to the ceiling, clamped.
- `validateTake({durationMs, trimmedMs, peak})` returns `'ok' | 'too-short' | 'silent'` (US-4.4).
- `analyseTake(samples, sampleRate, opts)` returns `{durationMs, trimStartMs, trimEndMs, peak, gainDb, verdict}`. Gain is 0 unless the verdict is `ok`.
- The recorded bytes are never changed. Trim and gain are stored on the clip and applied at playback by `AudioEngine`.

### chimes.js

- A note is `{wave, at, freq, toFreq?, slide?, attack, decay, gain, partials?, filter?, toFilter?}`. `wave` is `'sine' | 'triangle' | 'noise'`. Times are seconds. The envelope is a linear attack to `gain`, then an exponential decay to `SILENT` (0.0001).
- `CHIMES`: `tap`, `enter`, `leave`, `start`, `stop`, `plink`, `poof`, `hold-done`, `yay`. `CHIME_KINDS` lists them.
- `CHIME_BUS_DB = -8`: the chime bus level relative to the voice bus.
- `HOLD_TONE`: the soft tone rising from 330 to 495 Hz over 1 s with the hold ring (US-11.1).
- `envelopeAt(note, t)`, `chimeDuration(kind)`, `chimePeakDb(kind)` (upper bound at the output, partials in phase, after the bus gain).

### music.js

- 3/4 at 56 bpm (`BPM`, `BEATS_PER_BAR`, `BAR_S`), C major, an eight-bar `PROGRESSION` (C Am F G | C Am Dm G).
- `musicBar(bar, seed = 1)` returns the notes of one bar in the chime note shape, times relative to the bar start. Each bar has a low root, a filtered triangle pad and a sparse pentatonic melody (C5 to D6).
- The melody is rebuilt from a `seededRng` seeded by the seed and the phrase number, and walked from the phrase start, so any bar can be built on its own and the line stays continuous. A new phrase every eight bars keeps it from sounding like a short loop.
- `MUSIC_BUS_DB = -16`, `MUSIC_DUCK_DB = -14` (dip while a voice plays), `MUSIC_FADE_S = 2.5`.
- `seededRng(seed)`: a small LCG returning 0..1.

### wav.js

- `mixDown(channels)`: averages channels into one `Float32Array` (one channel is returned as is).
- `encodeWav(samples, sampleRate)`: mono float samples (clipped to -1..1) to WAV bytes.

## How it fits

- Imports: only other `dsp/` modules (and `types.js` if needed). `chimes.js` and `take.js` use `level.js`.
- Used by `io/audio.js` (chimes, `fromDb`, `MUSIC_DUCK_DB`), `io/music.js` (`musicBar`, bus levels), `io/mic.js` (auto-stop, levels, `analyseTake`, `mixDown`).
- `dsp/` is one of the pure domains (`farm geometry motion play edit dsp`). `tests/unit/boundaries.test.js` fails if any file here uses `Date.now`, `new Date()`, `Math.random`, `crypto`, timers, `requestAnimationFrame`, `document`, `window`, `navigator`, `localStorage`, `indexedDB`, `AudioContext`, `performance.now` or `fetch`, or imports outside the pure domains.
- Only `io/`, `components/` and `main.js` may touch IndexedDB, audio or the DOM.

## Rules and gotchas

- No randomness from the platform. Music uses `seededRng`; the seed is injected by `io/music.js`. Noise for the `poof` chime is generated in `io/audio.js`, not here.
- There are no audio files. Chimes and music are synthesized from this data. Keep it original (licensing rule).
- Levels: chimes must stay at least 6 dB below a normalised voice, and the music well under the chimes. Changing a gain, `CHIME_BUS_DB` or `MUSIC_BUS_DB` means re-running the level tests below.
- Keep notes in the chime note shape so `io/audio.js` `synthNotes` can play both chimes and music.
- Auto-stop and take thresholds are tuned for a base iPad in a living room. Change them with a test that shows the case you are fixing.
- Trim is non-destructive. Never modify recorded bytes; the blob is addressed by its SHA-256.

## Tests

- Unit (Node, `npm test`): `level.test.js`, `autostop.test.js`, `take.test.js`, `chimes.test.js`, `music.test.js`, `wav.test.js`, all next to the modules. They use synthetic signals and need no browser.
- Browser (`npm run test:browser`): `tests/browser/package-d.test.js` renders every chime offline (`renderChime`) and checks it sits at least 6 dB below a normalised voice; it also uses `encodeWav` for test fixtures. `tests/browser/music.test.js` renders the lullaby (`renderMusic`) and checks level, fades, ducking and the off switch.
- `tests/unit/boundaries.test.js` keeps this folder pure.
