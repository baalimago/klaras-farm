import { test } from "node:test";
import assert from "node:assert/strict";
import * as I from "./intents.js";
import { validateSnapshot, emptySnapshot } from "./snapshot.js";
import { aSnapshot, aPlace, aThing, aClip, aBlob, fixedEnv, square } from "../../../tests/builders.js";

const env = () => fixedEnv();
const valid = (s) => assert.deepEqual(validateSnapshot(s), { ok: true });

test("createPlace adds a place, makes it current, and writes both", () => {
  const r = I.createPlace(emptySnapshot(env()), { name: " Grandma's garden ", backdrop: "meadow" }, env());
  valid(r.snapshot);
  assert.equal(r.snapshot.places[0].name, "Grandma's garden");
  assert.equal(r.snapshot.settings.currentPlaceId, r.snapshot.places[0].id);
  assert.deepEqual(r.writes.map((w) => w.store), ["places", "settings"]);
  assert.equal(r.change.kind, "place-created");
});

test("intents never mutate their input", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing())).build();
  const frozen = JSON.stringify(s);
  I.updateThing(s, { thingId: s.things[0].id, patch: { color: "blue" } }, env());
  I.deleteThing(s, { thingId: s.things[0].id }, env());
  assert.equal(JSON.stringify(s), frozen);
});

test("addThing enforces the cap of 4 and attaches clips", () => {
  let s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const e = env();
  for (let i = 0; i < 4; i++) s = I.addThing(s, { placeId, outline: square(), color: "red", clips: i === 0 ? [aClip().build()] : [] }, e).snapshot;
  valid(s);
  assert.equal(s.places[0].thingOrder.length, 4);
  assert.equal(s.clips[0].thingId, s.things[0].id);
  assert.equal(I.canAddThing(s, placeId), false);
  assert.throws(() => I.addThing(s, { placeId, outline: square(), color: "red" }, e), { code: "place-full" });
});

test("updateThing keeps recordings when redrawing and rejects unknown colours", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build();
  const id = s.things[0].id;
  const r = I.updateThing(s, { thingId: id, patch: { outline: square(0.3, 0.3, 0.05), names: { en: "Hog" } } }, env());
  assert.equal(r.snapshot.clips.length, 1);
  assert.equal(r.snapshot.things[0].names.en, "Hog");
  assert.throws(() => I.updateThing(s, { thingId: id, patch: { color: "neon" } }, env()), { code: "invalid" });
});

test("deleteThing removes clips and carries what restoreThing needs to undo", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing()).withThing(aThing().withClip(aClip()))).build();
  const id = s.things[1].id;
  const del = I.deleteThing(s, { thingId: id }, env());
  valid(del.snapshot);
  assert.equal(del.snapshot.clips.length, 0);
  const undo = I.restoreThing(del.snapshot, del.change.removed, env());
  valid(undo.snapshot);
  assert.deepEqual(undo.snapshot.places[0].thingOrder, s.places[0].thingOrder);
  assert.equal(undo.snapshot.clips.length, 1);
});

test("saveClip replaces a clip with the same key, deleting the old record in the same batch", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build();
  const old = s.clips[0];
  const { id, createdAt, ...rest } = old;
  const sha = "e".repeat(64);
  const r = I.saveClip(s, { clip: { ...rest, blobSha256: sha }, blob: aBlob(sha) }, env());
  valid(r.snapshot);
  assert.equal(r.snapshot.clips.length, 1);
  assert.equal(r.snapshot.clips[0].blobSha256, sha);
  assert.deepEqual(r.writes.map((w) => `${w.store}:${w.op}`), ["blobs:put", "clips:delete", "clips:put"]);
});

test("deletePlace removes its things and clips and moves the current place", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).withPlace(aPlace()).build();
  const r = I.deletePlace(s, { placeId: s.places[0].id }, env());
  valid(r.snapshot);
  assert.deepEqual([r.snapshot.things.length, r.snapshot.clips.length], [0, 0]);
  assert.equal(r.snapshot.settings.currentPlaceId, s.places[1].id);
});

test("scene pieces: add, paint, move, remove", () => {
  const s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const e = env();
  let r = I.addPiece(s, { placeId, piece: { kind: "yarn", stroke: [[0.1, 0.1], [0.2, 0.2]], color: "brown" } }, e);
  const pieceId = r.snapshot.places[0].pieces[0].id;
  r = I.updatePiece(r.snapshot, { placeId, pieceId, patch: { color: "leaf", stroke: [[0.3, 0.3], [0.4, 0.4]] } }, e);
  assert.equal(r.snapshot.places[0].pieces[0].color, "leaf");
  valid(r.snapshot);
  r = I.removePiece(r.snapshot, { placeId, pieceId }, e);
  assert.equal(r.snapshot.places[0].pieces.length, 0);
  assert.throws(() => I.addPiece(s, { placeId, piece: { kind: "shape", stroke: [[0, 0]], color: "red" } }, e), { code: "invalid" });
});

test("settings keep playLanguage consistent with languages", () => {
  const s = aSnapshot().withPlace(aPlace()).build();
  const r = I.updateSettings(s, { patch: { languages: ["sv", "de"] } }, env());
  assert.equal(r.snapshot.settings.playLanguage, "sv");
  assert.throws(() => I.updateSettings(s, { patch: { languages: [] } }, env()));
});

test("tapClips plays the name then the sound, falling back to another language", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip({ language: "sv" })).withClip(aClip({ kind: "sound", language: "sv" })))).build();
  const t = s.things[0].id;
  assert.deepEqual(I.tapClips(s, t, "en").map((c) => c.kind), ["name", "sound"]);
});

test("playLanguageFor: fixed language, or a random pick among recorded languages when mixing", () => {
  const mix = { playLanguage: "alternate", languages: ["sv", "en", "de"] };
  assert.equal(I.playLanguageFor({ playLanguage: "sv", languages: ["sv", "en"] }, { rng: () => 0.9 }), "sv");
  assert.equal(I.playLanguageFor(mix, { rng: () => 0 }), "sv");
  assert.equal(I.playLanguageFor(mix, { rng: () => 0.99 }), "de");
  assert.equal(I.playLanguageFor(mix, { available: ["en", "de"], rng: () => 0 }), "en", "skips languages with no recording");
  assert.equal(I.playLanguageFor(mix, { available: ["en", "de"], rng: () => 0.99 }), "de");
  assert.equal(I.playLanguageFor(mix, { available: ["fr"], rng: () => 0.5 }), "en", "nothing recorded in the family's languages: any of them");
});
