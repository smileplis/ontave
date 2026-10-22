// Real PostgreSQL governance with deterministic fictional adapter; not live discovery evidence.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createOntave, starter, hash } from "../dist/index.js";
import { fixtureAdapter } from "../dist/testing.js";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
const labels = JSON.parse(
  await readFile("fixtures/release-v1/labels.json", "utf8"),
);
const { definitions, patches } = JSON.parse(
  await readFile("fixtures/release-v1/definitions.json", "utf8"),
);
const readTasks = JSON.parse(
  await readFile("fixtures/release-v1/read-tasks.json", "utf8"),
).tasks;
const db = await disposablePostgres(),
  workspaces = { solar: randomUUID(), rental: randomUUID() },
  report = {
    mode: "deterministic complete-domain governance trace, fictional labels; automated test decisions are not human review or live discovery",
    domains: [],
  };
const model = fixtureAdapter((task) => {
  const label = labels.find((l) => l.text === task.text);
  assert.ok(label);
  const e = structuredClone(label.annotatedExample);
  const known = e.entities.filter((m) =>
    task.ontology.concepts.some((c) => c.id === m.conceptId),
  );
  const unknown = e.entities.filter((m) => !known.includes(m));
  return {
    entities: known,
    relationships: e.relationships.filter(
      (r) =>
        task.ontology.relations.some((x) => x.id === r.relationId) &&
        known.some((m) => m.mentionId === r.source) &&
        known.some((m) => m.mentionId === r.target),
    ),
    observations: [
      ...e.observations,
      ...unknown.map((m) => ({
        concept: m.conceptId,
        quote: Object.values(m.fields)[0].quote,
      })),
    ],
  };
});
const app = createOntave({
  storage: db.storage,
  model,
  sourcePolicies: {
    "fictional-bank-receipt": {
      verifiedFields: ["payment_confirmation.amount"],
    },
  },
  authorize: (context) => ({
    actorId: "fictional-domain-test",
    workspaceId: workspaces[context.domain],
    sourcePolicy: context.sourcePolicy ?? "untrusted",
    capabilities: ["provision", "read", "ingest", "worker", "review"],
  }),
});
try {
  for (const domain of ["solar", "rental"]) {
    const ctx = { domain };
    await app.workspaces.create(ctx, {
      workspaceId: workspaces[domain],
      name: domain,
      seed: "people",
      requestKey: "create",
    });
    const contract = await app.contracts.register(ctx, starter),
      subset = labels.filter((l) => l.domain === domain),
      receipts = [];
    for (const l of subset) {
      receipts.push({
        label: l,
        ...(await app.ingest(
          { domain, sourcePolicy: l.sourcePolicy },
          {
            source: l.source,
            idempotencyKey: l.id,
            payload: { kind: "text", text: l.text },
          },
        )),
      });
      await app.worker.runOnce(ctx);
    }
    assert.equal(
      (
        await app.entities.find(ctx, {
          contractId: contract.id,
          contractHash: contract.hash,
          conceptId: "person",
        })
      ).records.length,
      0,
    );
    const candidate = await app.ontology.propose(ctx, {
      patch: patches[domain],
      evidenceIds: receipts.map((r) => r.evidence_id),
      requestKey: "domain-candidate",
      reason:
        "Explicitly reviewed fictional domain patch; no runtime domain code changes",
    });
    const picked =
      domain === "solar"
        ? [
            "SOLAR-001",
            "SOLAR-013",
            "SOLAR-023",
            "SOLAR-024",
            "SOLAR-031",
            "SOLAR-034",
            "SOLAR-043",
            "SOLAR-044",
            "SOLAR-047",
            "SOLAR-050",
          ]
        : subset.map((l) => l.id);
    const tasks = receipts
      .filter((r) => picked.includes(r.label.id))
      .map((r) => ({
        id: r.label.id,
        kind: "extract",
        evidenceId: r.evidence_id,
        expected: r.label.expected,
        relationships: r.label.relationships,
        observations: r.label.observations,
      }));
    tasks.push({
      id: "old-contract",
      kind: "contract",
      contractId: contract.id,
    });
    if (domain === "solar") tasks.push(...readTasks);
    const suite = await app.evaluations.registerSuite(ctx, {
      name: domain + "-frozen-regression",
      tasks,
      maxCalls: picked.length * 2,
      timeoutMs: 30000,
    });
    const evaluation = await app.evaluations.evaluate(ctx, {
      candidateId: candidate.candidateId,
      suiteId: suite.suiteId,
    });
    assert.equal(evaluation.passed, true);
    const published = await app.ontology.publish(ctx, {
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash ?? candidate.hash,
      evaluationId: evaluation.evaluationId,
      evaluationHash: evaluation.hash,
      requestKey: "publish",
      reason: "Exact deterministic evaluation and additive patch approved",
    });
    // Activation schedules replay and never publishes the staged facts.
    assert.equal(
      (
        await app.entities.find(ctx, {
          contractId: contract.id,
          contractHash: contract.hash,
          conceptId: "person",
        })
      ).records.length,
      0,
    );
    const results = [];
    for (let n = 0; n < published.reprocessingJobs.length; n++)
      results.push(await app.worker.runOnce(ctx));
    let accepts = 0,
      identityReviews = 0,
      unresolved = 0;
    for (const receipt of receipts) {
      const j = await app.jobs.get(ctx, receipt.job_id);
      if (j.state === "waiting_ontology") {
        unresolved++;
        continue;
      }
      let b = await app.reviews.get(ctx, j.bundle_id);
      for (const mentionId of b.body.pending) {
        // Deliberately choose distinct identities without trustworthy external IDs.
        const revised = await app.reviews.resolveIdentity(ctx, {
          bundleId: b.id,
          digest: b.hash,
          mentionId,
          entityId: "new",
          requestKey: "identity-" + receipt.label.id + "-" + mentionId,
          reason:
            "No authoritative identity proof; retain distinct fictional mention",
        });
        identityReviews++;
        b = await app.reviews.get(ctx, revised.bundleId);
      }
      await app.reviews.accept(ctx, {
        bundleId: b.id,
        digest: b.hash,
        requestKey: "accept-" + receipt.label.id,
        reason: "Automated source/label test checks only",
      });
      accepts++;
    }
    const oldRead = await app.entities.find(ctx, {
      contractId: contract.id,
      contractHash: contract.hash,
      conceptId: "person",
      limit: 100,
    });
    const adopted = await app.contracts.register(ctx, definitions[domain]);
    if(domain==="solar"){
      const claims=await app.entities.find(ctx,{contractId:adopted.id,contractHash:adopted.hash,conceptId:"payment_claim",limit:100});
      const confirmations=await app.entities.find(ctx,{contractId:adopted.id,contractHash:adopted.hash,conceptId:"payment_confirmation",limit:100});
      assert.equal(claims.records.length,4);assert.ok(claims.records.every(r=>r.fields.amount.verification==="reported"));
      assert.equal(confirmations.records.length,4);assert.ok(confirmations.records.every(r=>r.fields.amount.verification==="verified"));
    }

    const newConcept = domain === "solar" ? "installation" : "asset";
    const newRead = await app.entities.find(ctx, {
      contractId: adopted.id,
      contractHash: adopted.hash,
      conceptId: newConcept,
      limit: 100,
    });
    assert.ok(newRead.records.length > 0);
    report.domains.push({
      domain,
      inputs: subset.length,
      initialVisibleRecords: 0,
      candidateHash: candidate.candidateHash ?? candidate.hash,
      evaluationHash: evaluation.hash,
      evaluationTasks: tasks.length,
      evaluationPassed: evaluation.passed,
      replays: results.length,
      acceptedBundles: accepts,
      identityReviews,
      unresolved,
      oldContractReadable: true,
      oldContractRecords: oldRead.records.length,
      newConcept,
      newRecords: newRead.records.length,
      metrics: await app.metrics.summary(ctx),
    });
  }
  report.ok = true;
  report.fixtureHash = hash(labels);
  await writeFile(
    "artifacts/domain-flows.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: true,
      domains: report.domains.map((d) => ({
        domain: d.domain,
        accepted: d.acceptedBundles,
        unresolved: d.unresolved,
        replays: d.replays,
      })),
    }),
  );
} finally {
  await app.close();
  await db.stop();
}
