import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { createOntave, starter } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
test("activation and replay scheduling are atomic, old approvals stay exact and reuse hints retain rejection history", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let last, oldBundle, releaseOld, startedOld;
  const oldStarted = new Promise((resolve) => {
    startedOld = resolve;
  });
  const oldGate = new Promise((resolve) => {
    releaseOld = resolve;
  });
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
  const app = createOntave({
    storage: db.storage,
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "read", "ingest", "worker", "review"],
    }),
    model: fixtureAdapter(async (task) => {
      if (task.text === "Rahul") {
        startedOld();
        await oldGate;
        return personFixture("Rahul");
      }
      return task.ontology.concepts.some((c) => c.id === "installation")
        ? {
            entities: [
              {
                mentionId: "work",
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
    }),
  });
  t.after(async () => {
    releaseOld();
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Activation faults",
    seed: "people",
    requestKey: "create",
  });
  const oldContract = await app.contracts.register(null, starter);
  const originalHead = await app.ontology.inspect(null);
  await app.ingest(null, {
    source: "fault",
    idempotencyKey: "old-bundle",
    payload: { kind: "text", text: "Rahul" },
  });
  const oldWork = app.worker.runOnce(null);
  await oldStarted;
  const receipt = await app.ingest(null, {
    source: "fault",
    idempotencyKey: "extension",
    payload: { kind: "text", text: "I-9" },
  });
  await app.worker.runOnce(null);
  const candidate = await app.ontology.propose(null, {
      patch,
      evidenceIds: [receipt.evidence_id],
      requestKey: "propose",
      reason: "Represent work",
    }),
    suite = await app.evaluations.registerSuite(null, {
      name: "work",
      maxCalls: 2,
      timeoutMs: 5000,
      tasks: [
        { kind: "contract", id: "old", contractId: oldContract.id },
        {
          kind: "extract",
          id: "new",
          evidenceId: receipt.evidence_id,
          expected: [
            { conceptId: "installation", fieldId: "reference", value: "I-9" },
          ],
        },
      ],
    });
  const evaluated = await app.evaluations.evaluate(null, {
    candidateId: candidate.candidateId,
    suiteId: suite.suiteId,
  });
  assert.equal(evaluated.passed, true);
  const request = {
    candidateId: candidate.candidateId,
    candidateHash: candidate.hash,
    evaluationId: evaluated.evaluationId,
    evaluationHash: evaluated.hash,
    requestKey: "publish",
    reason: "Exact passing evidence reviewed",
  };
  await t.test(
    "duplicate evidence IDs cannot inflate proposal support",
    async () => {
      const duplicate = await app.ontology.propose(null, {
        patch,
        evidenceIds: [receipt.evidence_id, receipt.evidence_id],
        requestKey: "duplicate-support",
        reason: "Repeated delivery remains one source",
      });
      assert.equal(duplicate.hash, candidate.hash);
      assert.deepEqual(
        (await app.ontology.diff(null, duplicate.candidateId)).observations,
        [receipt.evidence_id],
      );
      await app.ontology.reject(null, {
        candidateId: duplicate.candidateId,
        candidateHash: duplicate.hash,
        requestKey: "cancel-duplicate",
        reason: "Retain one proposal for review",
      });
      assert.equal((await app.ontology.inspect(null)).id, originalHead.id);
    },
  );
  await t.test(
    "changed candidate or evaluation hashes cannot reuse approval evidence",
    async () => {
      for (const changed of [
        { ...request, candidateHash: "a".repeat(64) },
        { ...request, evaluationHash: "a".repeat(64) },
        { ...request, evaluationId: randomUUID() },
      ])
        await assert.rejects(app.ontology.publish(null, changed), (e) =>
          ["STALE_BASE", "EVALUATION_INCOMPLETE"].includes(e.code),
        );
      assert.equal((await app.ontology.inspect(null)).id, originalHead.id);
    },
  );
  await t.test(
    "failure after head activation but before replay scheduling rolls back every effect",
    async () => {
      await db.admin.query(
        "CREATE FUNCTION ontave.fail_replay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.state='waiting_ontology' AND NEW.state='queued' THEN RAISE EXCEPTION 'injected replay failure'; END IF; RETURN NEW; END $$",
      );
      await db.admin.query(
        "CREATE TRIGGER fail_replay BEFORE UPDATE ON ontave.jobs FOR EACH ROW EXECUTE FUNCTION ontave.fail_replay()",
      );
      try {
        await assert.rejects(
          app.ontology.publish(null, request),
          (e) => e.code === "STORAGE_UNAVAILABLE",
        );
        assert.equal((await app.ontology.inspect(null)).ordinal, 0);
        assert.equal(
          (await app.ontology.diff(null, candidate.candidateId)).state,
          "proposed",
        );
        assert.equal(
          (await app.jobs.get(null, receipt.job_id)).state,
          "waiting_ontology",
        );
        assert.equal(
          (await db.admin.query("SELECT count(*) FROM ontave.versions")).rows[0]
            .count,
          "1",
        );
      } finally {
        await db.admin.query("DROP TRIGGER fail_replay ON ontave.jobs");
        await db.admin.query("DROP FUNCTION ontave.fail_replay()");
      }
      const child = fork(resolve("tests/helpers/effect-child.mjs"), [], {
        execPath: process.execPath,
        env: {
          ...process.env,
          ONTAVE_TEST_DATABASE: db.connectionString,
          ONTAVE_TEST_WORKSPACE: w,
          ONTAVE_TEST_OPERATION: "publish",
          ONTAVE_TEST_REQUEST: JSON.stringify(request),
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      const [, signal] = await once(child, "exit");
      assert.equal(signal, "SIGKILL");
      assert.equal((await app.jobs.get(null, receipt.job_id)).state, "queued");
      assert.equal((await app.ontology.inspect(null)).ordinal, 1);
      last = await app.ontology.publish(null, request);
      assert.equal(last.reprocessingJobs.length, 1);
      assert.deepEqual(await app.ontology.publish(null, request), last);
      assert.equal((await app.jobs.get(null, receipt.job_id)).state, "queued");
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM ontave.assertions")).rows[0]
          .count,
        "0",
      );
      assert.equal(
        (await db.admin.query("SELECT count(*) FROM ontave.versions")).rows[0]
          .count,
        "2",
      );
      assert.deepEqual(
        (
          await db.storage.transaction(w, (c) =>
            c.query("SELECT * FROM ontave.versions WHERE id=$1", [
              originalHead.id,
            ]),
          )
        ).rows[0],
        originalHead,
      );
      await assert.rejects(
        db.storage.transaction(w, (c) =>
          c.query("UPDATE ontave.versions SET hash='tampered' WHERE id=$1", [
            originalHead.id,
          ]),
        ),
        (e) => e.code === "FORBIDDEN",
      );
    },
  );
  await t.test(
    "an in-flight parent worker stays bound to its original ontology after activation",
    async () => {
      releaseOld();
      const result = await oldWork;
      assert.equal(result.state, "waiting_review");
      oldBundle = await app.reviews.get(null, result.bundleId);
      assert.equal(oldBundle.ontology_id, originalHead.id);
      assert.notEqual(
        oldBundle.ontology_id,
        (await app.ontology.inspect(null)).id,
      );
    },
  );
  await t.test(
    "unchanged parent bundle can be explicitly accepted after compatible additive activation",
    async () => {
      await app.reviews.accept(null, {
        bundleId: oldBundle.id,
        digest: oldBundle.hash,
        requestKey: "old-accept",
        reason:
          "Exact unchanged source and bundle checked against current head",
      });
      assert.equal(
        (await app.reviews.get(null, oldBundle.id)).hash,
        oldBundle.hash,
      );
      const page = await app.entities.find(null, {
        contractId: oldContract.id,
        contractHash: oldContract.hash,
        conceptId: "person",
      });
      assert.equal(page.records[0].fields.name.value, "Rahul");
    },
  );
  await t.test(
    "alias and description reuse hints work without a matching field shape and never activate a proposal",
    async () => {
      const candidate = await app.ontology.propose(null, {
        patch: {
          concepts: [
            {
              id: "client_profile",
              name: "Client profile",
              aliases: ["Person"],
              description: "An individual person",
              fields: [
                {
                  id: "city",
                  name: "City",
                  description: "Reported city",
                  type: "text",
                },
              ],
            },
          ],
          relations: [],
        },
        evidenceIds: [receipt.evidence_id],
        requestKey: "alias-reuse",
        reason: "Inspect potential synonym",
      });
      const diff = await app.ontology.diff(null, candidate.candidateId);
      const hint = diff.reviewHints.reuseWarnings.find(
        (h) => h.existingConceptId === "person",
      );
      assert.equal(hint.reasons.length, 2);
      assert.ok(hint.reasons.some((r) => r.includes("alias")));
      assert.ok(hint.reasons.some((r) => r.includes("Descriptions")));
      assert.equal(diff.state, "proposed");
      assert.equal((await app.ontology.inspect(null)).ordinal, 1);
      assert.equal(
        (await app.ontology.inspect(null)).definition.concepts.some(
          (c) => c.id === "client_profile",
        ),
        false,
      );
    },
  );
  await t.test(
    "shared shapes are flagged for reuse review and an explicit resubmission exposes prior rejection",
    async () => {
      const copy = {
        concepts: [
          {
            id: "customer",
            name: "Customer",
            description: "A proposed business person role",
            fields: [
              {
                id: "name",
                name: "Name",
                description: "Display name",
                type: "text",
              },
            ],
          },
        ],
        relations: [],
      };
      const input = {
        patch: copy,
        evidenceIds: [receipt.evidence_id],
        reason: "Consider whether an existing Person should be reused",
      };
      const c = await app.ontology.propose(null, {
        ...input,
        requestKey: "copy",
      });
      const diff = await app.ontology.diff(null, c.candidateId);
      assert.ok(
        diff.reviewHints.reuseWarnings.some(
          (h) => h.existingConceptId === "person",
        ),
      );
      await app.ontology.reject(null, {
        candidateId: c.candidateId,
        candidateHash: c.hash,
        requestKey: "reject-copy",
        reason: "Reuse existing Person in this domain",
      });
      const again = await app.ontology.propose(null, {
        ...input,
        requestKey: "explicit-reconsider",
      });
      const next = await app.ontology.diff(null, again.candidateId);
      assert.equal(next.reviewHints.previousRejections[0].id, c.candidateId);
      assert.equal((await app.ontology.inspect(null)).ordinal, 1);
    },
  );
});
