// The animal library through FarmStore and a real Repository (MemoryRepo): copies and seeded
// scenes persist, show at once, and a copy's recordings outlive the original and the orphan sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FarmStore } from "../../web/js/farm-store.js";
import { MemoryRepo } from "../../web/js/io/memory-repo.js";
import { fixedEnv, square, aThing } from "../builders.js";

const SHA = "b".repeat(64);
const T = "2026-11-01T00:00:00.000Z"; // older than the sweep's cut-off below
const blob = { sha256: SHA, mime: "audio/mp4", size: 1, createdAt: T, bytes: new Uint8Array([7]).buffer };

async function farmWithRecordedPig() {
  const repo = new MemoryRepo();
  const s = new FarmStore(repo, fixedEnv());
  await s.hydrate();
  await s.createPlace({ name: "Farm" });
  const farm = s.currentPlace.id;
  await s.createPlace({ name: "Sea" });
  const sea = s.currentPlace.id;
  await s.addThing({ placeId: farm, names: { en: "Pig" }, outline: square(), color: "pink" });
  const pig = s.thingsIn(farm)[0].id;
  await s.saveClip({ clip: { thingId: pig, language: "en", kind: "name", take: 1, blobSha256: SHA, mime: "audio/mp4", durationMs: 500, trimStartMs: 0, trimEndMs: 500, gainDb: 0 }, blob });
  return { repo, s, farm, sea, pig };
}

test("copyThing shows at once, persists, and the copy keeps its recording after the original and the sweep are gone", async () => {
  const { repo, s, farm, sea, pig } = await farmWithRecordedPig();
  const kinds = [];
  s.addEventListener("change", (e) => kinds.push(e.detail.kind));
  const pending = s.copyThing({ placeId: sea, thingId: pig });
  assert.equal(s.thingsIn(sea).length, 1, "in the snapshot before the commit");
  assert.deepEqual(kinds, ["thing-added"]);
  await pending;
  const copy = s.thingsIn(sea)[0];
  assert.equal(s.clipsFor(copy.id)[0].blobSha256, SHA);

  await s.deleteThing({ thingId: pig });
  assert.equal(await repo.sweepOrphanBlobs("2030-01-01T00:00:00.000Z"), 0, "the copy's clip still uses the blob");
  assert.ok(await s.getBlob(SHA));

  const again = new FarmStore(repo, fixedEnv());
  await again.hydrate();
  assert.equal(again.thingsIn(farm).length, 0);
  const back = again.thingsIn(sea)[0];
  assert.equal(back.names.en, "Pig");
  assert.equal(again.clipsFor(back.id).length, 1);
  assert.ok((await again.getBlob(again.clipsFor(back.id)[0].blobSha256))?.size > 0);
});

test("createPlace with seed persists the new scene and its animals in one change", async () => {
  const { repo, s } = await farmWithRecordedPig();
  const kinds = [];
  s.addEventListener("change", (e) => kinds.push(e.detail.kind));
  const examples = ["Fox", "Frog", "Owl", "Snail"].map((en, i) => aThing({ id: `example-${i}`, placeId: "library", names: { en }, outline: square(0.5, 0.8, 0.06) }).build().thing);
  await s.createPlace({ name: "Garden", seed: { examples } });
  assert.deepEqual(kinds, ["place-created"]);
  const garden = s.currentPlace;
  const n = garden.thingOrder.length;
  assert.ok(n >= 3 && n <= 4);
  const again = new FarmStore(repo, fixedEnv());
  await again.hydrate();
  assert.deepEqual(again.thingsIn(garden.id).map((t) => t.id), garden.thingOrder);
});
