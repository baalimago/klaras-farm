// Test builders: valid entities and snapshots with fixed ids and times.
// aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build()

export function fixedEnv({ start = Date.UTC(2026, 10, 3, 12, 0, 0), seed = 1, prefix = "id" } = {}) {
  let t = start;
  let n = 0;
  let s = seed >>> 0 || 1;
  return {
    now: () => new Date((t += 1000)).toISOString(),
    rng: () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32),
    newId: () => `${prefix}-${String(++n).padStart(4, "0")}`,
    deviceId: "device-test",
  };
}

const T0 = "2026-11-03T12:00:00.000Z";
const SHA = (n) => n.toString(16).padStart(64, "0");
let counter = 0;
const next = (p) => `${p}-${String(++counter).padStart(3, "0")}`;

export const square = (cx = 0.5, cy = 0.6, r = 0.1) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];

export function aClip(fields = {}) {
  const c = {
    id: next("clip"), thingId: "", language: "en", kind: "name", take: 1,
    blobSha256: SHA(++counter), mime: "audio/mp4", durationMs: 800, trimStartMs: 40, trimEndMs: 760, gainDb: 3, createdAt: T0,
    ...fields,
  };
  return { build: () => ({ ...c }), with: (f) => aClip({ ...c, ...f }) };
}

export function aThing(fields = {}) {
  const t = {
    id: next("thing"), placeId: "", names: { en: "Pig" }, outline: square(), color: "pink", eyes: [{ x: 0.55, y: 0.55 }],
    legs: [{ x: 0.45, y: 0.59 }, { x: 0.55, y: 0.59 }],
    motion: { kind: "preset", preset: "walk", params: {} }, cues: {}, createdAt: T0, updatedAt: T0, ...fields,
  };
  const clips = [];
  const api = {
    withClip(b) { clips.push(b); return api; },
    build() { return { thing: { ...t }, clips: clips.map((b) => ({ ...b.build(), thingId: t.id })) }; },
  };
  return api;
}

export function aPlace(fields = {}) {
  const p = { id: next("place"), name: "Farm", backdrop: "meadow", skyColor: "sky", groundColor: "grass", pieces: [], thingOrder: [], createdAt: T0, updatedAt: T0, ...fields };
  const things = [];
  const api = {
    withThing(b) { things.push(b); return api; },
    withPiece(piece) { p.pieces = [...p.pieces, { id: next("piece"), kind: "shape", color: "red", stroke: square(0.2, 0.5, 0.05), ...piece }]; return api; },
    build() {
      const built = things.map((b) => b.build());
      for (const x of built) x.thing.placeId = p.id;
      return { place: { ...p, thingOrder: built.map((x) => x.thing.id) }, things: built.map((x) => x.thing), clips: built.flatMap((x) => x.clips) };
    },
  };
  return api;
}

export function aSnapshot(fields = {}) {
  const places = [];
  const api = {
    withPlace(b) { places.push(b); return api; },
    build() {
      const built = places.map((b) => b.build());
      return {
        formatVersion: 3, minReaderFormat: 1, appVersion: "test", exportedAt: T0, deviceId: "device-test",
        settings: { languages: ["en"], playLanguage: "en", sleepMinutes: 8, gateKind: "keypad", reduceMotion: false, currentPlaceId: built[0]?.place.id ?? null, welcomed: true, updatedAt: T0 },
        places: built.map((x) => x.place),
        things: built.flatMap((x) => x.things),
        clips: built.flatMap((x) => x.clips),
        ...fields,
      };
    },
  };
  return api;
}

export function aBlob(sha256, bytes = new Uint8Array([1, 2, 3]).buffer) {
  return { sha256, mime: "audio/mp4", size: bytes.byteLength, createdAt: T0, bytes };
}
