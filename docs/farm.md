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
- `web/js/farm/palette.js`: the Sunny felt palette (`SUNNY` key to hex), swatch lists, `isColorKey`, `hex`, `INK`, and the sky and ground colour helpers `isCustomColor`, `isSceneColor`, `sceneColor`, `sceneHex`.
- `web/js/farm/scripts.js`: the device voice's find questions (script templates filled with the typed name and article), the cue for the family's recorded find question, and colour game text from `web/data/scripts/<lang>.json`, with language fallback.
- `web/js/farm/library.js`: the animal library (QA round 3): `thingKey`, `libraryEntries`, `copyOf`, `pickSeeds`, `seedCount`, `SEED_MIN`/`SEED_MAX`. Where a copy, a seeded thing or a drawn thing lands is `play/placement.js` `placeThing` (docs/play.md).
- `web/js/farm/import.js`: pure checks for an export zip's contents (`checkImport`, `ImportError`, zip naming helpers).

## Data model

All coordinates are board coordinates: `[x, y]` with x and y in 0..1 of the 4:3 board (x left to right, y top to bottom). Stored points are rounded to 3 decimals (`roundPoints`, `cleanLegs`). Colours are palette keys, never hex, with one exception: a place's `skyColor` and `groundColor` may hold a colour the parent picked freely, as lowercase `#rrggbb` (format 5).

