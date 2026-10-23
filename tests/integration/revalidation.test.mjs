import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter, hash } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("revalidation binds a changed bundle to the new definition and incompatible heads refuse old approvals", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  const app = createOntave({
    storage: db.storage,
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "read", "review", "ingest", "worker"],
    }),
    model: fixtureAdapter((task) => {
      const e = personFixture(task.text.split(" ")[0]);
      if (
        task.ontology.concepts
          .find((c) => c.id === "person")
          .fields.some((f) => f.id === "city")
      )
        e.entities[0].fields.city = { value: "Pune", quote: "Pune" };
      return e;
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Revalidation",
    seed: "people",
    requestKey: "create",
  });
  const oldContract = await app.contracts.register(null, starter);
  const receipt = await app.ingest(null, {
    source: "revalidate",
    idempotencyKey: "old",
    payload: { kind: "text", text: "Asha from Pune" },
  });
  const original = await app.reviews.get(
    null,
    (await app.worker.runOnce(null)).bundleId,
  );
  const person = starter.concepts.find((c) => c.id === "person");
  const candidate = await app.ontology.propose(null, {
    patch: {
      concepts: [
        {
          ...person,
          fields: [
            {
              id: "city",
              name: "City",
              description: "Explicitly stated city",
              type: "text",
              optional: true,
            },
          ],
        },
      ],
      relations: [],
    },
    evidenceIds: [receipt.evidence_id],
    requestKey: "city",
    reason: "Represent explicit reported city",
  });
  const suite = await app.evaluations.registerSuite(null, {
    name: "City capability",
    maxCalls: 2,
    timeoutMs: 5000,
    tasks: [
      { kind: "contract", id: "old", contractId: oldContract.id },
      {
        kind: "extract",
        id: "city",
        evidenceId: receipt.evidence_id,
        expected: [
          { conceptId: "person", fieldId: "name", value: "Asha" },
          { conceptId: "person", fieldId: "city", value: "Pune" },
        ],
      },
    ],
  });
  const evaluation = await app.evaluations.evaluate(null, {
    candidateId: candidate.candidateId,
    suiteId: suite.suiteId,
  });
  assert.equal(evaluation.passed, true);
  await app.ontology.publish(null, {
    candidateId: candidate.candidateId,
    candidateHash: candidate.hash,
    evaluationId: evaluation.evaluationId,
    evaluationHash: evaluation.hash,
    requestKey: "publish",
    reason: "Independent authored test expectations checked",
  });
  const current = await app.ontology.inspect(null);
  const changed = structuredClone(original.body.extraction);
  changed.entities[0].fields.city = { value: "Pune", quote: "Pune" };
  const revised = await app.reviews.amend(null, {
    bundleId: original.id,
    digest: original.hash,
    extraction: changed,
    requestKey: "revalidate-city",
    reason: "Review source city against the adopted definition",
  });
  const bundle = await app.reviews.get(null, revised.bundleId);
  assert.equal(bundle.ontology_id, current.id);
  assert.notEqual(bundle.hash, original.hash);
  assert.equal(bundle.revision, original.revision + 1);
  await assert.rejects(
    app.reviews.accept(null, {
      bundleId: original.id,
      digest: original.hash,
      requestKey: "old-approval",
      reason: "Old digest cannot approve new content",
    }),
    (e) => e.code === "STALE_BUNDLE",
  );
  await app.reviews.accept(null, {
    bundleId: bundle.id,
    digest: bundle.hash,
    requestKey: "accept-city",
    reason: "Exact new revision reviewed",
  });
  const adopted = await app.contracts.register(null, current.definition);
  assert.equal(
    (
      await app.entities.find(null, {
        contractId: adopted.id,
        contractHash: adopted.hash,
        conceptId: "person",
      })
    ).records[0].fields.city.value,
    "Pune",
  );
  assert.equal(
    (
      await app.entities.find(null, {
        contractId: oldContract.id,
        contractHash: oldContract.hash,
        conceptId: "person",
      })
    ).records[0].fields.city,
    undefined,
  );
  assert.equal((await app.reviews.get(null, original.id)).hash, original.hash);
  const pending = await app.ingest(null, {
    source: "revalidate",
    idempotencyKey: "pending",
    payload: { kind: "text", text: "Mira from Pune" },
  });
  const waiting = await app.reviews.get(
    null,
    (await app.worker.runOnce(null)).bundleId,
  );
  // Fault injection only: normal SDK evolution cannot create an incompatible version.
  const broken = structuredClone(current.definition);
  broken.concepts.find((c) => c.id === "person").name = "Changed meaning";
  const brokenId = randomUUID();
  await db.admin.query(
    "INSERT INTO ontave.versions(workspace_id,id,ordinal,parent_id,hash,definition) VALUES($1,$2,2,$3,$4,$5)",
    [w, brokenId, current.id, hash(broken), JSON.stringify(broken)],
  );
  await db.admin.query(
    "UPDATE ontave.workspaces SET active_id=$1 WHERE workspace_id=$2",
    [brokenId, w],
  );
  await assert.rejects(
    app.reviews.accept(null, {
      bundleId: waiting.id,
      digest: waiting.hash,
      requestKey: "incompatible",
      reason: "Must renew interpretation",
    }),
    (e) =>
      e.code === "STALE_ONTOLOGY" &&
      e.message.includes("renewed interpretation"),
  );
  await assert.rejects(
    app.reviews.amend(null, {
      bundleId: waiting.id,
      digest: waiting.hash,
      extraction: waiting.body.extraction,
      requestKey: "incompatible-amend",
      reason: "Cannot silently bind changed meanings",
    }),
    (e) => e.code === "STALE_ONTOLOGY" && e.message.includes("reprocess"),
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT count(*) FROM ontave.assertions WHERE evidence_id=$1",
        [pending.evidence_id],
      )
    ).rows[0].count,
    "0",
  );
  assert.equal((await app.reviews.get(null, waiting.id)).hash, waiting.hash);
});
