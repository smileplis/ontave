import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { postgres } from "../../dist/postgres.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
test("review server needs no model and returns one scoped source/proposal snapshot without granting approval", async (t) => {
  const db = await disposablePostgres(),
    workspaceId = randomUUID(),
    other = randomUUID();
  const grants = {
    owner: {
      actorId: "owner",
      workspaceId,
      capabilities: ["provision", "ingest", "worker", "read", "review"],
    },
    reader: { actorId: "reader", workspaceId, capabilities: ["read"] },
    reviewOnly: { actorId: "reviewer", workspaceId, capabilities: ["review"] },
    other: {
      actorId: "other",
      workspaceId: other,
      capabilities: ["read", "review"],
    },
  };
  const authorize = (ctx) => {
    if (!grants[ctx]) throw Error("invalid");
    return grants[ctx];
  };
  let calls = 0;
  const worker = createOntave({
    storage: db.storage,
    authorize,
    model: fixtureAdapter(() => {
      calls++;
      return personFixture("Rahul");
    }),
  });
  const reviewStorage = postgres({ connectionString: db.connectionString });
  let transactions = 0;
  const transaction = reviewStorage.transaction.bind(reviewStorage);
  reviewStorage.transaction = (...args) => {
    transactions++;
    return transaction(...args);
  };
  const review = createOntave({ storage: reviewStorage, authorize });
  t.after(async () => {
    await review.close();
    await worker.close();
    await db.stop();
  });
  await worker.workspaces.create("owner", {
    workspaceId,
    name: "Review integration",
    requestKey: "create",
    seed: "people",
  });
  const contract = await review.contracts.register("owner", starter);
  const receipt = await review.ingest("owner", {
    source: "test",
    idempotencyKey: "message",
    payload: { kind: "text", text: "Rahul" },
  });
  const queued = await review.reviews.forJob("owner", receipt.job_id);
  assert.equal(queued.bundle, null);
  assert.equal(queued.evidence.payload, "Rahul");
  assert.equal(queued.job.state, "queued");
  await assert.rejects(
    review.worker.runOnce("owner"),
    (e) => e.code === "MODEL_UNAVAILABLE",
  );
  assert.equal((await review.jobs.get("owner", receipt.job_id)).attempts, 0);
  await assert.rejects(
    review.ontology.propose("owner", {
      evidenceIds: [receipt.evidence_id],
      requestKey: "generated",
      reason: "No configured model",
    }),
    (e) => e.code === "MODEL_UNAVAILABLE",
  );
  await worker.worker.runOnce("owner");
  const snapshot = await review.reviews.forJob("owner", receipt.job_id);
  assert.equal(snapshot.job.state, "waiting_review");
  assert.equal(snapshot.bundle.evidence_id, snapshot.evidence.id);
  assert.equal(snapshot.evidence.range.hasMore, false);
  let before = transactions;
  const job = await review.jobs.get("owner", receipt.job_id);
  const legacyBundle = await review.reviews.get("owner", snapshot.bundle.id);
  const legacySource = await review.evidence.get("owner", job.evidence_id);
  assert.equal(transactions - before, 3);
  before = transactions;
  const combined = await review.reviews.forJob("owner", receipt.job_id);
  assert.equal(transactions - before, 1);
  assert.equal(combined.bundle.hash, legacyBundle.hash);
  assert.deepEqual(combined.evidence, legacySource);
  for (const ctx of ["reader", "reviewOnly", "other", "forged"])
    await assert.rejects(review.reviews.forJob(ctx, receipt.job_id), (e) =>
      ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(e.code),
    );
  assert.equal(
    (
      await review.entities.find("owner", {
        contractId: contract.id,
        contractHash: contract.hash,
        conceptId: "person",
      })
    ).records.length,
    0,
  );
  await review.reviews.accept("owner", {
    bundleId: snapshot.bundle.id,
    digest: snapshot.bundle.hash,
    requestKey: "reviewed",
    reason: "Human checked source",
  });
  assert.equal(
    (
      await review.entities.find("owner", {
        contractId: contract.id,
        contractHash: contract.hash,
        conceptId: "person",
      })
    ).records.length,
    1,
  );
  assert.equal(calls, 1);
  const large = await review.ingest("owner", {
    source: "large",
    idempotencyKey: "large",
    payload: { kind: "text", text: "₹".repeat(4000) },
  });
  const bounded = await review.reviews.forJob("owner", large.job_id);
  assert.ok(Buffer.byteLength(bounded.evidence.payload) <= 8192);
  assert.ok(!bounded.evidence.payload.includes("\uFFFD"));
  assert.equal(bounded.evidence.range.hasMore, true);
});
