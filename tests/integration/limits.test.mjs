import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { migrationPlan, migrate } from "../../dist/postgres.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("transaction failures, deadlines, immutable migration checks and scoped limits", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let calls = 0,
    handler = (task) => personFixture(task.text);
  const app = createOntave({
    storage: db.storage,
    authorize: () => ({
      actorId: "test",
      workspaceId: w,
      capabilities: ["read", "review", "ingest", "worker", "provision"],
    }),
    model: fixtureAdapter((task) => {
      calls++;
      return handler(task);
    }),
    limits: { modelTimeoutMs: 25 },
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Limits",
    requestKey: "create",
    seed: "people",
  });
  await t.test(
    "an idle database connection loss reconnects without crashing or leaking connection details",
    async () => {
      const before = (
        await db.storage.transaction(w, (c) =>
          c.query("SELECT pg_backend_pid() AS pid"),
        )
      ).rows[0].pid;
      await db.admin.query("SELECT pg_terminate_backend($1)", [before]);
      await new Promise((r) => setTimeout(r, 50));
      const after = (
        await db.storage.transaction(w, (c) =>
          c.query("SELECT pg_backend_pid() AS pid"),
        )
      ).rows[0].pid;
      assert.notEqual(after, before);
      assert.equal(
        (await app.ontology.inspect(null)).definition.concepts.length,
        starter.concepts.length,
      );
    },
  );
  await t.test(
    "scoped provisioners cannot switch workspaces through input",
    async () => {
      await assert.rejects(
        app.workspaces.create(null, {
          workspaceId: randomUUID(),
          name: "forged",
          requestKey: "forged",
          seed: "empty",
        }),
        (e) => e.code === "FORBIDDEN",
      );
    },
  );
  await t.test(
    "migrations are idempotent and refuse tampered applied checksums",
    async () => {
      assert.ok((await migrationPlan(db.admin)).every((m) => !m.pending));
      await migrate(db.admin, "ontave_runtime");
      const original = (
        await db.admin.query(
          "SELECT checksum FROM ontave.migrations WHERE version=1",
        )
      ).rows[0].checksum;
      await db.admin.query(
        "UPDATE ontave.migrations SET checksum='tampered' WHERE version=1",
      );
      await assert.rejects(
        migrate(db.admin, "ontave_runtime"),
        (e) => e.code === "VALIDATION_FAILED",
      );
      await db.admin.query(
        "UPDATE ontave.migrations SET checksum=$1 WHERE version=1",
        [original],
      );
      assert.ok((await migrationPlan(db.admin)).every((m) => !m.pending));
    },
  );
  await t.test(
    "failure between evidence and job insertion rolls back the entire receipt",
    async () => {
      await db.admin.query(
        "CREATE FUNCTION ontave.fail_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$",
      );
      await db.admin.query(
        "CREATE TRIGGER fail_test_job BEFORE INSERT ON ontave.jobs FOR EACH ROW EXECUTE FUNCTION ontave.fail_test_job()",
      );
      const input = {
        source: "failure",
        idempotencyKey: "1",
        payload: { kind: "text", text: "Asha" },
      };
      try {
        await assert.rejects(app.ingest(null, input));
        assert.equal(
          (
            await db.admin.query(
              "SELECT count(*) FROM ontave.evidence WHERE workspace_id=$1",
              [w],
            )
          ).rows[0].count,
          "0",
        );
      } finally {
        await db.admin.query("DROP TRIGGER fail_test_job ON ontave.jobs");
        await db.admin.query("DROP FUNCTION ontave.fail_test_job()");
      }
      const receipt = await app.ingest(null, input);
      const work = await app.worker.runOnce(null);
      assert.equal(work.state, "waiting_review");
      assert.equal(
        (await app.jobs.get(null, receipt.job_id)).state,
        "waiting_review",
      );
    },
  );
  await t.test(
    "non-cooperating adapters are bounded and each failed attempt retains history",
    async () => {
      handler = () => new Promise(() => {});
      const r = await app.ingest(null, {
        source: "timeout",
        idempotencyKey: "1",
        payload: { kind: "text", text: "Timeout" },
      });
      const start = Date.now();
      await app.worker.runOnce(null);
      assert.ok(Date.now() - start < 1000);
      assert.equal(
        (await app.jobs.get(null, r.job_id)).state,
        "retry_scheduled",
      );
      await db.admin.query(
        "UPDATE ontave.jobs SET next_at=now()-interval '1 second' WHERE id=$1",
        [r.job_id],
      );
      await app.worker.runOnce(null);
      const job = await app.jobs.get(null, r.job_id);
      assert.equal(job.state, "failed");
      assert.equal(job.calls, 2);
      const errors = (
        await db.admin.query("SELECT error FROM ontave.runs WHERE job_id=$1", [
          r.job_id,
        ])
      ).rows;
      assert.equal(errors.length, 2);
      assert.ok(
        errors.every(
          (r) =>
            r.error.code === "MODEL_UNAVAILABLE" && r.error.usage === "unknown",
        ),
      );
      assert.equal(await app.worker.runOnce(null), null);
    },
  );
  await t.test(
    "evaluation has an independent deadline and never mutates accepted records",
    async () => {
      handler = () => ({
        entities: [],
        relationships: [],
        observations: [{ concept: "Installation", quote: "I-101" }],
      });
      const r = await app.ingest(null, {
        source: "evolution",
        idempotencyKey: "1",
        payload: { kind: "text", text: "I-101" },
      });
      await app.worker.runOnce(null);
      const candidate = await app.ontology.propose(null, {
        patch: {
          concepts: [
            {
              id: "installation",
              name: "Installation",
              description: "Scheduled work",
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
        },
        evidenceIds: [r.evidence_id],
        requestKey: "candidate",
        reason: "Represent installation",
      });
      const suite = await app.evaluations.registerSuite(null, {
        name: "deadline",
        maxCalls: 2,
        timeoutMs: 30,
        tasks: [
          {
            id: "install",
            kind: "extract",
            evidenceId: r.evidence_id,
            expected: [
              {
                conceptId: "installation",
                fieldId: "reference",
                value: "I-101",
              },
            ],
          },
        ],
      });
      handler = () => new Promise(() => {});
      const start = Date.now();
      let failedEvaluation;
      await assert.rejects(
        app.evaluations.evaluate(null, {
          candidateId: candidate.candidateId,
          suiteId: suite.suiteId,
        }),
        (e) => {
          failedEvaluation = e.details?.evaluationId;
          return e.code === "EVALUATION_INCOMPLETE";
        },
      );
      assert.ok(failedEvaluation);
      const failed = await app.evaluations.get(null, failedEvaluation);
      assert.equal(failed.passed, false);
      assert.equal(failed.report.status, "failed");
      assert.equal(failed.report.failure.code, "EVALUATION_INCOMPLETE");
      assert.equal(failed.report.calls, 1);
      assert.ok(Date.now() - start < 1000);
      assert.equal((await app.ontology.inspect(null)).ordinal, 0);
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM ontave.assertions")).rows[0]
          .count,
        "0",
      );
    },
  );
  await t.test(
    "canonical JSON ingestion carries source paths into accepted provenance",
    async () => {
      handler = (task) => {
        assert.equal(task.kind, "json");
        const value = personFixture("Asha");
        value.entities[0].fields.name.path = "/profile/name";
        return value;
      };
      const r = await app.ingest(null, {
        source: "json",
        idempotencyKey: "1",
        payload: {
          kind: "json",
          value: { profile: { name: "Asha" }, items: [1, null] },
        },
      });
      const staged = await app.worker.runOnce(null);
      assert.equal(staged.state, "waiting_review");
      const b = await app.reviews.get(null, staged.bundleId);
      const accepted = await app.reviews.accept(null, {
        bundleId: b.id,
        digest: b.hash,
        requestKey: "accept-json",
        reason: "Check typed JSON source",
      });
      const history = await app.assertions.explain(null, accepted.entityIds[0]);
      assert.equal(history[0].span.path, "/profile/name");
      assert.deepEqual(
        JSON.parse((await app.evidence.get(null, r.evidence_id)).payload),
        { profile: { name: "Asha" }, items: [1, null] },
      );
    },
  );
  await t.test(
    "metadata allowlists and UTF-8 source excerpt boundaries are enforced",
    async () => {
      await assert.rejects(
        app.ingest(null, {
          source: "metadata",
          idempotencyKey: "1",
          payload: { kind: "text", text: "Asha" },
          metadata: { workspaceId: w },
        }),
        (e) => e.code === "INVALID_INPUT",
      );
      const r = await app.ingest(null, {
        source: "excerpt",
        idempotencyKey: "1",
        payload: { kind: "text", text: "🙂".repeat(2500) },
      });
      const first = await app.evidence.get(null, r.evidence_id);
      assert.equal(Buffer.byteLength(first.payload), 8192);
      assert.equal(first.range.hasMore, true);
      const second = await app.evidence.get(null, r.evidence_id, {
        startByte: first.range.nextStartByte,
      });
      assert.equal(first.payload + second.payload, "🙂".repeat(2500));
      await assert.rejects(
        app.evidence.get(null, r.evidence_id, { startByte: 1 }),
        (e) => e.code === "INVALID_INPUT",
      );
      await assert.rejects(
        app.evidence.get(null, r.evidence_id, { limitBytes: 9000 }),
        (e) => e.code === "INVALID_INPUT",
      );
    },
  );
});
