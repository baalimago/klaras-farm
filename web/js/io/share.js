// Export and import of the whole farm as one zip (ARCHITECTURE §9.4, US-8.3).
//   manifest.json   canonical snapshot (sorted keys, entity arrays in id order)
//   blobs/<sha256>  raw recording bytes
// Stored, not compressed: the audio is already compressed. Import is
// validate → migrate → back up → replace → verify; any rejection leaves storage untouched.
import { zipSync, unzipSync, strToU8, strFromU8 } from "../../vendor/fflate.js";
import { canonicalJson, canonicalSnapshot } from "../farm/snapshot.js";
import { checkImport, countsOf, blobPath, exportName, ImportError, MANIFEST } from "../farm/import.js";
import { FarmError } from "../farm/intents.js";
import { sha256Hex } from "./sha.js";
import { isStandalone } from "./storage.js";

export { ImportError };

export const BACKUP_KEY = "preImport";
const undoable = new WeakSet(); // stores that imported during this boot: "Undo import" until the next boot

/**
 * Builds the export file. Call it when the export screen opens, so sharing keeps the user gesture.
 * Clips whose recording is missing are left out (counted in `missingBlobs`), so the file always imports.
 * @param {import('../farm-store.js').FarmStore} store
 * @returns {Promise<{file: File, name: string, bytes: ArrayBuffer,
 *   counts: {places: number, things: number, clips: number, blobs: number, missingBlobs: number, bytes: number}}>}
 */
export async function buildExport(store) {
  const snap = canonicalSnapshot(store.exportSnapshot());
  const shas = [...new Set(snap.clips.map((c) => c.blobSha256))];
  const records = await Promise.all(shas.map((sha) => store.getBlob(sha)));
  const present = new Map();
  shas.forEach((sha, i) => records[i]?.bytes && present.set(sha, new Uint8Array(records[i].bytes)));
  const clips = snap.clips.filter((c) => present.has(c.blobSha256));
  const manifest = { ...snap, clips };

  const mtime = new Date(Math.max(Date.parse(manifest.exportedAt) || 0, Date.UTC(1980, 1, 1)));
  const entries = { [MANIFEST]: strToU8(canonicalJson(manifest)) };
  for (const [sha, u8] of present) entries[blobPath(sha)] = u8;
  const zipped = zipSync(entries, { level: 0, mtime });
  const bytes = toArrayBuffer(zipped);
  const name = exportName(manifest.exportedAt);
  const file = new File([bytes], name, { type: "application/zip" });
  return {
    file,
    name,
    bytes,
    counts: { ...countsOf(manifest), blobs: present.size, missingBlobs: snap.clips.length - clips.length, bytes: file.size },
  };
}

/**
 * Opens the share sheet with the file. Falls back to a download link only outside the Home Screen
 * app (where `<a download>` can navigate away).
 * @returns {Promise<'shared'|'cancelled'|'downloaded'|'unsupported'>}
 */
export async function shareFile(file) {
  const data = { files: [file], title: "Klara's Farm" };
  if (typeof navigator !== "undefined" && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
      if (isStandalone()) throw e;
    }
  }
  if (isStandalone() || typeof document === "undefined") return "unsupported";
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}

/**
 * Unzips, recomputes every blob's hash and runs the pure import checks. Writes nothing.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{now?: string}} [opts]  createdAt for the blob records
 * @returns {Promise<{snapshot: import('../types.js').Snapshot, blobs: import('../types.js').BlobRecord[],
 *   counts: {places: number, things: number, clips: number}}>}
 * @throws {ImportError}
 */
export async function readImport(buffer, { now = new Date().toISOString() } = {}) {
  let entries;
  try {
    entries = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), { filter: (f) => !f.name.endsWith("/") });
  } catch (e) {
    throw new ImportError("not-a-farm", `not a zip file (${e?.message ?? e})`);
  }
  const names = Object.keys(entries);
  const hashed = await Promise.all(
    names.filter((n) => n.startsWith("blobs/")).map(async (path) => ({ path, sha256: await sha256Hex(entries[path]), size: entries[path].byteLength })),
  );
  let manifestText = null;
  if (entries[MANIFEST]) {
    try {
      manifestText = strFromU8(entries[MANIFEST]);
    } catch {
      throw new ImportError("not-a-farm", "manifest.json is not text");
    }
  }
  const { snapshot, blobs, counts } = checkImport({ manifestText, blobs: hashed }, { createdAt: now });
  return { snapshot, blobs: blobs.map((b) => ({ ...b, bytes: toArrayBuffer(entries[blobPath(b.sha256)]) })), counts };
}

/**
 * Replaces everything on the device with the file's farm, after writing a backup of the current
 * farm to meta (offered as "Undo import" until the next boot). Rejects with ImportError for a bad
 * file and FarmError('storage'|'quota') when storage fails; in both cases nothing was replaced.
 * @returns {Promise<{places: number, things: number, clips: number}>}
 */
export async function importReplacing(store, buffer) {
  const incoming = await readImport(buffer);
  const backup = await buildExport(store);
  await store.setMeta(BACKUP_KEY, backup.bytes);
  await replaceVerified(store, incoming, backup.bytes);
  undoable.add(store);
  return incoming.counts;
}

/** True while the pre-import backup from this boot's import can be restored. */
export function canUndoImport(store) {
  return undoable.has(store) && store.meta?.[BACKUP_KEY] != null;
}

/** Restores the farm as it was before this boot's import. */
export async function undoImport(store) {
  const bytes = store.meta?.[BACKUP_KEY];
  if (!bytes) throw new FarmError("storage", "no import to undo");
  const previous = await readImport(bytes);
  await replaceVerified(store, previous, null);
  await discardImportBackup(store);
}

/** Drops the pre-import backup (e.g. at the next boot). */
export async function discardImportBackup(store) {
  undoable.delete(store);
  if (store.meta?.[BACKUP_KEY] != null) await store.setMeta(BACKUP_KEY, null);
}

// ---- internals ----

/** Replace, then verify against what the repository reads back; on a mismatch, restore `backupBytes`. */
async function replaceVerified(store, { snapshot, blobs }, backupBytes) {
  await store.replaceAll(snapshot, blobs);
  const shas = new Set(await store.repo.listBlobShas());
  const ok = entityJson(store.snapshot) === entityJson(snapshot) && blobs.every((b) => shas.has(b.sha256));
  if (ok) return;
  if (backupBytes) {
    const previous = await readImport(backupBytes);
    await store.replaceAll(previous.snapshot, previous.blobs);
  }
  throw new FarmError("storage", "import did not read back as written");
}

function entityJson(s) {
  const c = canonicalSnapshot(s);
  return canonicalJson({ settings: c.settings, places: c.places, things: c.things, clips: c.clips });
}

function toArrayBuffer(u8) {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer;
}
