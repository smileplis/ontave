import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("trusted sources retain authority but cannot bypass types, field-specific verification or conflicting claims", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let output;
  const app = createOntave({
    storage: db.storage,
    model: fixtureAdapter(() => output),
    identifierRules: [{ authority: "crm", kind: "contact" }],
    sourcePolicies: { directory: { verifiedFields: ["person.email"] } },
    authorize: (context) => ({
      actorId: "owner",
      workspaceId: w,
      sourcePolicy: context === "trusted" ? "directory" : "untrusted",
      capabilities: ["read", "review", "ingest", "worker", "provision"],
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Source authority",
    seed: "people",
    requestKey: "create",
  });
  const contract = await app.contracts.register(null, starter),
    q = {
      contractId: contract.id,
      contractHash: contract.hash,
      conceptId: "person",
    };
  for (const [index, email] of [
    "first@example.test",
    "second@example.test",
  ].entries()) {
    output = personFixture("Asha");
    output.entities[0].identifiers = [
      { authority: "crm", kind: "contact", value: "42", quote: "42" },
    ];
    output.entities[0].fields.email = {
      value: email,
      verification: "verified",
      quote: email,
    };
    const r = await app.ingest("trusted", {
      source: "directory",
      idempotencyKey: String(index),
      payload: { kind: "text", text: "Asha 42 " + email },
    });
    assert.equal(
      (await app.evidence.get(null, r.evidence_id)).source_policy,
      "directory",
    );
    const b = await app.reviews.get(
      null,
      (await app.worker.runOnce(null)).bundleId,
    );
    await app.reviews.accept(null, {
      bundleId: b.id,
      digest: b.hash,
      requestKey: "accept-" + index,
      reason: "Retain source claim and authority",
    });
  }
  const records = (await app.entities.find(null, q)).records;
  assert.equal(records.length, 1);
  assert.equal(records[0].fields.email.state, "conflict");
  assert.deepEqual(
    records[0].fields.email.candidates.map((c) => c.verification),
    ["verified", "verified"],
  );
  for (const [key, field] of [
    ["type", { value: 42, quote: "Asha" }],
    ["scope", { value: "Asha", verification: "verified", quote: "Asha" }],
  ]) {
    output = personFixture("Asha");
    output.entities[0].fields.name = field;
    const r = await app.ingest("trusted", {
      source: "directory",
      idempotencyKey: key,
      payload: { kind: "text", text: "Asha" },
    });
    const result = await app.worker.runOnce(null);
    assert.equal(result.error.code, "VALIDATION_FAILED");
    assert.equal((await app.jobs.get(null, r.job_id)).state, "failed");
    assert.equal(
      (await app.evidence.get(null, r.evidence_id)).source_policy,
      "directory",
    );
  }
  assert.deepEqual((await app.entities.find(null, q)).records, records);
});
