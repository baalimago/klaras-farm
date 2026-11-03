// Shared JSDoc types. This file is the contract between domains; it has no runtime code.
// Coordinates: the board is 4:3. Points are [x, y] with x in 0..1 (left→right) and
// y in 0..1 (top→bottom) of the board, rounded to 3 decimals when stored.

/** @typedef {[number, number]} Point */

/** Palette keys from web/js/farm/palette.js, e.g. "red", "sky". Never hex in data. @typedef {string} ColorKey */

/** BCP 47 language tag, e.g. "sv", "en", "de". @typedef {string} Lang */

/**
 * @typedef {Object} Piece  A felt piece or yarn line in a place's scene.
 * @property {string} id
 * @property {'shape'|'yarn'} kind
 * @property {Point[]} stroke   shape: closed outline; yarn: open polyline
 * @property {ColorKey} color
 */

/**
 * @typedef {Object} Place
 * @property {string} id
 * @property {string} name                 parent-only text
 * @property {'meadow'|'sea'|'room'|'blank'} backdrop
 * @property {ColorKey} skyColor
 * @property {ColorKey} groundColor
 * @property {Piece[]} pieces               drawing order
 * @property {string[]} thingOrder          thing ids, drawing order (back to front)
 * @property {string} createdAt             ISO 8601
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Eye
 * @property {number} x   board coordinates, inside the outline
 * @property {number} y
 */

/**
 * @typedef {Object} Leg   Where a felt leg attaches (its hip). Legs always hang straight down.
 * @property {number} x   board coordinates, inside the outline (usually near its bottom)
 * @property {number} y
 */

/**
 * @typedef {Object} PresetMotion
 * @property {'preset'} kind
 * @property {string} preset                   id of web/data/motions/<id>.json ("walk", "float")
 * @property {Object<string, number>} params    dotted overrides, e.g. {"travel.speed": 0.8}
 */
/** @typedef {PresetMotion} Motion */

/**
 * @typedef {Object} Cue   The parent's edits to the "Where is the…" scripts for one language.
 * @property {string[]=} lines     overrides for the 3 filled lines (cue text only)
 * @property {string=} article     chosen article for languages that need one (der/die/das)
 */

/**
 * @typedef {Object} Thing
 * @property {string} id
 * @property {string} placeId
 * @property {Object<Lang, string>} names    typed names, parent-only
 * @property {Point[]} outline               closed polygon, board coordinates, where it was drawn
 * @property {ColorKey} color
 * @property {Eye[]} eyes                     0–2
 * @property {Leg[]} legs                     0–8 (format 3; older files get their preset's legs on migrate)
 * @property {Motion} motion
 * @property {Object<Lang, Cue>} cues
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Clip
 * @property {string} id
 * @property {string} thingId
 * @property {Lang} language
 * @property {'name'|'prompt'|'sound'} kind
 * @property {number} take             1 for name/sound; 1–3 for prompt
 * @property {string} blobSha256
 * @property {string} mime
 * @property {number} durationMs
 * @property {number} trimStartMs
 * @property {number} trimEndMs
 * @property {number} gainDb
 * @property {string} createdAt
 */

/**
 * @typedef {Object} BlobRecord
 * @property {string} sha256
 * @property {string} mime
 * @property {number} size
 * @property {string} createdAt
 * @property {ArrayBuffer} bytes
 */

/**
 * @typedef {Object} Settings
 * @property {Lang[]} languages          languages the family records in, first = default
 * @property {Lang|'alternate'} playLanguage  'alternate' = random language per tap ("Mix languages")
 * @property {number} sleepMinutes       0 = off
 * @property {'keypad'|'sum'} gateKind
 * @property {boolean} reduceMotion
 * @property {string|null} currentPlaceId
 * @property {boolean} welcomed          first-run card dismissed
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Snapshot   Format version 1. Also the export manifest.
 * @property {number} formatVersion
 * @property {number} minReaderFormat
 * @property {string} appVersion
 * @property {string} exportedAt
 * @property {string} deviceId
 * @property {Settings} settings
 * @property {Place[]} places
 * @property {Thing[]} things
 * @property {Clip[]} clips
 */

/**
 * @typedef {Object} Draft   Add-a-thing progress. Not exported.
 * @property {string} id
 * @property {string} placeId
 * @property {number} step            index into GUIDED_STEPS
 * @property {Partial<Thing>} thing   fields collected so far
 * @property {Clip[]} clips           clips recorded so far (their blobs are already stored)
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Env   Passed into pure functions. Tests pass fixed values.
 * @property {() => string} now        ISO timestamp
 * @property {() => number} rng        0 ≤ x < 1
 * @property {() => string} newId      UUID
 * @property {string} deviceId
 */

/**
 * A storage write, produced by pure intents and applied atomically by a Repository.
 * @typedef {{store:'places'|'things'|'clips'|'settings'|'blobs'|'drafts'|'meta', op:'put', value:any}
 *         | {store:'places'|'things'|'clips'|'blobs'|'drafts'|'meta', op:'delete', key:string}} Write
 */

/**
 * @typedef {Object} Repository   The only port. io/idb-repo.js and io/memory-repo.js implement it and
 * pass tests/contracts/repository.contract.js.
 * @property {() => Promise<{places:Place[], things:Thing[], clips:Clip[], settings:Settings|null, meta:Object<string, any>}>} load
 * @property {(writes: Write[]) => Promise<void>} write        one transaction, all or nothing
 * @property {(sha256: string) => Promise<BlobRecord|null>} getBlob
 * @property {() => Promise<string[]>} listBlobShas
 * @property {() => Promise<Draft[]>} listDrafts
 * @property {(snapshot: Snapshot, blobs: BlobRecord[]) => Promise<void>} replaceAll   import: one transaction
 * @property {(olderThanIso: string) => Promise<number>} sweepOrphanBlobs
 * @property {() => Promise<void>} clear
 * @property {() => void} close
 */

/**
 * Live state of one thing in play (PlayEngine, memory only). Renderer reads it.
 * @typedef {Object} Actor
 * @property {string} thingId
 * @property {number} x                 board coords of the thing's anchor (outline centroid)
 * @property {number} y
 * @property {number} facing            1 right, -1 left
 * @property {number} t                 seconds of motion time (advances only while moving)
 * @property {'idle'|'moving'|'react'|'wiggle'|'sleep'|'drop'} state
 * @property {number} stateTime         seconds in current state
 * @property {Pose} pose                computed each step
 */

/**
 * Output of motion/pose.js. Applied by the renderer to the cached sprite; never changes data.
 * @typedef {Object} Pose
 * @property {number} dx          offset in board units
 * @property {number} dy
 * @property {number} rot         radians
 * @property {number} sx          scale x (squash/stretch)
 * @property {number} sy
 * @property {number[]} legs      leg swing angles in radians, one per Thing.legs entry
 * @property {number} eyeOpen     0 closed … 1 open
 */

export {};
