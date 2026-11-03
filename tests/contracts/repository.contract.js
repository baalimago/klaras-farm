// Repository contract. Runs against MemoryRepo in Node (tests/unit) and IdbRepo in browsers.
// makeRepo(opts) must return a fresh, empty repository; opts.failOn injects faults where supported.
import { aSnapshot, aPlace, aThing, aClip, aBlob } from "../builders.js";

export function repositoryContract({ describe, it, assert, makeRepo, supportsFaults = true }) {
  describe("Repository contract", () => {
    it("starts empty", async () => {
      const repo = await makeRepo();
      const d = await repo.load();
      assert.deepEqual([d.places, d.things, d.clips, d.settings], [[], [], [], null]);
      assert.deepEqual(await repo.listDrafts(), []);
    });

    it("applies a batch of writes and reads them back", async () => {
      const repo = await makeRepo();
      const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build();
      await repo.write([
        { store: "places", op: "put", value: s.places[0] },
        { store: "things", op: "put", value: s.things[0] },
        { store: "clips", op: "put", value: s.clips[0] },
        { store: "settings", op: "put", value: s.settings },
        { store: "blobs", op: "put", value: aBlob(s.clips[0].blobSha256) },
        { store: "meta", op: "put", value: { key: "lastExportAt", value: "x" } },
      ]);
      const d = await repo.load();
      assert.deepEqual(d.places, s.places);
      assert.deepEqual(d.things, s.things);
      assert.deepEqual(d.clips, s.clips);
      assert.deepEqual(d.settings, s.settings);
      assert.equal(d.meta.lastExportAt, "x");
      const blob = await repo.getBlob(s.clips[0].blobSha256);
      assert.deepEqual(new Uint8Array(blob.bytes), new Uint8Array([1, 2, 3]));
      assert.equal(await repo.getBlob("f".repeat(64)), null);
    });

    it("deletes by key", async () => {
      const repo = await makeRepo();
      const s = aSnapshot().withPlace(aPlace()).build();
      await repo.write([{ store: "places", op: "put", value: s.places[0] }]);
      await repo.write([{ store: "places", op: "delete", key: s.places[0].id }]);
      assert.deepEqual((await repo.load()).places, []);
    });

    it("rejects a duplicate clip key and applies nothing from that batch", async () => {
      const repo = await makeRepo();
      const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build();
      const a = s.clips[0];
      const b = { ...a, id: a.id + "-b" };
      await repo.write([{ store: "clips", op: "put", value: a }]);
      await assert.rejects(repo.write([{ store: "places", op: "put", value: s.places[0] }, { store: "clips", op: "put", value: b }]));
      const d = await repo.load();
      assert.deepEqual(d.places, []);
      assert.equal(d.clips.length, 1);
    });

    it("allows replacing a clip with the same key in one batch (delete then put)", async () => {
      const repo = await makeRepo();
      const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build();
      const a = s.clips[0];
      const b = { ...a, id: a.id + "-new" };
      await repo.write([{ store: "clips", op: "put", value: a }]);
      await repo.write([{ store: "clips", op: "delete", key: a.id }, { store: "clips", op: "put", value: b }]);
      assert.deepEqual((await repo.load()).clips.map((c) => c.id), [b.id]);
    });

    it("stores drafts outside the snapshot", async () => {
      const repo = await makeRepo();
      await repo.write([{ store: "drafts", op: "put", value: { id: "d1", placeId: "p", step: 2, thing: {}, clips: [], updatedAt: "2026-11-03T12:00:00.000Z" } }]);
      assert.equal((await repo.listDrafts())[0].step, 2);
      assert.deepEqual((await repo.load()).things, []);
    });

    it("replaceAll swaps everything in one go, keeping meta and drafts", async () => {
      const repo = await makeRepo();
      const old = aSnapshot().withPlace(aPlace({ name: "Old" })).build();
      await repo.write([{ store: "places", op: "put", value: old.places[0] }, { store: "meta", op: "put", value: { key: "k", value: 1 } }]);
      const s = aSnapshot().withPlace(aPlace({ name: "New" }).withThing(aThing().withClip(aClip()))).build();
      await repo.replaceAll(s, [aBlob(s.clips[0].blobSha256)]);
      const d = await repo.load();
      assert.deepEqual(d.places.map((p) => p.name), ["New"]);
      assert.equal(d.things.length, 1);
      assert.equal(d.meta.k, 1);
      assert.deepEqual(await repo.listBlobShas(), [s.clips[0].blobSha256]);
    });

    it("sweeps only unreferenced blobs older than the cutoff, counting drafts as references", async () => {
      const repo = await makeRepo();
      const s = aSnapshot().withPlace(aPlace().withThing(aThing().withClip(aClip()))).build();
      const used = s.clips[0].blobSha256;
      const draftSha = "d".repeat(64);
      const oldOrphan = "a".repeat(64);
      const newOrphan = "b".repeat(64);
      await repo.write([
        { store: "clips", op: "put", value: s.clips[0] },
        { store: "blobs", op: "put", value: aBlob(used) },
        { store: "blobs", op: "put", value: aBlob(draftSha) },
        { store: "blobs", op: "put", value: aBlob(oldOrphan) },
        { store: "blobs", op: "put", value: { ...aBlob(newOrphan), createdAt: "2026-11-05T00:00:00.000Z" } },
        { store: "drafts", op: "put", value: { id: "d", placeId: "p", step: 1, thing: {}, clips: [{ blobSha256: draftSha }], updatedAt: "2026-11-03T12:00:00.000Z" } },
      ]);
      const n = await repo.sweepOrphanBlobs("2026-11-04T00:00:00.000Z");
      assert.equal(n, 1);
      assert.deepEqual((await repo.listBlobShas()).sort(), [used, draftSha, newOrphan].sort());
    });

    it("clear empties everything", async () => {
      const repo = await makeRepo();
      const s = aSnapshot().withPlace(aPlace()).build();
      await repo.write([{ store: "places", op: "put", value: s.places[0] }, { store: "settings", op: "put", value: s.settings }]);
      await repo.clear();
      const d = await repo.load();
      assert.deepEqual([d.places, d.settings], [[], null]);
    });

    if (supportsFaults) {
      it("a failing write leaves storage unchanged", async () => {
        const repo = await makeRepo({ failOn: (_w, n) => (n === 2 ? Object.assign(new Error("full"), { name: "QuotaExceededError" }) : null) });
        const s = aSnapshot().withPlace(aPlace()).withPlace(aPlace()).build();
        await repo.write([{ store: "places", op: "put", value: s.places[0] }]);
        await assert.rejects(repo.write([{ store: "places", op: "put", value: s.places[1] }]), /full/);
        assert.equal((await repo.load()).places.length, 1);
      });
    }
  });
}
