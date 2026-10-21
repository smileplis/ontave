import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createOntave, starter, hash } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("real PostgreSQL vertical slice, durable review, source status, scope and constraints", async (t) => {
  const db = await disposablePostgres();
  const w = randomUUID(),
    other = randomUUID();
  const grants = {
    owner: {
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "read", "ingest", "review", "worker"],
    },
    reader: { actorId: "reader", workspaceId: w, capabilities: ["read"] },
    other: {
      actorId: "other",
      workspaceId: other,
      capabilities: ["provision", "read", "ingest", "review", "worker"],
    },
  };
  let output = personFixture("Rahul");
  let invocations = 0;
  let patch,
    proposalCalls = 0;
  const model = fixtureAdapter((task) => {
    invocations++;
    return typeof output === "function" ? output(task) : output;
  });
  model.propose = async (task) => {
    proposalCalls++;
    assert.equal(task.observations.length, 1);
    return {
      patch,
      model: "explicit-fixture-proposer",
      usage: { totalTokens: 0 },
    };
  };
  const app = createOntave({
    storage: db.storage,
    authorize: (token) => {
      if (!grants[token]) throw Error("invalid");
      return grants[token];
    },
    model,
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  const provision = {
    workspaceId: w,
    name: "Solar demo",
    requestKey: "create",
    seed: "people",
  };
  await app.workspaces.create("owner", provision);
  await app.workspaces.create("owner", provision);
  await app.workspaces.create("other", {
    workspaceId: other,
    name: "Other",
    requestKey: "create-other",
    seed: "people",
  });
  const contract = await app.contracts.register("owner", starter);
  const query = {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  };
  await t.test(
    "unknown host contexts and reader writes fail closed",
    async () => {
      await assert.rejects(
        app.ingest("reader", {
          source: "test",
          idempotencyKey: "denied",
          payload: { kind: "text", text: "Rahul" },
        }),
        (e) => e.code === "FORBIDDEN",
      );
      await assert.rejects(
        app.ontology.inspect("forged"),
        (e) => e.code === "UNAUTHORIZED",
      );
    },
  );
  let receipt, bundle, entity;
  await t.test(
    "idempotent ingestion preserves evidence without inference",
    async () => {
      const input = {
        source: "test",
        idempotencyKey: "message1",
        payload: { kind: "text", text: "Rahul" },
      };
      receipt = await app.ingest("owner", input);
      const again = await app.ingest("owner", input);
      assert.equal(again.evidence_id, receipt.evidence_id);
      assert.equal(invocations, 0);
      await assert.rejects(
        app.ingest("owner", {
          ...input,
          payload: { kind: "text", text: "Riya" },
        }),
        (e) => e.code === "IDEMPOTENCY_CONFLICT",
      );
      assert.equal(
        (await app.evidence.get("owner", receipt.evidence_id)).payload,
        "Rahul",
      );
    },
  );
  await t.test(
    "worker stages and review atomically publishes with reported status",
    async () => {
      const work = await app.worker.runOnce("owner");
      assert.equal(work.state, "waiting_review");
      bundle = await app.reviews.get("owner", work.bundleId);
      assert.equal(
        (await app.entities.find("reader", query)).records.length,
        0,
      );
      const result = await app.reviews.accept("owner", {
        bundleId: bundle.id,
        digest: bundle.hash,
        requestKey: "accept1",
        reason: "Checked source",
      });
      entity = result.entityIds[0];
      const records = (await app.entities.find("reader", query)).records;
      assert.equal(records.length, 1);
      assert.equal(records[0].fields.name.value, "Rahul");
      assert.equal(records[0].fields.name.verification, "reported");
      assert.equal(records[0].fields.email.state, "missing");
      assert.equal(
        (await app.jobs.get("reader", receipt.job_id)).state,
        "completed",
      );
      const repeat = await app.reviews.accept("owner", {
        bundleId: bundle.id,
        digest: bundle.hash,
        requestKey: "accept1",
        reason: "Checked source",
      });
      assert.deepEqual(repeat, result);
    },
  );
  await t.test(
    "workspace isolation is enforced by runtime role and pooled SQL context",
    async () => {
      for (const fn of [
        () => app.evidence.get("other", receipt.evidence_id),
        () => app.jobs.get("other", receipt.job_id),
        () => app.reviews.get("other", bundle.id),
      ])
        await assert.rejects(fn(), (e) => e.code === "NOT_FOUND");
      await assert.rejects(
        app.entities.find("other", query),
        (e) => e.code === "CONTRACT_NOT_AVAILABLE",
      );
      const raw = new Pool({ connectionString: db.connectionString });
      try {
        assert.equal(
          (await raw.query("SELECT * FROM ontave.evidence")).rowCount,
          0,
        );
        await assert.rejects(
          raw.query("UPDATE ontave.evidence SET payload=$1", ["tampered"]),
        );
        await assert.rejects(raw.query("CREATE TABLE ontave.bad(id int)"));
      } finally {
        await raw.end();
      }
      await assert.rejects(
        db.storage.transaction(w, async (c) => {
          await c.query("SELECT 1");
          throw Error("abort");
        }),
      );
      assert.equal(
        await db.storage.transaction(
          other,
          async (c) =>
            (await c.query("SELECT * FROM ontave.evidence")).rowCount,
        ),
        0,
      );
    },
  );
  await t.test(
    "ambiguous identity requires review and creates explicit conflict without overwriting",
    async () => {
      output = personFixture("Rahul");
      output.entities[0].fields.email = {
        value: "rahul@example.test",
        quote: "rahul@example.test",
      };
      await app.ingest("owner", {
        source: "test",
        idempotencyKey: "message2",
        payload: { kind: "text", text: "Rahul rahul@example.test" },
      });
      let work = await app.worker.runOnce("owner");
      assert.equal(work.state, "waiting_identity");
      let b = await app.reviews.get("owner", work.bundleId);
      const resolved = await app.reviews.resolveIdentity("owner", {
        bundleId: b.id,
        digest: b.hash,
        mentionId: "person_1",
        entityId: entity,
        requestKey: "resolve",
        reason: "Same person confirmed by owner",
      });
      b = await app.reviews.get("owner", resolved.bundleId);
      await app.reviews.accept("owner", {
        bundleId: b.id,
        digest: b.hash,
        requestKey: "accept2",
        reason: "Reviewed",
      });
      assert.equal(
        (await app.entities.find("reader", query)).records[0].fields.email
          .value,
        "rahul@example.test",
      );
    },
  );
  await t.test(
    "invalid model values never publish and original evidence remains",
    async () => {
      output = personFixture("Not in source");
      const receipt = await app.ingest("owner", {
        source: "test",
        idempotencyKey: "invalid",
        payload: { kind: "text", text: "Original source" },
      });
      const work = await app.worker.runOnce("owner");
      assert.equal(work.error.code, "VALIDATION_FAILED");
      assert.equal(
        (await app.jobs.get("owner", receipt.job_id)).state,
        "failed",
      );
      assert.equal(
        (await app.evidence.get("owner", receipt.evidence_id)).payload,
        "Original source",
      );
    },
  );
  await t.test(
    "ontology evaluation, atomic activation/replay, old contract current data",
    async () => {
      output = {
        entities: [],
        relationships: [],
        observations: [{ concept: "Installation", quote: "Install job I-101" }],
      };
      const r = await app.ingest("owner", {
        source: "test",
        idempotencyKey: "install",
        payload: { kind: "text", text: "Install job I-101 costs 100.00" },
      });
      const work = await app.worker.runOnce("owner");
      assert.equal(work.state, "waiting_ontology");
      const installation = {
        id: "installation",
        name: "Installation",
        description: "A scheduled installation",
        fields: [
          {
            id: "reference",
            name: "Reference",
            description: "Installation reference",
            type: "text",
          },
          {
            id: "cost",
            name: "Cost",
            description: "Reported cost",
            type: "decimal",
          },
        ],
      };
      patch = { concepts: [installation], relations: [] };
      const proposalRequest = {
        evidenceIds: [r.evidence_id],
        requestKey: "proposal",
        reason: "Represent installation work",
      };
      const candidate = await app.ontology.propose("owner", proposalRequest);
      assert.deepEqual(
        await app.ontology.propose("owner", proposalRequest),
        candidate,
      );
      assert.equal(proposalCalls, 1);
      assert.equal(
        (await app.ontology.diff("owner", candidate.candidateId)).generation
          .model,
        "explicit-fixture-proposer",
      );
      const manual = await app.ontology.propose("owner", {
        patch,
        evidenceIds: [r.evidence_id],
        requestKey: "manual-proposal",
        reason: "Represent installation work",
      });
      assert.notEqual(manual.candidateId, candidate.candidateId);
      output = (task) =>
        task.ontology.concepts.some((c) => c.id === "installation")
          ? {
              entities: [
                {
                  mentionId: "i",
                  conceptId: "installation",
                  name: "I-101",
                  fields: {
                    reference: { value: "I-101", quote: "I-101" },
                    cost: { value: "100.00", quote: "100.00" },
                  },
                },
              ],
              relationships: [],
              observations: [],
            }
          : {
              entities: [],
              relationships: [],
              observations: [
                { concept: "Installation", quote: "Install job I-101" },
              ],
            };
      const suite = await app.evaluations.registerSuite("owner", {
        name: "Preserve old contract and enable installation",
        tasks: [
          { id: "old-contract", kind: "contract", contractId: contract.id },
          {
            id: "new-installation",
            kind: "extract",
            evidenceId: r.evidence_id,
            expected: [
              {
                conceptId: "installation",
                fieldId: "reference",
                value: "I-101",
              },
              { conceptId: "installation", fieldId: "cost", value: "100.00" },
            ],
          },
        ],
        maxCalls: 2,
        timeoutMs: 1000,
      });
      const evaluation = await app.evaluations.evaluate("owner", {
        candidateId: candidate.candidateId,
        suiteId: suite.suiteId,
      });
      assert.equal(evaluation.passed, true);
      await app.ontology.publish("owner", {
        candidateId: candidate.candidateId,
        candidateHash: candidate.hash,
        evaluationId: evaluation.evaluationId,
        evaluationHash: evaluation.hash,
        requestKey: "publish",
        reason: "Reviewed additive change",
      });
      assert.equal((await app.jobs.get("owner", r.job_id)).state, "queued");
      await assert.rejects(
        app.ontology.publish("owner", {
          candidateId: manual.candidateId,
          candidateHash: manual.hash,
          evaluationId: evaluation.evaluationId,
          evaluationHash: evaluation.hash,
          requestKey: "publish-stale",
          reason: "Cannot publish two children of old head",
        }),
        (e) => e.code === "STALE_BASE",
      );
      const replay = await app.worker.runOnce("owner");
      assert.equal(replay.state, "waiting_review");
      const rb = await app.reviews.get("owner", replay.bundleId);
      await app.reviews.accept("owner", {
        bundleId: rb.id,
        digest: rb.hash,
        requestKey: "accept-install",
        reason: "Checked installation",
      });
      assert.equal(
        (await app.entities.find("reader", query)).records[0].fields.email
          .value,
        "rahul@example.test",
      );
      const adopted = await app.contracts.register(
        "owner",
        (await app.ontology.inspect("owner")).definition,
      );
      const numeric = {
        contractId: adopted.id,
        contractHash: adopted.hash,
        conceptId: "installation",
      };
      assert.equal(
        (
          await app.entities.find("reader", {
            ...numeric,
            where: [{ field: "cost", op: "eq", value: "100.0000" }],
          })
        ).records[0].fields.cost.value,
        "100",
      );
      assert.equal(
        (
          await app.entities.find("reader", {
            ...numeric,
            where: [{ field: "cost", op: "gt", value: "99.9999" }],
            order: { field: "cost", direction: "desc" },
          })
        ).records.length,
        1,
      );
    },
  );
});
