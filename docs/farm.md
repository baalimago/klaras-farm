# Farm domain

Keep this file current: update it in the same commit as any change to this domain.

## Purpose

The farm domain is the family's data: places (scenes), the things in them, their voice clips and the settings. It defines the persisted `Snapshot`, validates and migrates it, and changes it only through pure intents. `FarmStore` is the single owner of the live snapshot and applies each intent's writes in one storage transaction. The domain also holds the felt palette, the leg geometry shared by migration and rendering, the "Where is the..." script filling, and the import checks for an export file.

## Files

- `web/js/types.js`: shared JSDoc types (`Point`, `Piece`, `Place`, `Thing`, `Eye`, `Leg`, `Motion`, `Cue`, `Clip`, `BlobRecord`, `Settings`, `Snapshot`, `Draft`, `Env`, `Write`, `Repository`, `Actor`, `Pose`). No runtime code.
- `web/js/farm-store.js`: `FarmStore`, the only owner of the persisted snapshot. Runs intents, drafts, meta, blobs. Not pure (it awaits the repository and emits events).
- `web/js/farm/snapshot.js`: format constants, `emptySnapshot`, `defaultSettings`, `validateSnapshot`, `migrate` and its `STEPS`, `storedFormat`, canonical form, `clipKey`, `roundPoints`.
- `web/js/farm/intents.js`: pure intents `(snapshot, args, env) => {snapshot, writes, change}`, `FarmError`, and read queries (`thingsIn`, `clipsFor`, `tapClips`, `playLanguageFor`).
- `web/js/farm/legs.js`: leg (hip) geometry: `MAX_LEGS`, `LEG_COUNTS`, `spreadLegs`, `footY`, `legLength`, `legacyLegCount`, `cleanLegs`.
- `web/js/farm/palette.js`: the Sunny felt palette (`SUNNY` key to hex), swatch lists, `isColorKey`, `hex`, `INK`.
- `web/js/farm/scripts.js`: cue and colour question text from `web/data/scripts/<lang>.json`, with language fallback.
- `web/js/farm/import.js`: pure checks for an export zip's contents (`checkImport`, `ImportError`, zip naming helpers).

## Data model

All coordinates are board coordinates: `[x, y]` with x and y in 0..1 of the 4:3 board (x left to right, y top to bottom). Stored points are rounded to 3 decimals (`roundPoints`, `cleanLegs`). Colours are always palette keys, never hex.

- `Snapshot`: `formatVersion`, `minReaderFormat`, `appVersion`, `exportedAt`, `deviceId`, `settings`, `places[]`, `things[]`, `clips[]`. It is also the export manifest (`manifest.json`).
- `Place`: `id`, `name` (parent-only), `backdrop` (`meadow|sea|room|blank`), `skyColor`, `groundColor`, `pieces[]` (scene felt shapes and yarn, drawing order), `thingOrder[]` (thing ids, back to front), optional `findIt` (format 2), `createdAt`, `updatedAt`. `findIt` absent or `true` means the find buttons show; only `findIt === false` hides them.
- `Piece`: `id`, `kind` (`shape` closed outline, at least 3 points; `yarn` open polyline, at least 2), `stroke`, `color`.
- `Thing`: `id`, `placeId`, `names` (lang to typed name), `outline` (one closed polygon, at least 3 points), `color`, `eyes` (0 to 2 `{x, y}`), `legs` (0 to 8 hips `{x, y}`, format 3), `motion` (`{kind:'preset', preset, params}`), `cues` (lang to `{lines?, article?}`), dates.
- `Clip`: `id`, `thingId`, `language`, `kind` (`name|prompt|sound`), `take` (1 to 3), `blobSha256` (64 hex), `mime`, `durationMs`, `trimStartMs`, `trimEndMs`, `gainDb`, `createdAt`. Unique key `(thingId, language, kind, take)` via `clipKey`. This key is a one-way door.
- `Settings`: `languages` (first is default), `playLanguage` (a language or `'alternate'`, shown as "Mix languages", the default), `sleepMinutes` (0 off, default 8), `gateKind` (`keypad|sum`), `reduceMotion`, `currentPlaceId`, `welcomed`, `updatedAt`.
- `Draft`: guided add progress, stored in the `drafts` store, never exported.
- `Env`: `now()` ISO string, `rng()`, `newId()`, `deviceId`. Injected so intents stay pure.

Invariants checked by `validateSnapshot` (never throws, returns `{ok}` or `{ok:false, error}`): unique ids; every thing's place exists; at most `MAX_THINGS_PER_PLACE` (4) things per place; every `thingOrder` id exists; every clip's thing exists; no duplicate clip keys; known backdrops and colour keys; valid language tags; ISO dates; `minReaderFormat <= FORMAT_VERSION`. With `{blobShas}` it also requires every clip's blob.

## Public API

