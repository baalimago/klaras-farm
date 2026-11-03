// Import checks for an export file (ARCHITECTURE §9.4), pure. io/share.js unzips the file and
// recomputes every blob's SHA-256 (device work); this module decides whether the result is a farm
// this app can take: schema, minReaderFormat, hashes, every clip resolves, no duplicate clip keys.
import { FORMAT_VERSION, migrate, validateSnapshot } from "./snapshot.js";

export const MANIFEST = "manifest.json";
export const BLOB_DIR = "blobs/";
const SHA_RE = /^[0-9a-f]{64}$/;

const MESSAGES = {
  "not-a-farm": "This file isn't a Klara's Farm export. Nothing was changed.",
  newer: "This file was made by a newer version of Klara's Farm. Update the app, then try again. Nothing was changed.",
  corrupt: "This file is damaged and can't be imported. Nothing was changed.",
};

export class ImportError extends Error {
  /** @param {'corrupt'|'newer'|'not-a-farm'} code @param {string} detail */
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ImportError";
    this.code = code;
    this.detail = detail;
    this.parentMessage = MESSAGES[code] ?? MESSAGES.corrupt;
  }
}

/** Zip entry name of a blob. */
export const blobPath = (sha256) => `${BLOB_DIR}${sha256}`;

/** File name of an export made at `iso` (UTC date). */
export const exportName = (iso) => `klaras-farm-${String(iso).slice(0, 10)}.zip`;

/** @param {{places:any[], things:any[], clips:any[]}} s */
export function countsOf(s) {
  return { places: s.places.length, things: s.things.length, clips: s.clips.length };
}

/**
 * @param {{manifestText: string|null, blobs: {path: string, sha256: string, size: number}[]}} input
 *   manifestText: the manifest.json entry as text (null when absent);
 *   blobs: every zip entry, with `sha256` recomputed from its bytes by the caller
 * @param {{createdAt: string}} opts  createdAt for the BlobRecords (the caller's clock)
 * @returns {{snapshot: import('../types.js').Snapshot,
 *            blobs: {sha256: string, mime: string, size: number, createdAt: string}[],
 *            counts: {places: number, things: number, clips: number}}}
 * @throws {ImportError}
 */
export function checkImport(input, { createdAt }) {
  if (typeof input?.manifestText !== "string") throw new ImportError("not-a-farm", "no manifest.json");
  let raw;
  try {
    raw = JSON.parse(input.manifestText);
  } catch {
    throw new ImportError("not-a-farm", "manifest.json is not JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Number.isInteger(raw.formatVersion) || !("places" in raw))
    throw new ImportError("not-a-farm", "manifest.json is not a farm snapshot");
  if (Number.isInteger(raw.minReaderFormat) && raw.minReaderFormat > FORMAT_VERSION)
    throw new ImportError("newer", `needs reader format ${raw.minReaderFormat}, this app reads ${FORMAT_VERSION}`);

  const sizes = new Map();
  for (const entry of input.blobs ?? []) {
    if (!entry.path.startsWith(BLOB_DIR)) continue;
    const name = entry.path.slice(BLOB_DIR.length);
    if (!SHA_RE.test(name) || name !== entry.sha256) throw new ImportError("corrupt", `blob ${name}: hash mismatch`);
    sizes.set(name, entry.size);
  }

  const snapshot = migrate(raw);
  const check = validateSnapshot(snapshot, { blobShas: new Set(sizes.keys()) });
  if (!check.ok) throw new ImportError("corrupt", check.error);

  const mimes = new Map();
  for (const c of snapshot.clips) if (!mimes.has(c.blobSha256)) mimes.set(c.blobSha256, c.mime);
  const blobs = [...mimes].map(([sha256, mime]) => ({ sha256, mime, size: sizes.get(sha256), createdAt }));
  return { snapshot, blobs, counts: countsOf(snapshot) };
}
