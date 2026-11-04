import { test } from "node:test";
import assert from "node:assert/strict";
import { FarmStore } from "../../web/js/farm-store.js";
import { MemoryRepo } from "../../web/js/io/memory-repo.js";
import { fixedEnv, square, aSnapshot, aPlace, aThing } from "../builders.js";

async function store(repoOpts) {
  const repo = new MemoryRepo(repoOpts);
  const s = new FarmStore(repo, fixedEnv());
  await s.hydrate();
  return { s, repo };
}

test("fresh hydrate reports fresh and yields a valid empty snapshot", async () => {
  const repo = new MemoryRepo();
  const s = new FarmStore(repo, fixedEnv());
  assert.deepEqual(await s.hydrate(), { fresh: true });
  assert.equal(s.snapshot.places.length, 0);
});

test("each intent emits exactly one change at once, and persists", async () => {
  const { s, repo } = await store();
  const events = [];
  s.addEventListener("change", (e) => events.push(e.detail.kind));
  await s.createPlace({ name: "Farm" });
  await s.addThing({ placeId: s.currentPlace.id, outline: square(), color: "red" });
  assert.deepEqual(events, ["place-created", "thing-added"]);
  const again = new FarmStore(repo, fixedEnv());
  await again.hydrate();
  assert.equal(again.thingsIn(again.currentPlace.id).length, 1);
});

test("the snapshot and the change event follow an intent synchronously, before the disk commits", async () => {
  const { s, repo } = await store();
  await s.createPlace({ name: "Farm" });
  let release;
  const write = repo.write.bind(repo);
  repo.write = (w) => new Promise((ok) => { release = ok; }).then(() => write(w));
  const seen = [];
  s.addEventListener("change", (e) => seen.push(e.detail.kind));
  let done = false;
  const p = s.renamePlace({ placeId: s.currentPlace.id, name: "Barn" }).then(() => { done = true; });
  assert.equal(s.currentPlace.name, "Barn", "visible at once");
  assert.deepEqual(seen, ["place-renamed"]);
  await Promise.resolve();
  assert.equal(done, false, "the promise still waits for the commit");
  while (!release) await new Promise((r) => setImmediate(r));
  release();
  await p;
  assert.equal(done, true);
  assert.equal((await repo.load()).places[0].name, "Barn");
});

test("invalid input rejects without a change", async () => {
  const { s } = await store();
  let changed = 0;
  s.addEventListener("change", () => changed++);
  await assert.rejects(s.addThing({ placeId: "nope", outline: square(), color: "red" }), { name: "FarmError" });
  assert.equal(changed, 0);
});

test("a failed write rolls the snapshot back, emits 'reverted' and rejects with FarmError", async () => {
  const { s } = await store({ failOn: (_w, n) => (n === 2 ? Object.assign(new Error("disk"), { name: "QuotaExceededError" }) : null) });
  await s.createPlace({ name: "Farm" });
  const before = s.snapshot;
  const kinds = [];
  s.addEventListener("change", (e) => kinds.push(e.detail.kind));
  await assert.rejects(s.addThing({ placeId: s.currentPlace.id, outline: square(), color: "red" }), { name: "FarmError", code: "quota" });
  assert.equal(s.snapshot, before);
  assert.deepEqual(kinds, ["thing-added", "reverted"]);
});

test("a failed write drops the intents applied after it, so storage never holds half a change", async () => {
  const { s, repo } = await store({ failOn: (_w, n) => (n === 2 ? new Error("disk") : null) });
  await s.createPlace({ name: "Farm" });
  const placeId = s.currentPlace.id;
  const before = s.snapshot;
  const kinds = [];
  s.addEventListener("change", (e) => kinds.push(e.detail.kind));
  const a = s.addThing({ placeId, outline: square(), color: "red" });
  const b = s.addThing({ placeId, outline: square(), color: "blue" });
  assert.equal(s.thingsIn(placeId).length, 2, "both show at once");
  await assert.rejects(a, { name: "FarmError", code: "storage" });
  await assert.rejects(b, { name: "FarmError", code: "storage" });
  assert.equal(s.snapshot, before);
  assert.deepEqual(kinds, ["thing-added", "thing-added", "reverted"]);
  const again = new FarmStore(repo, fixedEnv());
  await again.hydrate();
  assert.equal(again.thingsIn(placeId).length, 0);
  await s.addThing({ placeId, outline: square(), color: "yellow" });
  assert.equal(s.thingsIn(placeId).length, 1, "later intents work again");
});

test("a blob is readable from the moment its write is queued", async () => {
  const { s, repo } = await store();
  let release;
  const write = repo.write.bind(repo);
  repo.write = (w) => new Promise((ok) => { release = ok; }).then(() => write(w));
  const blob = { sha256: "b".repeat(64), mime: "audio/mp4", size: 1, createdAt: "2026-01-01T00:00:00.000Z", bytes: new Uint8Array([1]).buffer };
  const p = s.putBlob(blob);
  assert.equal(await s.getBlob(blob.sha256), blob);
  while (!release) await new Promise((r) => setImmediate(r));
  release();
  await p;
  assert.equal(s._pendingBlobs.size, 0);
  assert.ok(await s.getBlob(blob.sha256));
});

