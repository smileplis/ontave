import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter, hash } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("every public operation preserves workspace scope, host authority and provisioning atomicity", async (t) => {
  const db = await disposablePostgres();
  const ids = { a: randomUUID(), b: randomUUID(), fresh: randomUUID() };
  const full = ["read", "review", "worker", "provision", "ingest"];
  const tasks = [];
  const app = createOntave({
    storage: db.storage,
    authorize: (ctx) =>
      ctx === "empty-actor"
        ? { workspaceId: ids.a, actorId: "", capabilities: full }
        : Object.hasOwn(ids, ctx)
          ? { workspaceId: ids[ctx], actorId: ctx, capabilities: full }
          : null,
    identifierRules: [{ authority: "crm", kind: "contact" }],
    model: fixtureAdapter((task) => {
      tasks.push(task);
      if (task.text === "I-9")
        return task.ontology.concepts.some((c) => c.id === "installation")
          ? {
              entities: [
                {
                  mentionId: "i",
                  conceptId: "installation",
                  name: "I-9",
                  fields: { reference: { value: "I-9", quote: "I-9" } },
                },
              ],
              relationships: [],
              observations: [],
            }
          : {
              entities: [],
              relationships: [],
              observations: [{ concept: "Installation", quote: "I-9" }],
            };
      const output = personFixture(task.text.split(" ")[0]);
      output.entities[0].identifiers = [
        { authority: "crm", kind: "contact", value: "42", quote: "42" },
      ];
      output.entities[0].fields.email = {
        value: "shared@example.test",
        quote: "shared@example.test",
      };
      return output;
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  const setup = (ctx) => ({
    workspaceId: ids[ctx],
    name: ctx,
    seed: "people",
    requestKey: "provision",
  });
  for (const ctx of ["a", "b"]) await app.workspaces.create(ctx, setup(ctx));
  const enqueue = (ctx, key, text) =>
    app.ingest(ctx, {
      source: "scope",
      idempotencyKey: key,
      payload: { kind: "text", text },
    });
  const accept = (ctx, b, key) =>
    app.reviews.accept(ctx, {
      bundleId: b.id,
      digest: b.hash,
      requestKey: key,
      reason: "Fictional authority check",
    });
  const data = {};
  for (const ctx of ["a", "b"]) {
    const receipt = await enqueue(
      ctx,
      "person",
      `${ctx === "a" ? "Alpha" : "Beta"} 42 shared@example.test`,
    );
    const work = await app.worker.runOnce(ctx),
      bundle = await app.reviews.get(ctx, work.bundleId);
    const accepted = await accept(ctx, bundle, "accept");
    const entityId = accepted.entityIds[0];
    data[ctx] = {
      receipt,
      bundle,
      entityId,
      assertion: (await app.assertions.explain(ctx, entityId))[0],
      contract: await app.contracts.register(ctx, starter),
    };
  }
  assert.notEqual(
    data.a.entityId,
    data.b.entityId,
    "equal identifiers and email across workspaces cannot confer identity",
  );
  const patch = {
    concepts: [
      {
        id: "installation",
        name: "Installation",
        description: "Work",
        fields: [
          {
            id: "reference",
            name: "Reference",
            description: "Work reference",
            type: "text",
          },
        ],
      },
    ],
    relations: [],
  };
  const obs = await enqueue("b", "concept", "I-9");
  await app.worker.runOnce("b");
  const candidate = await app.ontology.propose("b", {
    patch,
    evidenceIds: [obs.evidence_id],
    requestKey: "proposal",
    reason: "Test work concept",
  });
  const suite = await app.evaluations.registerSuite("b", {
    name: "Work",
    maxCalls: 2,
    timeoutMs: 5000,
    tasks: [
      {
        id: "new",
        kind: "extract",
        evidenceId: obs.evidence_id,
        expected: [
          { conceptId: "installation", fieldId: "reference", value: "I-9" },
        ],
      },
    ],
  });
  const evaluation = await app.evaluations.evaluate("b", {
    candidateId: candidate.candidateId,
    suiteId: suite.suiteId,
  });
  assert.equal(evaluation.passed, true);
  const snapshot = async () => {
    const tables = (
      await db.admin.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='ontave' ORDER BY table_name",
      )
    ).rows;
    const result = {};
    for (const { table_name } of tables)
      result[table_name] = (
        await db.admin.query(
          `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') data FROM ontave.${table_name} t`,
        )
      ).rows[0].data;
    return hash(result);
  };
  await t.test(
    "foreign IDs fail across evidence, jobs, reviews, assertions, candidates, suites, evaluations and contracts without writes",
    async () => {
      const b = data.b,
        before = await snapshot();
      const review = {
        bundleId: b.bundle.id,
        digest: b.bundle.hash,
        requestKey: "foreign",
        reason: "No authorization by possessing ID",
      };
      const correction = {
        targetAssertionId: b.assertion.id,
        expectedRevision: 1,
        statement: "Fictional statement",
        value: "No",
        requestKey: "foreign",
        reason: "Foreign ID",
      };
      for (const [name, invoke] of [
        ["evidence", () => app.evidence.get("a", b.receipt.evidence_id)],
        ["job", () => app.jobs.get("a", b.receipt.job_id)],
        ["attempts", () => app.jobs.attempts("a", b.receipt.job_id)],
        [
          "reprocess",
          () =>
            app.jobs.reprocess("a", {
              evidenceId: b.receipt.evidence_id,
              requestKey: "foreign",
              reason: "Foreign",
            }),
        ],
        ...["get", "accept", "reject", "amend", "resolveIdentity"].map(
          (method) => [
            "review." + method,
            () =>
              method === "get"
                ? app.reviews.get("a", b.bundle.id)
                : app.reviews[method]("a", {
                    ...review,
                    extraction: b.bundle.body.extraction,
                    mentionId: "person_1",
                    entityId: "new",
                  }),
          ],
        ),
        ...["correct", "retract"].map((method) => [
          method,
          () => app.assertions[method]("a", correction),
        ]),
        [
          "attest",
          () =>
            app.assertions.attest("a", {
              ...correction,
              entityId: b.entityId,
              fieldId: "name",
            }),
        ],
        [
          "resolveConflict",
          () =>
            app.reviews.resolveConflict("a", {
              ...correction,
              entityId: b.entityId,
              fieldId: "name",
              selectedAssertionId: b.assertion.id,
            }),
        ],
        ["diff", () => app.ontology.diff("a", candidate.candidateId)],
        [
          "propose",
          () =>
            app.ontology.propose("a", {
              patch,
              evidenceIds: [obs.evidence_id],
              requestKey: "foreign",
              reason: "Foreign",
            }),
        ],
        [
          "rejectCandidate",
          () =>
            app.ontology.reject("a", {
              candidateId: candidate.candidateId,
              candidateHash: candidate.hash,
              requestKey: "foreign",
              reason: "Foreign",
            }),
        ],
        [
          "publish",
          () =>
            app.ontology.publish("a", {
              candidateId: candidate.candidateId,
              candidateHash: candidate.hash,
              evaluationId: evaluation.evaluationId,
              evaluationHash: evaluation.hash,
              requestKey: "foreign",
              reason: "Foreign",
            }),
        ],
        ["evaluation", () => app.evaluations.get("a", evaluation.evaluationId)],
        [
          "evaluate",
          () =>
            app.evaluations.evaluate("a", {
              candidateId: candidate.candidateId,
              suiteId: suite.suiteId,
            }),
        ],
        [
          "suite",
          () =>
            app.evaluations.registerSuite("a", {
              name: "Foreign",
              maxCalls: 2,
              timeoutMs: 5000,
              tasks: [
                {
                  kind: "extract",
                  id: "foreign",
                  evidenceId: obs.evidence_id,
                  expected: [],
                },
              ],
            }),
        ],
        ["contract", () => app.contracts.pull("a", b.contract.id)],
        [
          "find",
          () =>
            app.entities.find("a", {
              contractId: b.contract.id,
              contractHash: b.contract.hash,
              conceptId: "person",
            }),
        ],
      ])
        await assert.rejects(
          invoke(),
          (e) =>
            [
              "NOT_FOUND",
              "STALE_BUNDLE",
              "STALE_BASE",
              "INVALID_INPUT",
              "VALIDATION_FAILED",
              "CONTRACT_NOT_AVAILABLE",
              "EVALUATION_INCOMPLETE",
            ].includes(e.code),
          name,
        );
      assert.deepEqual(await app.assertions.explain("a", b.entityId), []);
      assert.equal((await app.jobs.list("a")).length, 1);
      assert.equal((await app.ontology.inspect("a")).ordinal, 0);
      assert.equal((await app.metrics.summary("a")).totals.evidence, 1);
      assert.equal(await snapshot(), before);
    },
  );
  await t.test(
    "absent host actors cannot be replaced by names embedded in a request",
    async () => {
      const before = await snapshot();
      for (const ctx of [null, "empty-actor", "owner"])
        await assert.rejects(
          app.reviews.accept(ctx, {
            actorId: "owner",
            workspaceId: ids.b,
            bundleId: data.b.bundle.id,
            digest: data.b.bundle.hash,
            requestKey: "forged-host",
            reason: "Text cannot grant authority",
          }),
          (e) => e.code === "UNAUTHORIZED",
        );
      assert.equal(await snapshot(), before);
    },
  );
  await t.test(
    "worker scope cannot discover or claim another workspace queue or include its identity candidates",
    async () => {
      const pending = await enqueue(
        "b",
        "only-b",
        "Beta 42 shared@example.test",
      );
      const calls = tasks.length;
      assert.equal(await app.worker.runOnce("a"), null);
      assert.equal(tasks.length, calls);
      assert.equal((await app.jobs.get("b", pending.job_id)).state, "queued");
      await app.worker.runOnce("b");
      const task = tasks.at(-1);
      assert.ok(task.candidates.every((c) => c.id !== data.a.entityId));
      assert.ok(task.candidates.some((c) => c.id === data.b.entityId));
    },
  );
  await t.test(
    "failed provisioning cannot leave an orphan workspace or seed version",
    async () => {
      await db.admin.query(
        "CREATE FUNCTION ontave.fail_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected seed failure'; END $$",
      );
      await db.admin.query(
        "CREATE TRIGGER fail_seed BEFORE INSERT ON ontave.versions FOR EACH ROW EXECUTE FUNCTION ontave.fail_seed()",
      );
      try {
        await assert.rejects(
          app.workspaces.create("fresh", setup("fresh")),
          (e) => e.code === "STORAGE_UNAVAILABLE",
        );
        assert.equal(
          (
            await db.admin.query(
              "SELECT count(*) FROM ontave.workspaces WHERE workspace_id=$1",
              [ids.fresh],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(
          (
            await db.admin.query(
              "SELECT count(*) FROM ontave.versions WHERE workspace_id=$1",
              [ids.fresh],
            )
          ).rows[0].count,
          "0",
        );
      } finally {
        await db.admin.query("DROP TRIGGER fail_seed ON ontave.versions");
        await db.admin.query("DROP FUNCTION ontave.fail_seed()");
      }
      assert.deepEqual(
        await app.workspaces.create("fresh", setup("fresh")),
        await app.workspaces.create("fresh", setup("fresh")),
      );
      await assert.rejects(
        app.workspaces.create("fresh", { ...setup("fresh"), name: "changed" }),
        (e) => e.code === "IDEMPOTENCY_CONFLICT",
      );
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.versions WHERE workspace_id=$1",
            [ids.fresh],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
});
