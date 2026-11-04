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

test("addThing enforces the family's things-per-scene cap (default 8) and attaches clips", () => {
  let s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const e = env();
  assert.equal(I.maxThings(s), 8);
  for (let i = 0; i < 8; i++) s = I.addThing(s, { placeId, outline: square(), color: "red", clips: i === 0 ? [aClip().build()] : [] }, e).snapshot;
  valid(s);
  assert.equal(s.places[0].thingOrder.length, 8);
  assert.equal(s.clips[0].thingId, s.things[0].id);
  assert.equal(I.canAddThing(s, placeId), false);
  assert.throws(() => I.addThing(s, { placeId, outline: square(), color: "red" }, e), { code: "place-full", message: /at most 8/ });
});

test("maxThings is a setting from 1 to 12; lowering it keeps the things and only stops adding", () => {
  let s = aSnapshot().withPlace(aPlace().withThing(aThing()).withThing(aThing()).withThing(aThing())).build();
  const placeId = s.places[0].id;
  s = I.updateSettings(s, { patch: { maxThings: 2 } }, env()).snapshot;
  valid(s);
  assert.equal(s.things.length, 3);
  assert.equal(I.canAddThing(s, placeId), false);
  assert.throws(() => I.restoreThing(s, I.deleteThing(s, { thingId: s.things[0].id }, env()).change.removed, env()), { code: "place-full" });
  s = I.updateSettings(s, { patch: { maxThings: 12 } }, env()).snapshot;
  assert.equal(I.canAddThing(s, placeId), true);
  for (const bad of [0, 13, 1.5, "4", null]) assert.throws(() => I.updateSettings(s, { patch: { maxThings: bad } }, env()), { code: "invalid" }, String(bad));
  assert.equal(I.maxThings({ settings: {} }), 8, "missing (never stored) means the default");
});

// ---------- questions ----------

const promptsOf = (s, id, language = "en") => I.clipsFor(s, id, { kind: "prompt", language }).map((c) => [c.take, c.id]);

test("questions: add up to 6, edit free text (empty is the example), remove down to 1", () => {
  let s = aSnapshot().withPlace(aPlace().withThing(aThing())).build();
  const thingId = s.things[0].id;
  s = I.setQuestionLine(s, { thingId, language: "en", index: 1, text: "  Where is our piggy?  " }, env()).snapshot;
  assert.deepEqual(s.things[0].cues.en.lines, ["", "Where is our piggy?", ""], "starts from the 3 examples");
  for (let i = 0; i < 3; i++) s = I.addQuestion(s, { thingId, language: "en", text: i === 0 ? "Peekaboo pig?" : "" }, env()).snapshot;
  assert.equal(s.things[0].cues.en.lines.length, 6);
  valid(s);
  assert.throws(() => I.addQuestion(s, { thingId, language: "en" }, env()), { code: "invalid" });
  assert.throws(() => I.setQuestionLine(s, { thingId, language: "en", index: 6, text: "x" }, env()), { code: "invalid" });
  assert.equal(s.things[0].cues.sv, undefined, "other languages are untouched");
  let one = s;
  for (let i = 0; i < 5; i++) one = I.removeQuestion(one, { thingId, language: "en", index: 0 }, env()).snapshot;
  assert.equal(one.things[0].cues.en.lines.length, 1);
  assert.throws(() => I.removeQuestion(one, { thingId, language: "en", index: 0 }, env()), { code: "invalid" });
  assert.throws(() => I.removeQuestion(s, { thingId, language: "en", index: 9 }, env()), { code: "invalid" });
});

test("removing a question deletes its recording and moves later recordings up one take", () => {
  const thing = aThing({ cues: { en: { lines: ["one", "two", "three", "four"] } } })
    .withClip(aClip({ id: "p1", kind: "prompt", take: 1 }))
    .withClip(aClip({ id: "p2", kind: "prompt", take: 2 }))
    .withClip(aClip({ id: "p4", kind: "prompt", take: 4 }))
    .withClip(aClip({ id: "sv2", kind: "prompt", take: 2, language: "sv" }))
    .withClip(aClip({ id: "n", kind: "name" }));
  const s = aSnapshot().withPlace(aPlace().withThing(thing)).build();
  const thingId = s.things[0].id;
  const r = I.removeQuestion(s, { thingId, language: "en", index: 1 }, env());
  valid(r.snapshot);
  assert.deepEqual(r.snapshot.things[0].cues.en.lines, ["one", "three", "four"]);
  assert.deepEqual(promptsOf(r.snapshot, thingId), [[1, "p1"], [3, "p4"]]);
  assert.deepEqual(promptsOf(r.snapshot, thingId, "sv"), [[2, "sv2"]], "other languages keep their takes");
  assert.deepEqual(r.writes.map((w) => [w.store, w.op, w.key ?? w.value.id]), [["things", "put", thingId], ["clips", "delete", "p2"], ["clips", "put", "p4"]]);
});

// ---------- colour game clips ----------