test("a failed draft write rejects with FarmError('storage')", async () => {
  const { s } = await store({ failOn: () => new Error("disk") });
  await assert.rejects(s.saveDraft({ placeId: "p", step: 0, thing: {}, clips: [] }), { name: "FarmError", code: "storage" });
});

test("intents run in call order even when not awaited one by one", async () => {
  const { s } = await store();
  await s.createPlace({ name: "Farm" });
  const placeId = s.currentPlace.id;
  await Promise.all([1, 2, 3].map(() => s.addThing({ placeId, outline: square(), color: "red" })));
  assert.equal(s.thingsIn(placeId).length, 3);
});

test("replaceAll re-hydrates from storage and drafts survive", async () => {
  const { s } = await store();
  const d = await s.saveDraft({ placeId: "p", step: 1, thing: {}, clips: [] });
  const snap = aSnapshot().withPlace(aPlace({ name: "Imported" }).withThing(aThing())).build();
  await s.replaceAll(snap, []);
  assert.equal(s.currentPlace.name, "Imported");
  assert.equal((await s.listDrafts())[0].id, d.id);
});

test("an intent called during replaceAll applies to the replaced farm", async () => {
  const { s } = await store();
  const snap = aSnapshot().withPlace(aPlace({ name: "Imported" })).build();
  const replacing = s.replaceAll(snap, []);
  const renamed = s.renamePlace({ placeId: snap.places[0].id, name: "Renamed" });
  await Promise.all([replacing, renamed]);
  assert.equal(s.currentPlace.name, "Renamed");
});

test("a failed replaceAll rejects with FarmError('storage')", async () => {
  const repo = new MemoryRepo();
  const s = new FarmStore(repo, fixedEnv());
  await s.hydrate();
  repo.replaceAll = async () => { throw new Error("disk"); };
  await assert.rejects(s.replaceAll(aSnapshot().build(), []), { name: "FarmError", code: "storage" });
  assert.equal(s._replacing, 0);
});

test("every intent wrapper runs its intent, emits one change, and the result survives a reload", async () => {
  const { s, repo } = await store();
  const kinds = [];
  s.addEventListener("change", (e) => kinds.push(e.detail.kind));
  await s.createPlace({ name: "Farm" });
  const placeId = s.currentPlace.id;
  await s.updatePlace({ placeId, patch: { skyColor: "blue" } });
  await s.createPlace({ name: "Sea" });
  await s.setCurrentPlace({ placeId });
  await s.addPiece({ placeId, piece: { kind: "shape", color: "sun", stroke: square(0.5, 0.3, 0.05) } });
  const pieceId = s.currentPlace.pieces.at(-1).id;
  await s.updatePiece({ placeId, pieceId, patch: { color: "leaf" } });
  await s.removePiece({ placeId, pieceId });
  await s.addThing({ placeId, outline: square(), color: "red" });
  const thingId = s.thingsIn(placeId)[0].id;
  await s.updateThing({ thingId, patch: { color: "blue" } });
  await s.setQuestionLine({ thingId, language: "en", index: 0, text: "Where is it?" });
  await s.addQuestion({ thingId, language: "en", text: "Peekaboo?" });
  await s.saveClip({ clip: { id: "c1", thingId, language: "en", kind: "prompt", take: 4, blobSha256: "a".repeat(64), mime: "audio/mp4", durationMs: 500, trimStartMs: 0, trimEndMs: 500, gainDb: 0, createdAt: "2026-11-04T00:00:00.000Z" }, blob: { sha256: "a".repeat(64), mime: "audio/mp4", size: 1, createdAt: "2026-11-04T00:00:00.000Z", bytes: new Uint8Array([1]).buffer } });
  const removed = await s.removeQuestion({ thingId, language: "en", index: 3 });
  assert.equal(s.clipsFor(thingId).length, 0);
  await s.restoreQuestions(removed.removed);
  assert.equal(s.clipsFor(thingId).length, 1);
  await s.deleteClip({ clipId: s.clipsFor(thingId)[0].id });
  const del = await s.deleteThing({ thingId });
  await s.restoreThing(del.removed);
  await s.updateSettings({ patch: { maxThings: 5 } });
  const sea = s.snapshot.places.find((p) => p.name === "Sea").id;
  await s.deletePlace({ placeId: sea });
  assert.equal(new Set(kinds).size > 8, true, kinds.join(","));
  const again = new FarmStore(repo, fixedEnv());
  await again.hydrate();
  assert.equal(again.snapshot.places.length, 1);
  assert.equal(again.snapshot.places[0].skyColor, "blue");
  assert.equal(again.thingsIn(placeId)[0].color, "blue");
  assert.deepEqual(again.thingsIn(placeId)[0].cues.en.lines, ["Where is it?", "", "", "Peekaboo?"]);
  assert.equal(again.maxThings, 5);
});
