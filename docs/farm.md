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
- `web/js/farm/scripts.js`: cue lines (1 to 6 per thing and language, free text over script examples) and colour game text from `web/data/scripts/<lang>.json`, with language fallback.
- `web/js/farm/import.js`: pure checks for an export zip's contents (`checkImport`, `ImportError`, zip naming helpers).

## Data model

All coordinates are board coordinates: `[x, y]` with x and y in 0..1 of the 4:3 board (x left to right, y top to bottom). Stored points are rounded to 3 decimals (`roundPoints`, `cleanLegs`). Colours are always palette keys, never hex.

- `Snapshot`: `formatVersion` (4), `minReaderFormat` (4), `appVersion`, `exportedAt`, `deviceId`, `settings`, `places[]`, `things[]`, `clips[]`. It is also the export manifest (`manifest.json`).
- `Place`: `id`, `name` (parent-only), `backdrop` (`meadow|sea|room|blank`), `skyColor`, `groundColor`, `pieces[]` (scene felt shapes and yarn, drawing order), `thingOrder[]` (thing ids, back to front), optional `findIt` (format 2), `createdAt`, `updatedAt`. `findIt` absent or `true` means the find buttons show; only `findIt === false` hides them.
- `Piece`: `id`, `kind` (`shape` closed outline, at least 3 points; `yarn` open polyline, at least 2), `stroke`, `color`.
- `Thing`: `id`, `placeId`, `names` (lang to typed name), `outline` (one closed polygon, at least 3 points), `color`, `eyes` (0 to 2 `{x, y}`), `legs` (0 to 8 hips `{x, y}`, format 3), `motion` (`{kind:'preset', preset, params}`), `cues` (lang to `{lines?, article?}`; `lines` are the parent's questions, 1 to 6 free-text strings, and their count is the number of questions; an empty or null line means the script example at that position; no `lines` means the 3 examples), dates.
- `Clip`: `id`, `thingId`, `language`, `kind`, `take` (1 to 6), `blobSha256` (64 hex), `mime`, `durationMs`, `trimStartMs`, `trimEndMs`, `gainDb`, `createdAt`.
  - Thing clips: `kind` `name|prompt|sound`; prompt take n is the recording of question line n. Unique key `(thingId, language, kind, take)` via `clipKey`. This key is a one-way door.
  - Colour game clips (format 4), family-level: `thingId: null`, `kind` `color-word` (with `color`, a simple colour from `SIMPLE_COLORS`, take 1) or `color-question` (takes 1 to 6, no colour). Key `game|language|kind|color|take`. They live in the same `clips` collection and IndexedDB store, so export, import, `replaceAll` and the orphan blob sweep handle them like any clip. IndexedDB's unique `key` index skips records whose `thingId` is null, so game clip uniqueness is guaranteed by `saveClip` and `validateSnapshot` (and enforced by `MemoryRepo`).
- `Settings`: `languages` (first is default), `playLanguage` (a language or `'alternate'`, shown as "Mix languages", the default), `sleepMinutes` (0 off, default 8), `gateKind` (`keypad|sum`), `reduceMotion`, `maxThings` (things per scene, 1 to 12, default 8, format 4), `currentPlaceId`, `welcomed`, `updatedAt`.
- `Draft`: guided add progress, stored in the `drafts` store, never exported.
- `Env`: `now()` ISO string, `rng()`, `newId()`, `deviceId`. Injected so intents stay pure.

Invariants checked by `validateSnapshot` (never throws, returns `{ok}` or `{ok:false, error}`): unique ids; every thing's place exists; `settings.maxThings` a whole number 1 to 12; at most `MAX_THINGS_LIMIT` (12) things per place (not `maxThings`: lowering the setting never removes things or makes stored data invalid); cues have at most 6 string lines; every `thingOrder` id exists; every thing clip's thing exists and has a thing kind; game clips have a game kind and colour words a simple colour; takes 1 to 6; no duplicate clip keys; known backdrops and colour keys; valid language tags; ISO dates; `minReaderFormat <= FORMAT_VERSION`. With `{blobShas}` it also requires every clip's blob.

## Public API

`farm/snapshot.js`
- `FORMAT_VERSION = 4`, `MIN_READER_FORMAT = 4`, `MAX_THINGS_LIMIT = 12` (also exported as `MAX_THINGS_PER_PLACE`, the validation ceiling), `DEFAULT_MAX_THINGS = 8`, `MAX_QUESTIONS = 6`, `THING_CLIP_KINDS`, `GAME_CLIP_KINDS`, `CLIP_KINDS`, `BACKDROPS`, `MOTION_PRESETS`.
- `isGameClip(clip)`, `withMaxThings(settings)` (the 3 to 4 step for settings).
- `emptySnapshot(env, appVersion)`, `defaultSettings(env, lang = "en")`.
- `migrate(s)`: steps `s` up one version at a time through `STEPS` until `FORMAT_VERSION`. A newer but readable file is returned unchanged, unknown fields kept.
- `storedFormat(things, settings)`: storage records carry no version. Things without `legs` mean format 2; stored settings without a valid `maxThings` mean format 3; else `FORMAT_VERSION`. No settings (fresh install) says nothing. `FarmStore.hydrate` passes both.
- `withLegacyLegs(thing)`: the 2 to 3 step for one thing (legs its preset used to draw).
- `canonicalJson(value)`, `canonicalSnapshot(s)`: sorted keys and id-sorted entity arrays, so equal data gives equal strings.

`farm/intents.js`. Every intent takes `(snapshot, args, env)`, never mutates its input, and returns `{snapshot, writes, change}`. `writes` are `Write` records (`put`/`delete` on `places|things|clips|settings|blobs`). `change` is `{kind, ids}` (for colour game clips `ids` holds only the clip id). Invalid input throws `FarmError` with `code` `invalid`, `not-found` or `place-full`.
- Places: `createPlace` (also makes it current), `renamePlace`, `updatePlace` (patch `skyColor`, `groundColor`, `backdrop`, `findIt`, `pieces`), `deletePlace` (cascades things and clips, leaves blobs for the orphan sweep, moves `currentPlaceId`), `setCurrentPlace`.
- Pieces: `addPiece`, `updatePiece`, `removePiece`.
- Things: `maxThings(s)` (the family's cap, default 8 when unset), `canAddThing`, `addThing` (cap `settings.maxThings`, `place-full` beyond it; legs default to none, motion defaults to `walk`, attaches given clips), `updateThing` (patchable: `names, outline, color, eyes, legs, motion, cues`; clips are kept), `deleteThing` (`change.removed` holds `{thing, clips, index}` for Undo), `restoreThing`.
- Clips: `saveClip` (thing clips or colour game clips with `thingId` null; replaces the clip with the same key in the same batch, optionally puts its blob first; takes 1 to 6; a colour question drops any `color`), `deleteClip`.
- Questions: `setQuestionLine {thingId, language, index, text}` (empty text means the example), `addQuestion {thingId, language, text?}` (up to 6), `removeQuestion {thingId, language, index}` (at least 1 stays; deletes that line's prompt clip and moves later takes up one, in ascending order so no two clips share a key mid-batch). A thing without `lines` starts from its 3 examples.
- Settings: `updateSettings` (patchable: `languages, playLanguage, sleepMinutes, gateKind, reduceMotion, welcomed, maxThings`; `maxThings` must be a whole number 1 to 12, else `invalid`). Going from one language to several turns on `alternate` unless the patch set `playLanguage`.
- Queries: `thingsIn(s, placeId)` in drawing order, `clipsFor(s, thingId, {language, kind})` sorted by take, `playLanguageFor(settings, {available, rng})`, `tapClips(s, thingId, language)` (name then sound, falling back to any language), `gameClips(s, {kind, language, color})` (colour game clips by take; `clipsFor` never returns them).

`FarmStore` (`farm-store.js`, extends `EventTarget`)
- `constructor(repo, env, appVersion)`, `hydrate()` returns `{fresh}`, throws `FarmError('corrupt')` if the migrated data is invalid.
- Intent methods with the same names as above (including `setQuestionLine`, `addQuestion`, `removeQuestion`). Each resolves with the `change` after the write commits, then emits one `change` event (`detail = change`). Also emits `hydrated` and `replaced`.
- A failed write leaves the snapshot unchanged and rejects with `FarmError('storage')` or `FarmError('quota')`.
- `exportSnapshot()` stamps `FORMAT_VERSION`, `MIN_READER_FORMAT`, `appVersion`, `exportedAt`, `deviceId`.
- `replaceAll(snapshot, blobs)` for import and starter content, then re-hydrates from storage.
- `saveDraft`, `discardDraft`, `listDrafts`, `setMeta`, `getBlob`, `putBlob`, getters `settings`, `currentPlace`, and `thingsIn`, `clipsFor`, `gameClips`, `canAddThing`, getter `maxThings`.

`farm/legs.js`: hips are board points inside the outline. A leg hangs straight down; its foot is `legLength(outline)` (0.35 of the thing's height, clamped to 8..34 px of a 600 px board) below the first edge under the hip (`edgeBelow`, `footY`). `spreadLegs(outline, n)` places n hips across the middle of the bottom, `HIP_INSET` above the edge. `legacyLegCount(motion)`: walk 2, scuttle 6, others 0, `params["legs.count"]` wins.

`farm/palette.js`: `SUNNY`, `THING_COLORS`, `SKY_COLORS`, `GROUND_COLORS`, `SIMPLE_COLORS` (the 11 colour words the colour game uses; a one-way door, colour word clips store them; `play/colors.js` folds felt keys into them), `isColorKey(key)`, `hex(key)` (unknown keys fall back to grey).

`farm/scripts.js`: `scriptFileFor(files, lang)` (exact tag, then base language, then English with `fallback: true`), `fillTemplate(t, {name, article})` (`{the}` dropped with its space when empty), `DEFAULT_QUESTIONS = 3`, `MAX_CUE_LINES = 6`, `questionCount(thing, lang)`, `cueLines(files, thing, lang)` returns `{lines, examples, fallback, articles}` (one line per question; an empty parent line is the example, templates going round), `colorLine(files, group, lang, n)` (the device voice's "Tap on an animal that is yellow!"), `colorQuestionText(files, lang)` (what to say when recording the colour question, the script's `colorQuestion`), `colorWord(files, group, lang)` (null without a script). Script files hold `templates`, `articles`, `colorQuestion`, `colorTemplates` (with `{color}`) and `colors` (the word as it fits after the question).

`farm/import.js`: `checkImport({manifestText, blobs}, {createdAt})` returns `{snapshot, blobs, counts}` or throws `ImportError` with `code` `not-a-farm`, `newer` or `corrupt` and a `parentMessage`. The caller (`io/share.js`) unzips and recomputes every blob's SHA-256. Also `MANIFEST`, `BLOB_DIR`, `blobPath`, `exportName`, `countsOf`.

## How it fits

- `farm/` is a pure domain. It imports only other pure domains (`farm geometry motion play edit dsp`) and `types.js`. No DOM, browser globals, `Date.now`, `new Date()`, `Math.random`, `crypto`, timers or `fetch`. `tests/unit/boundaries.test.js` enforces this. `Date.parse` in validation is allowed.
- `farm-store.js` sits outside the pure folder. It imports `farm/intents.js` and `farm/snapshot.js` and talks to a `Repository` (`io/idb-repo.js` in the app, `io/memory-repo.js` in tests).
- Callers: `main.js` builds the store; components call store intents and never mutate snapshots; `play-engine.js` reads via the store and uses `tapClips`, `playLanguageFor` and `scripts.js`; `io/share.js` uses `import.js`, `snapshot.js` and `intents.js`; `io/starter.js` uses `defaultSettings`; `io/renderer.js`, `io/felt.js` and parent previews use `palette.js` and `legs.js`.

## Rules and gotchas

- Only `FarmStore` holds the live snapshot. Add new mutations as pure intents in `intents.js` plus a one-line method on `FarmStore`.
- Intents run strictly one at a time (`_serial`), so each sees the previous result even when callers do not await.
- Formats are additive. Format history: 1 first release; 2 optional `Place.findIt`; 3 `Thing.legs`; 4 `Settings.maxThings`, 1 to 6 questions and prompt takes, colour game clips (`thingId` null). `minReaderFormat` is 4: a format 3 app would call a format 4 file damaged (null `thingId`, takes over 3, more than 4 things), so it says "made by a newer version" instead. Files of formats 1 to 3 still import.
- Format bump procedure:
  1. Raise `FORMAT_VERSION` in `farm/snapshot.js` and add a comment line to its format history.
  2. Add a `STEPS[old]` entry that moves `formatVersion` up by one. Steps must be pure and safe on mixed data.
  3. Decide `MIN_READER_FORMAT`. Raise it only when older apps cannot read the new shape.
  4. Update `storedFormat()` (in `farm/snapshot.js`, called by `FarmStore.hydrate`) if records read back from IndexedDB need detecting. Today it tells format 2 (things without legs) and 3 (settings without `maxThings`) from 4.
  5. Update `validateSnapshot`, `types.js`, `tests/builders.js` (`aSnapshot` stamps `formatVersion`), and `snapshot.test.js` migration tests.
  6. Never regenerate `tests/fixtures/exports/v1/basic.zip` or `v3/basic.zip` (written once by the format 3 build, with an edited cue line and a take 3 prompt). They must keep importing to their `basic.expected.json`; update an expected file only if the migration intentionally adds fields (format 4 added `settings.maxThings: 8`).
  7. Regenerate the starter with `node tools/make-starter.mjs` (`--check` exits 1 when out of date; `web/js/io/starter.test.js` checks it).
- Palette keys and clip key fields are one-way doors: never rename or remove them.
- Deleting a thing or place leaves blobs; the orphan sweep removes blobs older than 24 h, which is what lets Undo restore clips.
- `addThing` and `updateThing` keep at most 2 eyes and 8 legs, rounded to 3 decimals.
- Lowering `settings.maxThings` below a scene's count keeps every thing; `canAddThing` (and Undo of a delete) refuses until the scene is under the cap again.
- `migrate` keeps a newer readable file's `formatVersion`; `exportSnapshot` restamps it with this app's version.
- `motion.preset` is validated only as a string. `MOTION_PRESETS` lists walk and float, while `web/data/motions/` also has hop, scuttle and swim.

## Tests

- `web/js/farm/*.test.js`: snapshot validation, canonical form, migration 1 to 2 to 3 to 4, `storedFormat`, leg, `maxThings`, question and colour game clip validation; intents (purity, things-per-scene cap, clip replacement, colour game clips, questions add/edit/remove with take renumbering, cascades, undo, settings language rules, legs); legs geometry; scripts filling, question counts and fallback; import checks.
- `tests/unit/farm-store.test.js`: hydrate, one change per committed intent, failed writes, call order, `replaceAll`.
- `tests/unit/export-fixture.test.js`: the frozen v1 and v3 exports still import (to format 4).
- `tests/contracts/repository.contract.js`: also colour game clips (null `thingId`) and renumbered takes in one batch.
- `tests/unit/find-it.test.js`: `findIt` default on, off per place.
- `tests/browser/legs.test.js`: legs through guided add and reload; format 2 records get preset legs.
- Shared builders: `tests/builders.js` (`fixedEnv`, `aSnapshot`, `aPlace`, `aThing`, `aClip`, `aBlob`, `square`).