test("saveClip keeps colour game clips per language and colour, and replaces the same key", () => {
  const e = env();
  let s = aSnapshot().withPlace(aPlace().withThing(aThing())).build();
  const base = { thingId: null, language: "en", take: 1, blobSha256: "a".repeat(64), mime: "audio/mp4", durationMs: 500, trimStartMs: 0, trimEndMs: 500, gainDb: 0 };
  s = I.saveClip(s, { clip: { ...base, kind: "color-word", color: "yellow" } }, e).snapshot;
  s = I.saveClip(s, { clip: { ...base, kind: "color-word", color: "red" } }, e).snapshot;
  const q = I.saveClip(s, { clip: { ...base, kind: "color-question", color: "red", take: 2 } }, e);
  s = q.snapshot;
  assert.deepEqual(q.change.ids, [s.clips.at(-1).id], "no thing id for a family clip");
  valid(s);
  assert.equal(I.gameClips(s, { kind: "color-question" })[0].color, undefined, "a question has no colour");
  const again = I.saveClip(s, { clip: { ...base, kind: "color-word", color: "yellow", blobSha256: "b".repeat(64) } }, e);
  assert.equal(again.writes.filter((w) => w.op === "delete").length, 1, "the old yellow is replaced in the same batch");
  s = again.snapshot;
  assert.deepEqual(I.gameClips(s, { kind: "color-word" }).map((c) => c.color).sort(), ["red", "yellow"]);
  assert.equal(I.gameClips(s, { color: "yellow" })[0].blobSha256, "b".repeat(64));
  assert.deepEqual(I.clipsFor(s, s.things[0].id), [], "a thing's clips never include family clips");
  assert.throws(() => I.saveClip(s, { clip: { ...base, kind: "color-word", color: "sun" } }, e), { code: "invalid" });
  assert.throws(() => I.saveClip(s, { clip: { ...base, kind: "name" } }, e), { code: "invalid" });
  assert.throws(() => I.saveClip(s, { clip: { ...base, thingId: s.things[0].id, kind: "color-word", color: "red" } }, e), { code: "invalid" });
  assert.throws(() => I.saveClip(s, { clip: { ...base, kind: "color-question", take: 7 } }, e), { code: "invalid" });
  const del = I.deleteClip(s, { clipId: I.gameClips(s, { color: "red" })[0].id });
  assert.equal(del.change.ids.length, 1);
  assert.equal(I.gameClips(del.snapshot, { kind: "color-word" }).length, 1);
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
  s.settings.languages = ["en", "de"];
  s.settings.playLanguage = "en";
  const r = I.updateSettings(s, { patch: { languages: ["sv", "de"] } }, env());
  assert.equal(r.snapshot.settings.playLanguage, "sv", "a removed play language falls back to the first");
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

test("adding a second language turns on Mix languages unless a language was chosen", () => {
  const env = { now: () => "2026-01-01T00:00:00.000Z" };
  const s = aSnapshot().build();
  s.settings.playLanguage = "en";
  assert.equal(I.updateSettings(s, { patch: { languages: ["en", "sv"] } }, env).snapshot.settings.playLanguage, "alternate");
  assert.equal(I.updateSettings(s, { patch: { languages: ["en", "sv"], playLanguage: "sv" } }, env).snapshot.settings.playLanguage, "sv");
  const two = I.updateSettings(s, { patch: { languages: ["en", "sv"], playLanguage: "en" } }, env).snapshot;
  assert.equal(I.updateSettings(two, { patch: { languages: ["en", "sv", "de"] } }, env).snapshot.settings.playLanguage, "en", "a chosen language stays");
});

test("addThing stores legs (rounded, at most 8) and defaults to none", () => {
  const s = aSnapshot().withPlace(aPlace()).build();
  const placeId = s.places[0].id;
  const a = I.addThing(s, { placeId, outline: square(), color: "red" }, env()).snapshot;
  assert.deepEqual(a.things[0].legs, []);
  valid(a);
  const legs = [{ x: 0.451234, y: 0.66 }, { x: 0.55, y: 0.669999 }, { x: 0.5, y: 0.65 }, { x: 0.48, y: 0.65 }];
  const b = I.addThing(s, { placeId, outline: square(), color: "red", legs }, env()).snapshot;
  assert.deepEqual(b.things[0].legs, [{ x: 0.451, y: 0.66 }, { x: 0.55, y: 0.67 }, { x: 0.5, y: 0.65 }, { x: 0.48, y: 0.65 }]);
  valid(b);
  const nine = Array.from({ length: 9 }, () => ({ x: 0.5, y: 0.65 }));
  assert.throws(() => I.addThing(s, { placeId, outline: square(), color: "red", legs: nine }, env()), { code: "invalid" });
  assert.throws(() => I.addThing(s, { placeId, outline: square(), color: "red", legs: [{ x: 1 }] }, env()), { code: "invalid" });
});

test("updateThing replaces legs and leaves them alone when not patched", () => {
  const s = aSnapshot().withPlace(aPlace().withThing(aThing())).build();
  const id = s.things[0].id;
  const r = I.updateThing(s, { thingId: id, patch: { legs: [{ x: 0.5, y: 0.65 }] } }, env());
  assert.deepEqual(r.snapshot.things[0].legs, [{ x: 0.5, y: 0.65 }]);
  assert.deepEqual(r.writes[0].value.legs, [{ x: 0.5, y: 0.65 }]);
  valid(r.snapshot);
  const kept = I.updateThing(r.snapshot, { thingId: id, patch: { color: "blue" } }, env());
  assert.deepEqual(kept.snapshot.things[0].legs, [{ x: 0.5, y: 0.65 }]);
  const none = I.updateThing(r.snapshot, { thingId: id, patch: { legs: [] } }, env());
  assert.deepEqual(none.snapshot.things[0].legs, []);
  assert.throws(() => I.updateThing(s, { thingId: id, patch: { legs: "four" } }, env()), { code: "invalid" });
});
