import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, definition, hash } from "../../dist/index.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("custom adapters cannot bypass complete-context and concept limits in workers, evaluation or generation", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let calls = 0,
    proposals = 0;
  const concept = (i) => ({
    id: "c_" + i,
    name: "C " + i,
    description: "Concept " + i,
    fields: [
      {
        id: "value",
        name: "Value",
        description: "Explicit value",
        type: "text",
      },
    ],
  });
  const d25 = definition({
    concepts: Array.from({ length: 25 }, (_, i) => concept(i)),
    relations: [],
  });
  const app = createOntave({
    storage: db.storage,
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "ingest", "worker", "read", "review"],
    }),
    model: {
      async extract(task) {
        calls++;
        return {
          model: "custom-fixture",
          output:
            task.ontology.concepts.length && task.text !== "Unknown"
              ? {
                  entities: [
                    {
                      mentionId: "one",
                      conceptId: "c_0",
                      name: "Hello",
                      fields: { value: { value: "Hello", quote: "Hello" } },
                    },
                  ],
                  relationships: [],
                  observations: [],
                }
              : {
                  entities: [],
                  relationships: [],
                  observations: [{ concept: "Unresolved", quote: task.text }],
                },
        };
      },
      async propose() {
        proposals++;
        throw Error("Must not call oversized generation context");
      },
    },
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Definition bounds",
    seed: "empty",
    requestKey: "create",
  });
  const ingest = (key) =>
    app.ingest(null, {
      source: "bounds",
      idempotencyKey: key,
      payload: { kind: "text", text: key === "unknown" ? "Unknown" : "Hello" },
    });
  const receipt = await ingest("initial");
  await app.worker.runOnce(null);
  const candidate = await app.ontology.propose(null, {
    patch: d25,
    evidenceIds: [receipt.evidence_id],
    requestKey: "25",
    reason: "Check inclusive boundary",
  });
  const suite = await app.evaluations.registerSuite(null, {
    name: "Boundary",
    maxCalls: 2,
    timeoutMs: 5000,
    tasks: [
      {
        kind: "extract",
        id: "value",
        evidenceId: receipt.evidence_id,
        expected: [{ conceptId: "c_0", fieldId: "value", value: "Hello" }],
      },
    ],
  });
  const evaluated = await app.evaluations.evaluate(null, {
    candidateId: candidate.candidateId,
    suiteId: suite.suiteId,
  });
  assert.equal(evaluated.passed, true);
  await app.ontology.publish(null, {
    candidateId: candidate.candidateId,
    candidateHash: candidate.hash,
    evaluationId: evaluated.evaluationId,
    evaluationHash: evaluated.hash,
    requestKey: "publish",
    reason: "25 concepts are supported",
  });
  assert.equal((await app.worker.runOnce(null)).state, "waiting_review");
  const next = await app.ontology.propose(null, {
    patch: { concepts: [concept(25)], relations: [] },
    evidenceIds: [receipt.evidence_id],
    requestKey: "26",
    reason: "Check rejection above boundary",
  });
  const before = calls;
  await assert.rejects(
    app.evaluations.evaluate(null, {
      candidateId: next.candidateId,
      suiteId: suite.suiteId,
    }),
    (e) => e.code === "BUDGET_EXHAUSTED" && !!e.details.evaluationId,
  );
  assert.equal(
    calls - before,
    1,
    "only the allowed parent context reaches the adapter",
  );
  const unresolved = await ingest("unknown");
  await app.worker.runOnce(null);
  const head = await app.ontology.inspect(null);
  const forceHead = async (d, ordinal) => {
    const id = randomUUID();
    await db.admin.query(
      "INSERT INTO ontave.versions(workspace_id,id,ordinal,parent_id,hash,definition) VALUES($1,$2,$3,$4,$5,$6)",
      [w, id, ordinal, head.id, hash(d), JSON.stringify(d)],
    );
    await db.admin.query(
      "UPDATE ontave.workspaces SET active_id=$1 WHERE workspace_id=$2",
      [id, w],
    );
  };
  // Inject valid definitions through the operator role to exercise defensive checks
  // that normal evaluation-gated publication prevents reaching.
  await forceHead(
    definition({ concepts: [...d25.concepts, concept(25)], relations: [] }),
    2,
  );
  let count = calls;
  const oversized = await ingest("too-many");
  assert.equal((await app.worker.runOnce(null)).error.code, "BUDGET_EXHAUSTED");
  assert.equal(calls, count);
  assert.equal((await app.jobs.get(null, oversized.job_id)).bundle_id, null);
  await assert.rejects(
    app.ontology.propose(null, {
      evidenceIds: [unresolved.evidence_id],
      requestKey: "oversized-generation",
      reason: "Do not silently slice definitions",
    }),
    (e) => e.code === "BUDGET_EXHAUSTED",
  );
  assert.equal(proposals, 0);
  const large = structuredClone(d25);
  large.concepts[0].fields = Array.from({ length: 100 }, (_, i) => ({
    id: "f_" + i,
    name: "Field " + i,
    description: "x".repeat(1000),
    type: "text",
  }));
  await forceHead(definition(large), 3);
  count = calls;
  const bigContext = await ingest("large-context");
  assert.equal((await app.worker.runOnce(null)).error.code, "BUDGET_EXHAUSTED");
  assert.equal(
    calls,
    count,
    "definitions count toward the complete context budget",
  );
  assert.equal(
    (await app.evidence.get(null, bigContext.evidence_id)).payload,
    "Hello",
  );
  assert.equal(
    (await db.admin.query("SELECT count(*) FROM ontave.assertions")).rows[0]
      .count,
    "0",
  );
});
