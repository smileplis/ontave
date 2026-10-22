import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
test("authority collisions, partial names, reviewer amendments and rejection do not silently merge", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID(),
    other = randomUUID();
  let output;
  const app = createOntave({
    storage: db.storage,
    model: fixtureAdapter(() => output),
    identifierRules: [
      { authority: "crm_a", kind: "contact" },
      { authority: "crm_b", kind: "contact" },
    ],
    authorize: (ctx) => ({
      actorId: "owner",
      workspaceId: ctx === "other" ? other : w,
      capabilities: ["provision", "ingest", "worker", "read", "review"],
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  for (const [context, id] of [
    [null, w],
    ["other", other],
  ])
    await app.workspaces.create(context, {
      workspaceId: id,
      name: "Authority",
      seed: "people",
      requestKey: "create",
    });
  const contract = await app.contracts.register(null, starter),
    query = {
      contractId: contract.id,
      contractHash: contract.hash,
      conceptId: "person",
    };
  const stage = async (name, key, authority, context = null) => {
    output = personFixture(name);
    if (authority)
      output.entities[0].identifiers = [
        { authority, kind: "contact", value: "42", quote: "42" },
      ];
    await app.ingest(context, {
      source: "authority",
      idempotencyKey: key,
      payload: { kind: "text", text: name + " 42" },
    });
    const result = await app.worker.runOnce(context);
    assert.ok(result.bundleId, JSON.stringify(result));
    return app.reviews.get(context, result.bundleId);
  };
  const accept = async (b, key) =>
    app.reviews.accept(null, {
      bundleId: b.id,
      digest: b.hash,
      requestKey: key,
      reason: "Checked fictional source and authority",
    });
  let first, second;
  await t.test(
    "same kind and value under distinct authorities create distinct identities",
    async () => {
      first = (await accept(await stage("Alice A", "a", "crm_a"), "accept-a"))
        .entityIds[0];
      second = (await accept(await stage("Alice B", "b", "crm_b"), "accept-b"))
        .entityIds[0];
      assert.notEqual(first, second);
      assert.equal((await app.entities.find(null, query)).records.length, 2);
      const linked = await stage("Alice A", "repeat", "crm_a");
      assert.equal(linked.body.resolutions.person_1.entityId, first);
      await accept(linked, "accept-repeat");
      assert.equal((await app.entities.find(null, query)).records.length, 2);
    },
  );
  await t.test(
    "conflicting trusted identifiers require review and cannot conflate established entities",
    async () => {
      output = personFixture("Alice");
      output.entities[0].identifiers = [
        { authority: "crm_a", kind: "contact", value: "42", quote: "42" },
        { authority: "crm_b", kind: "contact", value: "42", quote: "42" },
      ];
      await app.ingest(null, {
        source: "authority",
        idempotencyKey: "both",
        payload: { kind: "text", text: "Alice 42" },
      });
      const result = await app.worker.runOnce(null);
      assert.equal(result.state, "waiting_identity");
      const b = await app.reviews.get(null, result.bundleId);
      await assert.rejects(
        accept(b, "no-merge"),
        (e) => e.code === "STALE_BUNDLE",
      );
      await app.reviews.reject(null, {
        bundleId: b.id,
        digest: b.hash,
        requestKey: "reject-both",
        reason: "Two established identities need investigation",
      });
      assert.equal((await app.entities.find(null, query)).records.length, 2);
    },
  );
  await t.test(
    "partial names offer scoped candidates without selecting the nearest match",
    async () => {
      await accept(await stage("Rahul Sharma", "full"), "accept-full");
      await stage("Rahul Secret", "other", undefined, "other");
      const b = await stage("Rahul S.", "partial");
      assert.equal(b.state, "waiting_identity");
      assert.equal(b.body.pending[0], "person_1");
      const candidates = b.body.identityCandidates.person_1;
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].name, "Rahul Sharma");
      assert.notEqual(b.body.resolutions.person_1.entityId, candidates[0].id);
      await app.reviews.reject(null, {
        bundleId: b.id,
        digest: b.hash,
        requestKey: "reject-partial",
        reason: "Insufficient identity evidence",
      });
    },
  );
  await t.test(
    "amendment requires the new digest; rejected facts remain inspectable and absent",
    async () => {
      const b = await stage("Asha", "amend");
      const changed = structuredClone(b.body.extraction);
      changed.entities[0].fields.email = {
        value: "unsupported@example.test",
        quote: "Asha",
      };
      const amended = await app.reviews.amend(null, {
        bundleId: b.id,
        digest: b.hash,
        extraction: changed,
        requestKey: "amend",
        reason: "Deliberate hostile review input to inspect validation",
      });
      await assert.rejects(
        accept(b, "stale-amend"),
        (e) => e.code === "STALE_BUNDLE",
      );
      const current = await app.reviews.get(null, amended.bundleId);
      await app.reviews.reject(null, {
        bundleId: current.id,
        digest: current.hash,
        requestKey: "reject-amend",
        reason: "Unsupported interpretation",
      });
      await assert.rejects(
        accept(current, "accept-rejected"),
        (e) => e.code === "STALE_BUNDLE",
      );
      assert.equal((await app.reviews.get(null, current.id)).state, "rejected");
      assert.ok(
        !(await app.entities.find(null, query)).records.some(
          (r) => r.name === "Asha",
        ),
      );
    },
  );
});
