// Reproducible operation-count comparison, not a human productivity study or live-model trial.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createOntave, starter } from "../dist/index.js";
import { fixtureAdapter, personFixture } from "../dist/testing.js";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
const db = await disposablePostgres(),
  w = randomUUID(),
  other = randomUUID();
let modelCalls = 0;
const app = createOntave({
  storage: db.storage,
  authorize: (ctx) => ({
    actorId: "benefit-harness",
    workspaceId: ctx === "other" ? other : w,
    capabilities: ["provision", "read", "ingest", "worker", "review"],
  }),
  model: fixtureAdapter((task) => {
    modelCalls++;
    return personFixture(task.text);
  }),
});
try {
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Benefit measurement",
    seed: "people",
    requestKey: "create",
  });
  await app.workspaces.create("other", {
    workspaceId: other,
    name: "Empty comparison",
    seed: "people",
    requestKey: "create",
  });
  const contract = await app.contracts.register(null, starter),
    query = {
      contractId: contract.id,
      contractHash: contract.hash,
      conceptId: "person",
      limit: 100,
    };
  const distinctInputs = 100,
    deliveriesPerInput = 5,
    requests = [];
  for (let i = 0; i < distinctInputs; i++)
    requests.push({
      source: "redelivery",
      idempotencyKey: String(i),
      payload: { kind: "text", text: `Person ${i}` },
    });
  const at = performance.now();
  for (const input of requests)
    for (let n = 0; n < deliveriesPerInput; n++) await app.ingest(null, input);
  const ingestMs = performance.now() - at;
  for (let i = 0; i < distinctInputs; i++)
    assert.equal((await app.worker.runOnce(null)).state, "waiting_review");
  assert.equal(modelCalls, distinctInputs);
  const beforeReview = (await app.entities.find(null, query)).records.length;
  assert.equal(beforeReview, 0);
  for (const job of await app.jobs.list(null)) {
    const b = await app.reviews.get(null, job.bundle_id);
    await app.reviews.accept(null, {
      bundleId: b.id,
      digest: b.hash,
      requestKey: job.id,
      reason:
        "Automated check of deterministic fictional input; no human timing claim",
    });
  }
  const callsBeforeReads = modelCalls,
    reads = 1000,
    readAt = performance.now();
  for (let i = 0; i < reads; i++)
    assert.equal((await app.entities.find(null, query)).records.length, 100);
  const readMs = performance.now() - readAt;
  const metrics = await app.metrics.summary(null);
  assert.equal((await app.metrics.summary("other")).totals.evidence, 0);
  assert.equal(metrics.totals.source_referenced_assertions, 100);
  assert.equal(metrics.reviews.accept, 100);
  assert.equal(modelCalls - callsBeforeReads, 0);
  const report = {
    method:
      "deterministic fictional adapter and real disposable PostgreSQL; automated approvals; no live model, manual-entry comparison or human review-time study",
    generatedAt: new Date().toISOString(),
    node: process.version,
    distinctInputs,
    deliveryRequests: distinctInputs * deliveriesPerInput,
    actualExtractionCalls: modelCalls,
    comparison: {
      baseline:
        "One extraction call per delivery without receipt idempotency; operation-count counterfactual only",
      baselineCalls: distinctInputs * deliveriesPerInput,
      avoidedCalls: distinctInputs * (deliveriesPerInput - 1),
      avoidedFraction: (deliveriesPerInput - 1) / deliveriesPerInput,
    },
    reads: {
      requests: reads,
      recordsPerRequest: 100,
      modelCalls: modelCalls - callsBeforeReads,
      totalMs: readMs,
    },
    review: {
      acceptedRecords: 100,
      visibleBeforeReview: beforeReview,
      acceptanceDecisions: metrics.reviews.accept,
      identityDecisions: metrics.reviews.resolveIdentity ?? 0,
      amendments: metrics.reviews.amend ?? 0,
      humanSeconds: null,
    },
    provenance: {
      acceptedFieldAssertions: metrics.totals.field_assertions,
      sourceReferencedAssertions: metrics.totals.source_referenced_assertions,
    },
    ingestMs,
    metrics,
  };
  await writeFile(
    "artifacts/user-benefits.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: true,
      avoidedCalls: report.comparison.avoidedCalls,
      duplicateCallReduction: report.comparison.avoidedFraction,
      providerCallsForReads: report.reads.modelCalls,
      sourceCoverage: 100,
    }),
  );
} finally {
  await app.close();
  await db.stop();
}