`farm/snapshot.js`
- `FORMAT_VERSION = 3`, `MIN_READER_FORMAT = 1`, `MAX_THINGS_PER_PLACE = 4`, `CLIP_KINDS`, `BACKDROPS`, `MOTION_PRESETS`.
- `emptySnapshot(env, appVersion)`, `defaultSettings(env, lang = "en")`.
- `migrate(s)`: steps `s` up one version at a time through `STEPS` until `FORMAT_VERSION`. A newer but readable file is returned unchanged, unknown fields kept.
- `storedFormat(things)`: storage records carry no version. Things without `legs` mean format 2, else `FORMAT_VERSION`.
- `withLegacyLegs(thing)`: the 2 to 3 step for one thing (legs its preset used to draw).
- `canonicalJson(value)`, `canonicalSnapshot(s)`: sorted keys and id-sorted entity arrays, so equal data gives equal strings.

`farm/intents.js`. Every intent takes `(snapshot, args, env)`, never mutates its input, and returns `{snapshot, writes, change}`. `writes` are `Write` records (`put`/`delete` on `places|things|clips|settings|blobs`). `change` is `{kind, ids}`. Invalid input throws `FarmError` with `code` `invalid`, `not-found` or `place-full`.
- Places: `createPlace` (also makes it current), `renamePlace`, `updatePlace` (patch `skyColor`, `groundColor`, `backdrop`, `findIt`, `pieces`), `deletePlace` (cascades things and clips, leaves blobs for the orphan sweep, moves `currentPlaceId`), `setCurrentPlace`.
- Pieces: `addPiece`, `updatePiece`, `removePiece`.
- Things: `canAddThing`, `addThing` (cap 4, legs default to none, motion defaults to `walk`, attaches given clips), `updateThing` (patchable: `names, outline, color, eyes, legs, motion, cues`; clips are kept), `deleteThing` (`change.removed` holds `{thing, clips, index}` for Undo), `restoreThing`.
- Clips: `saveClip` (replaces the clip with the same key in the same batch, optionally puts its blob first), `deleteClip`.
- Settings: `updateSettings` (patchable: `languages, playLanguage, sleepMinutes, gateKind, reduceMotion, welcomed`). Going from one language to several turns on `alternate` unless the patch set `playLanguage`.
- Queries: `thingsIn(s, placeId)` in drawing order, `clipsFor(s, thingId, {language, kind})` sorted by take, `playLanguageFor(settings, {available, rng})`, `tapClips(s, thingId, language)` (name then sound, falling back to any language).

`FarmStore` (`farm-store.js`, extends `EventTarget`)
- `constructor(repo, env, appVersion)`, `hydrate()` returns `{fresh}`, throws `FarmError('corrupt')` if the migrated data is invalid.
- Intent methods with the same names as above. Each runs the pure intent, swaps the snapshot and emits one `change` event (`detail = change`) synchronously, inside the caller's tap, so the UI never waits on IndexedDB. The writes then go to the repository one intent at a time, in call order; the returned promise resolves with the `change` after the commit. Also emits `hydrated` and `replaced`.
- Invalid input throws before anything changes (the promise rejects with `FarmError` `invalid`, `not-found` or `place-full`, no event).
- A failed write puts the snapshot back to the last committed one, emits `change {kind: 'reverted'}`, and rejects with `FarmError('storage')` or `FarmError('quota')`. Intents applied after the failed one were built on it, so they are dropped without writing and reject too: storage never holds half a change.
- Blobs in queued writes (`putBlob`, `saveClip`) are readable through `getBlob` before they commit, so audio can decode a clip the snapshot already shows.
- `replaceAll` writes and re-hydrates inside the queue; intents called meanwhile apply to the replaced farm.
- `exportSnapshot()` stamps `FORMAT_VERSION`, `MIN_READER_FORMAT`, `appVersion`, `exportedAt`, `deviceId`.
- `replaceAll(snapshot, blobs)` for import and starter content, then re-hydrates from storage.
- `saveDraft`, `discardDraft`, `listDrafts`, `setMeta`, `getBlob`, `putBlob`, getters `settings`, `currentPlace`, and `thingsIn`, `clipsFor`, `canAddThing`.

