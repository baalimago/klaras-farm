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

test("each intent emits exactly one change after the write commits, and persists", async () => {
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

test("a failed write leaves the snapshot unchanged and rejects with FarmError", async () => {
  const { s } = await store({ failOn: (_w, n) => (n === 2 ? Object.assign(new Error("disk"), { name: "QuotaExceededError" }) : null) });
  await s.createPlace({ name: "Farm" });
  const before = s.snapshot;
  let changed = 0;
  s.addEventListener("change", () => changed++);
  await assert.rejects(s.addThing({ placeId: s.currentPlace.id, outline: square(), color: "red" }), { name: "FarmError", code: "quota" });
  assert.equal(s.snapshot, before);
  assert.equal(changed, 0);
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
