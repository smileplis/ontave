import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
test("one-hop links preserve independent evidence, bound endpoints and replay retractions", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let output;
  const app = createOntave({
    storage: db.storage,
    model: fixtureAdapter((task) =>
      typeof output === "function" ? output(task) : output,
    ),
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "ingest", "worker", "read", "review"],
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Links",
    seed: "people",
    requestKey: "create",
  });
  const patch = {
    concepts: [],
    relations: [
      {
        id: "member",
        name: "Member",
        source: "person",
        target: "organization",
      },
      {
        id: "primary",
        name: "Primary",
        source: "person",
        target: "organization",
        max: 1,
      },
    ],
  };
  const text =
    "Link source: " +
    Array.from(
      { length: 26 },
      (_, i) => "Organization " + String(i + 1).padStart(2, "0"),
    ).join(", ");
  const all = {
    entities: [
      {
        mentionId: "source",
        conceptId: "person",
        name: "Link source",
        fields: { name: { value: "Link source", quote: "Link source" } },
      },
      ...Array.from({ length: 26 }, (_, i) => {
        const name = "Organization " + String(i + 1).padStart(2, "0");
        return {
          mentionId: "org_" + i,
          conceptId: "organization",
          name,
          fields: { name: { value: name, quote: name } },
        };
      }),
    ],
    relationships: [
      ...Array.from({ length: 26 }, (_, i) => ({
        source: "source",
        target: "org_" + i,
        relationId: "member",
        quote: text,
      })),
      { source: "source", target: "org_0", relationId: "primary", quote: text },
    ],
    observations: [],
  };
  output = (task) =>
    task.ontology.relations.length
      ? all
      : {
          ...all,
          relationships: [],
          observations: [{ concept: "Membership", quote: text }],
        };
  const receipt = await app.ingest(null, {
    source: "links",
    idempotencyKey: "all",
    payload: { kind: "text", text },
  });
  await app.worker.runOnce(null);
  const candidate = await app.ontology.propose(null, {
    patch,
    evidenceIds: [receipt.evidence_id],
    requestKey: "patch",
    reason: "One-hop relationship semantics",
  });
  const suite = await app.evaluations.registerSuite(null, {
    name: "links",
    maxCalls: 2,
    timeoutMs: 10000,
    tasks: [
      {
        id: "links",
        kind: "extract",
        evidenceId: receipt.evidence_id,
        expected: all.entities.map((e) => ({
          conceptId: e.conceptId,
          fieldId: "name",
          value: e.name,
        })),
        relationships: all.relationships.map((r) => ({
          relationId: r.relationId,
          source: { conceptId: "person", name: "Link source" },
          target: {
            conceptId: "organization",
            name: all.entities.find((e) => e.mentionId === r.target).name,
          },
          quote: text,
        })),
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
    reason: "Exact link evaluation",
  });
  const work = await app.worker.runOnce(null),
    b = await app.reviews.get(null, work.bundleId);
  await app.reviews.accept(null, {
    bundleId: b.id,
    digest: b.hash,
    requestKey: "accept-all",
    reason: "Checked fictional endpoints",
  });
  const contract = await app.contracts.register(null, {
      ...starter,
      relations: patch.relations,
    }),
    q = {
      contractId: contract.id,
      contractHash: contract.hash,
      conceptId: "person",
      include: ["member", "primary"],
    };
  let source = (await app.entities.find(null, q)).records[0];
  const sourceId = source.id;
  await t.test(
    "26 endpoints return a bounded 25 plus explicit continuation",
    async () => {
      assert.equal(source.relationships.member.items.length, 25);
      assert.equal(source.relationships.member.hasMore, true);
      assert.equal(
        new Set(source.relationships.member.items.map((x) => x.id)).size,
        25,
      );
      assert.equal(source.relationships.primary.items.length, 1);
    },
  );
  let secondEvidence, firstLink;
  const stagePair = async (key, targetId, targetName) => {
    const text = "Link source is linked to " + targetName;
    output = {
      entities: [
        {
          mentionId: "source",
          conceptId: "person",
          name: "Link source",
          existingId: sourceId,
          fields: { name: { value: "Link source", quote: "Link source" } },
        },
        {
          mentionId: "target",
          conceptId: "organization",
          name: targetName,
          existingId: targetId,
          fields: { name: { value: targetName, quote: targetName } },
        },
      ],
      relationships: [
        {
          source: "source",
          target: "target",
          relationId: "primary",
          quote: text,
        },
      ],
      observations: [],
    };
    const receipt = await app.ingest(null, {
        source: "links",
        idempotencyKey: key,
        payload: { kind: "text", text },
      }),
      result = await app.worker.runOnce(null);
    let b = await app.reviews.get(null, result.bundleId);
    for (const [mentionId, entityId] of [
      ["source", sourceId],
      ["target", targetId],
    ]) {
      const r = await app.reviews.resolveIdentity(null, {
        bundleId: b.id,
        digest: b.hash,
        mentionId,
        entityId,
        requestKey: key + "-" + mentionId,
        reason: "Explicitly checked existing endpoint",
      });
      b = await app.reviews.get(null, r.bundleId);
    }
    return { receipt, b };
  };
  const primary = source.relationships.primary.items[0],
    otherOrg = (
      await db.admin.query(
        "SELECT id,name FROM ontave.entities WHERE workspace_id=$1 AND concept_id='organization' AND id<>$2 ORDER BY id LIMIT 1",
        [w, primary.id],
      )
    ).rows[0];
  const firstOrg = (
    await db.admin.query("SELECT name FROM ontave.entities WHERE id=$1", [
      primary.id,
    ])
  ).rows[0].name;
  await t.test(
    "a distinct source retains another supporting assertion without duplicating the edge",
    async () => {
      const { receipt, b } = await stagePair(
        "second-source",
        primary.id,
        firstOrg,
      );
      secondEvidence = receipt.evidence_id;
      await app.reviews.accept(null, {
        bundleId: b.id,
        digest: b.hash,
        requestKey: "accept-second-source",
        reason: "Independent source supports same edge",
      });
      const history = (await app.assertions.explain(null, sourceId)).filter(
        (a) => a.relation_id === "primary" && a.kind === "set",
      );
      assert.equal(history.length, 2);
      assert.equal(new Set(history.map((a) => a.evidence_id)).size, 2);
      source = (await app.entities.find(null, q)).records[0];
      assert.equal(source.relationships.primary.items.length, 1);
      firstLink = history;
    },
  );
  await t.test(
    "a reviewed replacement accounts for all planned retractions atomically",
    async () => {
      const { b } = await stagePair("replacement", otherOrg.id, otherOrg.name);
      await assert.rejects(
        app.reviews.accept(null, {
          bundleId: b.id,
          digest: b.hash,
          requestKey: "conflicting-edge",
          reason: "Conflict is not resolved",
        }),
        (e) => e.code === "UNRESOLVED_CONFLICT",
      );
      const amended = await app.reviews.amend(null, {
        bundleId: b.id,
        digest: b.hash,
        extraction: b.body.extraction,
        retractions: firstLink.map((a) => a.id),
        requestKey: "amend-replacement",
        reason: "Both old supporting claims are explicitly withdrawn",
      });
      await app.reviews.accept(null, {
        bundleId: amended.bundleId,
        digest: amended.digest,
        requestKey: "accept-replacement",
        reason: "Exact replacement and withdrawals checked",
      });
      source = (await app.entities.find(null, q)).records[0];
      assert.equal(source.relationships.primary.items.length, 1);
      assert.equal(source.relationships.primary.items[0].id, otherOrg.id);
    },
  );
  await t.test(
    "replaying an old source cannot resurrect its withdrawn relationship",
    async () => {
      await app.jobs.reprocess(null, {
        evidenceId: secondEvidence,
        requestKey: "replay-second",
        reason: "Check retraction reconciliation",
      });
      output = {
        entities: [
          {
            mentionId: "source",
            conceptId: "person",
            name: "Link source",
            fields: { name: { value: "Link source", quote: "Link source" } },
          },
          {
            mentionId: "target",
            conceptId: "organization",
            name: firstOrg,
            fields: { name: { value: firstOrg, quote: firstOrg } },
          },
        ],
        relationships: [
          {
            source: "source",
            target: "target",
            relationId: "primary",
            quote: "Link source is linked to " + firstOrg,
          },
        ],
        observations: [],
      };
      const replay = await app.worker.runOnce(null);
      let b = await app.reviews.get(null, replay.bundleId);
      assert.equal(b.body.resolutions.source.entityId, sourceId);
      // The old link is already withdrawn. The still-current replacement must not be silently displaced.
      await assert.rejects(
        app.reviews.accept(null, {
          bundleId: b.id,
          digest: b.hash,
          requestKey: "accept-old-link",
          reason: "No new authority to reinstate withdrawn link",
        }),
        (e) => e.code === "UNRESOLVED_CONFLICT",
      );
      assert.equal(
        (await app.entities.find(null, q)).records[0].relationships.primary
          .items[0].id,
        otherOrg.id,
      );
    },
  );
});