`farm/legs.js`: hips are board points inside the outline. A leg hangs straight down; its foot is `legLength(outline)` (0.35 of the thing's height, clamped to 8..34 px of a 600 px board) below the first edge under the hip (`edgeBelow`, `footY`). `spreadLegs(outline, n)` places n hips across the middle of the bottom, `HIP_INSET` above the edge. `legacyLegCount(motion)`: walk 2, scuttle 6, others 0, `params["legs.count"]` wins.

`farm/palette.js`: `SUNNY`, `THING_COLORS`, `SKY_COLORS`, `GROUND_COLORS`, `isColorKey(key)`, `hex(key)` (unknown keys fall back to grey).

`farm/scripts.js`: `scriptFileFor(files, lang)` (exact tag, then base language, then English with `fallback: true`), `fillTemplate(t, {name, article})` (`{the}` dropped with its space when empty), `cueLines(files, thing, lang)` (3 lines, the parent's per-line edits win), `colorLine(files, group, lang, n)`.

`farm/import.js`: `checkImport({manifestText, blobs}, {createdAt})` returns `{snapshot, blobs, counts}` or throws `ImportError` with `code` `not-a-farm`, `newer` or `corrupt` and a `parentMessage`. The caller (`io/share.js`) unzips and recomputes every blob's SHA-256. Also `MANIFEST`, `BLOB_DIR`, `blobPath`, `exportName`, `countsOf`.

## How it fits

- `farm/` is a pure domain. It imports only other pure domains (`farm geometry motion play edit dsp`) and `types.js`. No DOM, browser globals, `Date.now`, `new Date()`, `Math.random`, `crypto`, timers or `fetch`. `tests/unit/boundaries.test.js` enforces this. `Date.parse` in validation is allowed.
- `farm-store.js` sits outside the pure folder. It imports `farm/intents.js` and `farm/snapshot.js` and talks to a `Repository` (`io/idb-repo.js` in the app, `io/memory-repo.js` in tests).
- Callers: `main.js` builds the store; components call store intents and never mutate snapshots; `play-engine.js` reads via the store and uses `tapClips`, `playLanguageFor` and `scripts.js`; `io/share.js` uses `import.js`, `snapshot.js` and `intents.js`; `io/starter.js` uses `defaultSettings`; `io/renderer.js`, `io/felt.js` and parent previews use `palette.js` and `legs.js`.

## Rules and gotchas

- Only `FarmStore` holds the live snapshot. Add new mutations as pure intents in `intents.js` plus a one-line method on `FarmStore`.
- Intents run strictly one at a time (`_serial`), so each sees the previous result even when callers do not await.
- Formats are additive. Format history: 1 first release; 2 optional `Place.findIt`; 3 `Thing.legs`. `minReaderFormat` stays 1 because an older app can still read a format 3 file (it ignores legs and keeps the field).
- Format bump procedure:
  1. Raise `FORMAT_VERSION` in `farm/snapshot.js` and add a comment line to its format history.
  2. Add a `STEPS[old]` entry that moves `formatVersion` up by one. Steps must be pure and safe on mixed data.
  3. Decide `MIN_READER_FORMAT`. Raise it only when older apps cannot read the new shape.
  4. Update `storedFormat()` (in `farm/snapshot.js`, called by `FarmStore.hydrate`) if records read back from IndexedDB need detecting. Today it only tells format 2 from 3, so a format 4 change that needs a migration step must teach it to detect 3.
  5. Update `validateSnapshot`, `types.js`, `tests/builders.js` (`aSnapshot` stamps `formatVersion`), and `snapshot.test.js` migration tests.
  6. Never regenerate `tests/fixtures/exports/v1/basic.zip`. It must keep importing to `basic.expected.json`; update the expected file only if the migration intentionally adds fields.
  7. Regenerate the starter with `node tools/make-starter.mjs` (`--check` exits 1 when out of date; `web/js/io/starter.test.js` checks it).
- Palette keys and clip key fields are one-way doors: never rename or remove them.
- Deleting a thing or place leaves blobs; the orphan sweep removes blobs older than 24 h, which is what lets Undo restore clips.
- `addThing` and `updateThing` keep at most 2 eyes and 8 legs, rounded to 3 decimals.
- `migrate` keeps a newer readable file's `formatVersion`; `exportSnapshot` restamps it with this app's version.
- `motion.preset` is validated only as a string. `MOTION_PRESETS` lists walk and float, while `web/data/motions/` also has hop, scuttle and swim, and the parent UI offers hop and scuttle. Nothing reads `MOTION_PRESETS`; update it with the next format change.

## Tests

- `web/js/farm/*.test.js`: snapshot validation, canonical form, migration 1 to 2 to 3, `storedFormat`, leg validation; intents (purity, cap of 4, clip replacement, cascades, undo, settings language rules, legs); legs geometry; scripts filling and fallback; import checks.
- `tests/unit/farm-store.test.js`: hydrate, one synchronous change per intent before the commit, invalid input, failed writes (rollback, dropped later intents), pending blobs, call order, `replaceAll` (and intents during it).
- `tests/unit/export-fixture.test.js`: the frozen v1 export still imports.
- `tests/unit/find-it.test.js`: `findIt` default on, off per place.
- `tests/browser/legs.test.js`: legs through guided add and reload; format 2 records get preset legs.
- Shared builders: `tests/builders.js` (`fixedEnv`, `aSnapshot`, `aPlace`, `aThing`, `aClip`, `aBlob`, `square`).