- `Snapshot`: `formatVersion` (5), `minReaderFormat` (5), `appVersion`, `exportedAt`, `deviceId`, `settings`, `places[]`, `things[]`, `clips[]`. It is also the export manifest (`manifest.json`).
- `Place`: `id`, `name` (parent-only), `backdrop` (`meadow|sea|room|blank`), `skyColor`, `groundColor` (a palette key, or a picked `#rrggbb`, format 5), `pieces[]` (scene felt shapes and yarn, drawing order), `thingOrder[]` (thing ids, back to front), optional `findIt` (format 2), `createdAt`, `updatedAt`. `findIt` absent or `true` means the find buttons show; only `findIt === false` hides them.
- `Piece`: `id`, `kind` (`shape` closed outline, at least 3 points; `yarn` open polyline, at least 2), `stroke`, `color`.
- `Thing`: `id`, `placeId`, `names` (lang to typed name), `outline` (one closed polygon, at least 3 points), `color`, `eyes` (0 to 2 `{x, y}`), `legs` (0 to 8 hips `{x, y}`, format 3), `motion` (`{kind:'preset', preset, params}`), `cues` (lang to `{article?}`, the article the device voice puts before the name; format 5 dropped the per-thing question `lines`), dates.
- `Clip`: `id`, `thingId`, `language`, `kind`, `take` (1 to 6), `blobSha256` (64 hex), `mime`, `durationMs`, `trimStartMs`, `trimEndMs`, `gainDb`, `createdAt`.
  - Thing clips: `kind` `name|sound` (format 6 dropped `prompt`, the per-thing whole-sentence questions). Unique key `(thingId, language, kind, take)` via `clipKey`. This key is a one-way door. A thing has one sound: `saveClip` of a sound replaces its sound in every language (QA round 3), and `soundClip` reads the newest, so an older farm with a sound per language plays the last one recorded. A tie on `createdAt` goes to the greater `language`, then `blobSha256`, never to list order or id, so the same sound plays after a reload (IndexedDB returns clips by id), an export and import, or a copy (copies keep each clip's `createdAt`). `addThing` keeps only the last sound it is handed.
  - Find game clips, family-level: `thingId: null`, `kind` `find-question` (format 5, takes 1 to 6, no colour: "Where is the…", "Show me the…"; a thing's recorded name follows it), `color-word` (format 4, with `color`, a simple colour from `SIMPLE_COLORS`, take 1) or `color-question` (format 4, takes 1 to 6, no colour). Key `game|language|kind|color|take`. They live in the same `clips` collection and IndexedDB store, so export, import, `replaceAll` and the orphan blob sweep handle them like any clip. IndexedDB's unique `key` index skips records whose `thingId` is null, so game clip uniqueness is guaranteed by `saveClip` and `validateSnapshot` (and enforced by `MemoryRepo`).
- `Settings`: `languages` (first is default), `playLanguage` (a language or `'alternate'`, shown as "Mix languages", the default), `sleepMinutes` (0 off, default 8), `gateKind` (`keypad|sum`), `reduceMotion`, `maxThings` (things per scene, 1 to 12, default 8, format 4), `currentPlaceId`, `welcomed`, `updatedAt`.
- `Draft`: guided add progress, stored in the `drafts` store, never exported.
- `Env`: `now()` ISO string, `rng()`, `newId()`, `deviceId`. Injected so intents stay pure.

Invariants checked by `validateSnapshot` (never throws, returns `{ok}` or `{ok:false, error}`): unique ids; every thing's place exists; `settings.maxThings` a whole number 1 to 12; at most `MAX_THINGS_LIMIT` (12) things per place (not `maxThings`: lowering the setting never removes things or makes stored data invalid); cues have at most 6 string lines; every `thingOrder` id exists; every thing clip's thing exists and has a thing kind; game clips have a game kind and colour words a simple colour; takes 1 to 6; no duplicate clip keys; known backdrops and colour keys (a place's sky and ground also take lowercase `#rrggbb`; things and pieces only keys); valid language tags; ISO dates; `minReaderFormat <= FORMAT_VERSION`. With `{blobShas}` it also requires every clip's blob.

## Public API

`farm/snapshot.js`
- `FORMAT_VERSION = 5`, `MIN_READER_FORMAT = 5`, `MAX_THINGS_LIMIT = 12` (also exported as `MAX_THINGS_PER_PLACE`, the validation ceiling), `DEFAULT_MAX_THINGS = 8`, `MAX_QUESTIONS = 6`, `THING_CLIP_KINDS`, `GAME_CLIP_KINDS`, `CLIP_KINDS`, `BACKDROPS`, `MOTION_PRESETS`.
- `isGameClip(clip)`, `withMaxThings(settings)` (the 3 to 4 step for settings).
- `emptySnapshot(env, appVersion)`, `defaultSettings(env, lang = "en")`.
- `migrate(s)`: steps `s` up one version at a time through `STEPS` until `FORMAT_VERSION`. A newer but readable file is returned unchanged, unknown fields kept.
- `storedFormat(things, settings, clips)`: storage records carry no version. Things without `legs` mean format 2; stored settings without a valid `maxThings` mean format 3; a `prompt` clip or a cue with `lines` means format 4; else `FORMAT_VERSION`. No settings (fresh install) says nothing. `FarmStore.hydrate` passes all three. `withoutCueLines(thing)` is the 4 to 5 step for one thing (the same object when it has no lines).
- `withLegacyLegs(thing)`: the 2 to 3 step for one thing (legs its preset used to draw).
- `canonicalJson(value)`, `canonicalSnapshot(s)`: sorted keys and id-sorted entity arrays, so equal data gives equal strings.

`farm/intents.js`. Every intent takes `(snapshot, args, env)`, never mutates its input, and returns `{snapshot, writes, change}`. `writes` are `Write` records (`put`/`delete` on `places|things|clips|settings|blobs`). `change` is `{kind, ids}` (for colour game clips `ids` holds only the clip id). Invalid input throws `FarmError` with `code` `invalid`, `not-found` or `place-full`.
- Places: `createPlace` (also makes it current; with `seed: {examples, count?}` the new place starts with `SEED_MIN` to `SEED_MAX` (3 to 4, by `env.rng`) random library entries, the family's own things and the valid `examples`, copied with their recordings onto free spots of the ground, never more than `maxThings - 1` so there is room for one more; all in the one `place-created` change, whose `things` lists the seeded ids), `renamePlace`, `updatePlace` (patch `skyColor`, `groundColor`, `backdrop`, `findIt`, `pieces`), `deletePlace` (cascades things and clips, leaves blobs for the orphan sweep, moves `currentPlaceId`), `setCurrentPlace`.
- Pieces: `addPiece`, `updatePiece`, `removePiece`.
- Library: `copyThing {placeId, thingId | thing}` adds an independent copy of a thing of this farm (`thingId`; its clips are copied as new clip records over the same `blobSha256`, so no blob is written) or of a pre-made example (`thing` from `web/data/library.json`, no clips) on a free spot of the place's ground (`play/placement.js` `placeThing`, clear of `occupied`: where the place's things stand now, which `FarmStore` fills in from its occupancy, else their saved positions). Names, cues, colour, eyes, legs and motion are kept; ids and dates are new, and each copied clip keeps its `createdAt`. `place-full` like `addThing`; `invalid` for a bad colour, outline or legs. Change `thing-added`.
- Things: `maxThings(s)` (the family's cap, default 8 when unset), `canAddThing`, `addThing` (cap `settings.maxThings`, `place-full` beyond it; legs default to none, motion defaults to `walk`, attaches given clips, at most one of them a sound (the last); with `spot: "free"` the outline, eyes and legs are moved to where `placeThing` puts them, clear of `occupied` like `copyThing`, else the thing stays where it was drawn), `updateThing` (patchable: `names, outline, color, eyes, legs, motion, cues`; clips are kept), `deleteThing` (`change.removed` holds `{thing, clips, index}` for Undo), `restoreThing` (checks only the hard limit `MAX_THINGS_LIMIT`: undoing a delete in a scene above a lowered cap restores a count it already had).
- Clips: `saveClip` (thing clips or find game clips with `thingId` null; replaces the clip with the same key in the same batch, optionally puts its blob first; takes 1 to 6; a question drops any `color`), `deleteClip`.
- Settings: `updateSettings` (patchable: `languages, playLanguage, sleepMinutes, gateKind, reduceMotion, welcomed, maxThings`; `maxThings` must be a whole number 1 to 12, else `invalid`). Going from one language to several turns on `alternate` unless the patch set `playLanguage`.
- Queries: `thingsIn(s, placeId)` in drawing order, `clipsFor(s, thingId, {language, kind})` sorted by take, `playLanguageFor(settings, {available, rng})`, `tapClips(s, thingId, language)` (name, falling back to any language, then `soundClip(s, thingId)`, the newest sound), `gameClips(s, {kind, language, color})` (colour game clips by take; `clipsFor` never returns them).

`FarmStore` (`farm-store.js`, extends `EventTarget`)
- `constructor(repo, env, appVersion)`, `hydrate()` returns `{fresh}`, throws `FarmError('corrupt')` if the migrated data is invalid.
- Intent methods with the same names as above. Each runs the pure intent, swaps the snapshot and emits one `change` event (`detail = change`) synchronously, inside the caller's tap, so the UI never waits on IndexedDB. The writes then go to the repository one intent at a time, in call order; the returned promise resolves with the `change` after the commit. Also emits `hydrated` and `replaced`.
- Invalid input throws before anything changes (the promise rejects with `FarmError` `invalid`, `not-found` or `place-full`, no event).
- A failed write puts the snapshot back to the last committed one, emits `change {kind: 'reverted'}`, and rejects with `FarmError('storage')` or `FarmError('quota')`. Intents applied after the failed one were built on it, so they are dropped without writing and reject too: storage never holds half a change.
- Blobs in queued writes (`putBlob`, `saveClip`) are readable through `getBlob` before they commit, so audio can decode a clip the snapshot already shows.
- `replaceAll` writes and re-hydrates inside the queue; intents called meanwhile apply to the replaced farm.
- `settled()` resolves (never rejects) once every write queued so far has committed or failed. Only for a reload or a test that needs the disk to agree with the snapshot; the UI never waits on it.
- `exportSnapshot()` stamps `FORMAT_VERSION`, `MIN_READER_FORMAT`, `appVersion`, `exportedAt`, `deviceId`.
- `replaceAll(snapshot, blobs)` for import and starter content, then re-hydrates from storage.
- `saveDraft`, `discardDraft`, `listDrafts`, `setMeta`, `getBlob`, `putBlob`, getters `settings`, `currentPlace`, and `thingsIn`, `clipsFor`, `gameClips`, `canAddThing`, getter `maxThings`, and `setOccupancy(fn)` / getter `occupancy`: `fn(placeId)` returns where that place's things stand now (spread boxes) or null; the play engine sets it, and `copyThing` and `addThing` with `spot: "free"` pass its answer as `occupied` unless the caller gave one (a throwing occupancy falls back to the saved positions).

`farm/legs.js`: hips are board points inside the outline. A leg hangs straight down; its foot is `legLength(outline)` (0.35 of the thing's height, clamped to 8..34 px of a 600 px board) below the first edge under the hip (`edgeBelow`, `footY`). `spreadLegs(outline, n)` places n hips across the middle of the bottom, `HIP_INSET` above the edge. `legacyLegCount(motion)`: walk 2, scuttle 6, others 0, `params["legs.count"]` wins.

`farm/library.js` (pure):
- `thingKey(thing)`: the thing's names, colour, motion preset, cues, and outline, eyes and legs relative to the outline's box corner. Position and id do not count, so a copy has its original's key until either is changed. Its look alone (all but the names) is what folds a family's thing into an example.
- `libraryEntries(s, examples)` returns `{own, examples}` of `{key, thing, clips, example}`: own things in place then drawing order, one per key (the one with most clips); an own thing with no clips that is an untouched copy of an example (the same look, and each of its names is the example's name in that language) is listed only as the example, so a starter thing from an older build, which lacks the languages added since (QA round 3 added `fi`), is still listed and seeded once; a renamed thing, or one with a name in a language the example lacks, is the family's own; examples one per key.
- `copyOf(thing, clips, {placeId, dx, dy}, env)`: a deep copy with fresh ids and dates, moved; only clips whose `thingId` is the thing's, each with a fresh id and its own `createdAt`.
- `pickSeeds(pool, n, rng)` (partial Fisher-Yates, input untouched), `seedCount(cap, poolSize, rng)`.

`farm/palette.js`: `SUNNY`, `THING_COLORS`, `SKY_COLORS`, `GROUND_COLORS`, `SIMPLE_COLORS` (the 11 colour words the colour game uses; a one-way door, colour word clips store them; `play/colors.js` folds felt keys into them), `isColorKey(key)`, `hex(key)` (unknown keys fall back to grey). `SKY_COLORS` (11) and `GROUND_COLORS` (12) are the preset swatches; format 5 added the keys `mint`, `peach`, `dusk`, `storm`, `night`, `moss`, `clay`, `mud` and `snow`. Sky and ground also take any colour: `isCustomColor(v)` (lowercase `#rrggbb`), `isSceneColor(v)` (a key or a custom colour), `sceneColor(v, presets)` (the stored form of a picker value: lowercased, and a preset's own hex becomes that key; null when invalid), `sceneHex(v)` (what to paint). `updatePlace` and `createPlace` store sky and ground through `sceneColor` and throw `invalid` otherwise.

`farm/scripts.js`: `scriptFileFor(files, lang)` (exact tag, then base language, then English with `fallback: true`), `fillTemplate(t, {name, article})` (`{the}` dropped with its space when empty), `askLines(files, thing, lang)` returns `{lines, fallback, articles}` (every template with the typed name and chosen article: what the device voice may ask when the family's find question or the thing's name is not recorded in that language), `findQuestionText(files, lang)` (what to say when recording the find question, the script's `findQuestion`, "Where is the…"), `colorLine(files, group, lang, n)` (the device voice's "Tap on an animal that is yellow!"), `colorQuestionText(files, lang)` (what to say when recording the colour question, the script's `colorQuestion`), `colorWord(files, group, lang)` (null without a script). Script files hold `templates`, `articles`, `findQuestion`, `colorQuestion`, `colorTemplates` (with `{color}`) and `colors` (the word as it fits after the question).

`farm/import.js`: `checkImport({manifestText, blobs}, {createdAt})` returns `{snapshot, blobs, counts}` or throws `ImportError` with `code` `not-a-farm`, `newer` or `corrupt` and a `parentMessage`. The caller (`io/share.js`) unzips and recomputes every blob's SHA-256. Also `MANIFEST`, `BLOB_DIR`, `blobPath`, `exportName`, `countsOf`.

## How it fits

- `farm/` is a pure domain. It imports only other pure domains (`farm geometry motion play edit dsp`) and `types.js`. No DOM, browser globals, `Date.now`, `new Date()`, `Math.random`, `crypto`, timers or `fetch`. `tests/unit/boundaries.test.js` enforces this. `Date.parse` in validation is allowed.
- `farm-store.js` sits outside the pure folder. It imports `farm/intents.js` and `farm/snapshot.js` and talks to a `Repository` (`io/idb-repo.js` in the app, `io/memory-repo.js` in tests).
- Callers: `main.js` builds the store; components call store intents and never mutate snapshots; `play-engine.js` reads via the store and uses `tapClips`, `playLanguageFor` and `scripts.js`; `io/share.js` uses `import.js`, `snapshot.js` and `intents.js`; `io/starter.js` uses `defaultSettings`; `io/renderer.js`, `io/felt.js` and parent previews use `palette.js` and `legs.js`.

## Rules and gotchas

- Only `FarmStore` holds the live snapshot. Add new mutations as pure intents in `intents.js` plus a one-line method on `FarmStore`.
- Intents run strictly one at a time (`_serial`), so each sees the previous result even when callers do not await.
- Formats are additive, except where a feature is withdrawn on purpose. Format history: 1 first release; 2 optional `Place.findIt`; 3 `Thing.legs`; 4 `Settings.maxThings`, 1 to 6 questions and prompt takes, colour game clips (`thingId` null); 5 new palette keys and custom sky and ground colours (`#rrggbb`), nothing to migrate. Format 5 was readable by nothing older; 6 the find question is the family's (`find-question` game clips, played with the thing's recorded name, like the colour game), and per-thing questions are discarded on migrate (`prompt` clips and `Cue.lines`; their blobs are not imported and are swept from storage as orphans). `minReaderFormat` is 6: a format 5 app would call a `find-question` clip damaged, so it says "made by a newer version" instead. Files of formats 1 to 5 still import. `FarmStore.hydrate` writes back what the migration dropped or changed (never waited on), so stored per-thing questions really go.
- Format bump procedure:
  1. Raise `FORMAT_VERSION` in `farm/snapshot.js` and add a comment line to its format history.
  2. Add a `STEPS[old]` entry that moves `formatVersion` up by one. Steps must be pure and safe on mixed data.
  3. Decide `MIN_READER_FORMAT`. Raise it only when older apps cannot read the new shape.
  4. Update `storedFormat()` (in `farm/snapshot.js`, called by `FarmStore.hydrate`) if records read back from IndexedDB need detecting. Today it tells format 2 (things without legs), 3 (settings without `maxThings`) and 5 or older (a `prompt` clip or a cue with `lines`) from 6; format 4 records are otherwise valid format 5 records.
  5. Update `validateSnapshot`, `types.js`, `tests/builders.js` (`aSnapshot` stamps `formatVersion`), and `snapshot.test.js` migration tests.
  6. Never regenerate `tests/fixtures/exports/v1/basic.zip`, `v3/basic.zip` (written once by the format 3 build, with an edited cue line and a take 3 prompt) or `v4/basic.zip` (written once by the format 4 build: the v3 farm with a lilac sky and sand ground, exported again). They must keep importing to their `basic.expected.json`; update an expected file only if the migration intentionally adds fields (format 4 added `settings.maxThings: 8`; format 6 removed the cue lines and prompt clips).
  7. Regenerate the starter with `node tools/make-starter.mjs` (`--check` exits 1 when out of date; `web/js/io/starter.test.js` checks it).
- Palette keys and clip key fields are one-way doors: never rename or remove them.
- Blobs are content addressed: copies made by `copyThing` or seeding share their original's blobs through their own clip records. The orphan sweep keeps a blob while any clip uses it, so deleting the original never breaks a copy.
- Deleting a thing or place leaves blobs; the orphan sweep removes blobs older than 24 h, which is what lets Undo restore clips.
- `addThing` and `updateThing` keep at most 2 eyes and 8 legs, rounded to 3 decimals.
- Lowering `settings.maxThings` below a scene's count keeps every thing; `canAddThing` (and Undo of a delete) refuses until the scene is under the cap again.
- `migrate` keeps a newer readable file's `formatVersion`; `exportSnapshot` restamps it with this app's version.
- `motion.preset` is validated only as a string. `MOTION_PRESETS` lists the shipped presets (walk, hop, scuttle, float, swim), the same as `motion/pose.js` `PRESET_IDS`.

## Tests

- `web/js/farm/*.test.js`: snapshot validation, canonical form, migration 1 to 2 to 3 to 4 to 5 to 6, custom sky and ground colours, `storedFormat`, leg, `maxThings`, cue and find game clip validation; intents (purity, things-per-scene cap, clip replacement, colour game clips, find question and colour game clips, cascades, undo, settings language rules, legs); legs geometry; scripts filling and fallback; import checks.
- `tests/unit/farm-store.test.js`: hydrate, one synchronous change per intent before the commit, invalid input, failed writes (rollback, dropped later intents), pending blobs, call order, `replaceAll` (and intents during it), every intent wrapper surviving a reload.
- `tests/unit/export-fixture.test.js`: the frozen v1, v3 and v4 exports still import (to format 6, the v3 and v4 files' cue lines and prompts discarded); a stored format 5 or older farm hydrates without its per-thing questions and writes that back.
- `tests/contracts/repository.contract.js`: also colour game clips (null `thingId`) and renumbered takes in one batch.
- `web/js/farm/library.test.js` (keys, entries and folding, older starter things, copies keeping clip dates, seeds), `web/js/farm/copy-intents.test.js` (`copyThing` and seeded `createPlace`: ids, clip copies, limits, placement, rng), `tests/unit/library-store.test.js` (through `FarmStore` and `MemoryRepo`: shows at once, persists, a copy's blob survives deleting the original and the sweep; the occupancy is asked by copies and free-spot adds), `web/js/io/library-data.test.js` (the starter before Finnish names folds and never seeds twice).
- `tests/unit/find-it.test.js`: `findIt` default on, off per place.
- `tests/browser/legs.test.js`: legs through guided add and reload; format 2 records get preset legs.
- Shared builders: `tests/builders.js` (`fixedEnv`, `aSnapshot`, `aPlace`, `aThing`, `aClip`, `aBlob`, `square`).
