import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("concurrency, stale workers, source verification, corrections and typed uncertainty", async (t) => {
  const db = await disposablePostgres();
  const w = randomUUID();
  let fencedBundle, originalEvidence;
  let handler = () => personFixture("Rahul");
  const app = createOntave({
    storage: db.storage,
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "read", "ingest", "review", "worker"],
    }),
    model: fixtureAdapter((task) => handler(task)),
    limits: { leaseMs: 1000 },
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Concurrency",
    requestKey: "provision",
    seed: "people",
  });
  const contract = await app.contracts.register(null, starter);
  const q = {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  };
  await t.test(
    "concurrent same-key deliveries return one receipt and one job",
    async () => {
      const input = {
        source: "same",
        idempotencyKey: "1",
        payload: { kind: "text", text: "Rahul" },
      };
      const receipts = await Promise.all(
        Array.from({ length: 3 }, () => app.ingest(null, input)),
      );
      assert.equal(new Set(receipts.map((x) => x.evidence_id)).size, 1);
      assert.equal((await app.jobs.list(null)).length, 1);
      originalEvidence = receipts[0].evidence_id;
    },
  );
  await t.test(
    "expired worker cannot replace a newer fenced result",
    async () => {
      let release, started;
      const began = new Promise((r) => (started = r));
      const gate = new Promise((r) => (release = r));
      let calls = 0;
      handler = async () => {
        if (++calls === 1) {
          started();
          await gate;
        }
        return personFixture("Rahul");
      };
      const old = app.worker.runOnce(null);
      await began;
      await db.admin.query(
        "UPDATE ontave.jobs SET lease_until=now()-interval '1 second' WHERE workspace_id=$1 AND state='processing'",
        [w],
      );
      const newer = await app.worker.runOnce(null);
      assert.equal(newer.state, "waiting_review");
      release();
      const stale = await old;
      assert.equal(stale.error.code, "LEASE_LOST");
      assert.equal(
        (await app.jobs.get(null, newer.jobId)).bundle_id,
        newer.bundleId,
      );
      fencedBundle = await app.reviews.get(null, newer.bundleId);
    },
  );
  let entityId;
  await t.test(
    "two retries of the same approval create one set of assertions",
    async () => {
      const request = {
        bundleId: fencedBundle.id,
        digest: fencedBundle.hash,
        requestKey: "fenced-accept",
        reason: "Checked current result",
      };
      const decisions = await Promise.all([
        app.reviews.accept(null, request),
        app.reviews.accept(null, request),
      ]);
      assert.deepEqual(decisions[0], decisions[1]);
      const records = (await app.entities.find(null, q)).records;
      entityId = records[0].id;
      assert.equal((await app.assertions.explain(null, entityId)).length, 1);
      const count = await db.admin.query(
        "SELECT count(*) FROM ontave.decisions WHERE workspace_id=$1 AND operation=$2",
        [w, "accept"],
      );
      assert.equal(count.rows[0].count, "1");
    },
  );
  await t.test(
    "a model cannot mark untrusted source content verified",
    async () => {
      handler = () => {
        const e = personFixture("Verified");
        e.entities[0].fields.name.verification = "verified";
        return e;
      };
      const r = await app.ingest(null, {
        source: "test",
        idempotencyKey: "verified",
        payload: { kind: "text", text: "Verified" },
      });
      const result = await app.worker.runOnce(null);
      assert.equal(result.error.code, "VALIDATION_FAILED");
      assert.equal((await app.jobs.get(null, r.job_id)).state, "failed");
    },
  );
  await t.test(
    "reviewer attestation is staged and requires exact renewed acceptance",
    async () => {
      const before = (await app.entities.find(null, q)).records[0];
      const staged = await app.assertions.attest(null, {
        entityId,
        fieldId: "email",
        expectedRevision: before.revision,
        value: "a@example.test",
        statement: "Owner states the email is a@example.test",
        requestKey: "attest1",
        reason: "Owner correction",
      });
      assert.equal(
        (await app.entities.find(null, q)).records[0].fields.email.state,
        "missing",
      );
      await app.reviews.accept(null, {
        bundleId: staged.bundleId,
        digest: staged.digest,
        requestKey: "accept-attest",
        reason: "Confirmed interpretation of owner statement",
      });
      const after = (await app.entities.find(null, q)).records[0];
      assert.equal(after.fields.email.value, "a@example.test");
      assert.equal(after.fields.email.verification, "reported");
    },
  );
  await t.test(
    "competing accepted claims become conflict, not last-write-wins",
    async () => {
      const row = (await app.entities.find(null, q)).records[0];
      const second = await app.assertions.attest(null, {
        entityId,
        fieldId: "email",
        expectedRevision: row.revision,
        value: "b@example.test",
        statement: "Another source states b@example.test",
        requestKey: "attest2",
        reason: "Record conflicting source",
      });
      await app.reviews.accept(null, {
        bundleId: second.bundleId,
        digest: second.digest,
        requestKey: "accept-attest2",
        reason: "Retain both claims",
      });
      assert.equal(
        (await app.entities.find(null, q)).records[0].fields.email.state,
        "conflict",
      );
      assert.equal(
        (
          await app.entities.find(null, {
            ...q,
            where: [{ field: "email", op: "eq", value: "a@example.test" }],
          })
        ).records.length,
        0,
      );
      assert.equal(
        (
          await app.entities.find(null, {
            ...q,
            where: [{ field: "email", op: "stateIs", value: "conflict" }],
          })
        ).records.length,
        1,
      );
    },
  );
  await t.test(
    "explicit unresolved conflict decision is audited and changes no competing source",
    async () => {
      const row = (await app.entities.find(null, q)).records[0];
      const staged = await app.reviews.resolveConflict(null, {
        entityId,
        fieldId: "email",
        expectedRevision: row.revision,
        selectedAssertionId: null,
        statement: "Owner cannot yet resolve the email conflict",
        requestKey: "unresolved-email",
        reason: "More evidence is needed",
      });
      await app.reviews.accept(null, {
        bundleId: staged.bundleId,
        digest: staged.digest,
        requestKey: "accept-unresolved",
        reason: "Retain competing sources",
      });
      assert.equal(
        (await app.entities.find(null, q)).records[0].fields.email.state,
        "conflict",
      );
    },
  );
  await t.test(
    "reviewed retraction restores the surviving claim and preserves original evidence",
    async () => {
      const row = (await app.entities.find(null, q)).records[0],
        history = await app.assertions.explain(null, entityId),
        target = history.find(
          (x) => x.field_id === "email" && x.value === "b@example.test",
        );
      const correction = await app.reviews.resolveConflict(null, {
        entityId,
        fieldId: "email",
        selectedAssertionId: history.find(
          (x) => x.field_id === "email" && x.value === "a@example.test",
        ).id,
        expectedRevision: row.revision,
        statement: "The second email was wrong",
        requestKey: "retract",
        reason: "Owner withdrew the second claim",
      });
      assert.equal(
        (await app.entities.find(null, q)).records[0].fields.email.state,
        "conflict",
      );
      await app.reviews.accept(null, {
        bundleId: correction.bundleId,
        digest: correction.digest,
        requestKey: "accept-retract",
        reason: "Apply withdrawal",
      });
      assert.equal(
        (await app.entities.find(null, q)).records[0].fields.email.value,
        "a@example.test",
      );
      assert.equal(
        (await app.evidence.get(null, target.evidence_id)).payload,
        "Another source states b@example.test",
      );
    },
  );
  await t.test(
    "required value retraction produces explicit unknown, never fabricated null",
    async () => {
      const row = (await app.entities.find(null, q)).records[0],
        history = await app.assertions.explain(null, entityId),
        target = history.find((x) => x.field_id === "name" && x.kind === "set");
      const r = await app.assertions.retract(null, {
        targetAssertionId: target.id,
        expectedRevision: row.revision,
        statement: "Name identification is withdrawn",
        requestKey: "withdraw-name",
        reason: "Identity uncertainty",
      });
      await app.reviews.accept(null, {
        bundleId: r.bundleId,
        digest: r.digest,
        requestKey: "accept-withdraw-name",
        reason: "Retain explicit uncertainty",
      });
      assert.equal(
        (await app.entities.find(null, q)).records[0].fields.name.state,
        "unknown",
      );
    },
  );
  await t.test(
    "reprocessing reuses the accepted identity and cannot reactivate a withdrawn source assertion",
    async () => {
      handler = () => personFixture("Rahul");
      await app.jobs.reprocess(null, {
        evidenceId: originalEvidence,
        requestKey: "replay-corrected",
        reason: "Check source history survives",
      });
      const staged = await app.worker.runOnce(null);
      assert.equal(staged.state, "waiting_review");
      const bundle = await app.reviews.get(null, staged.bundleId);
      assert.equal(
        Object.values(bundle.body.resolutions)[0].entityId,
        entityId,
      );
      await app.reviews.accept(null, {
        bundleId: bundle.id,
        digest: bundle.hash,
        requestKey: "accept-replay-corrected",
        reason: "Replayed source does not undo withdrawal",
      });
      const rows = (await app.entities.find(null, q)).records;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].fields.name.state, "unknown");
      assert.equal(rows[0].fields.email.value, "a@example.test");
    },
  );
  await t.test(
    "scalar state sorting and cursors bind the exact query",
    async () => {
      handler = (task) => personFixture(task.text);
      for (const name of ["Zoe", "Asha"]) {
        await app.ingest(null, {
          source: "page",
          idempotencyKey: name,
          payload: { kind: "text", text: name },
        });
        const r = await app.worker.runOnce(null),
          b = await app.reviews.get(null, r.bundleId);
        await app.reviews.accept(null, {
          bundleId: b.id,
          digest: b.hash,
          requestKey: "accept-" + name,
          reason: "Paging fixture",
        });
      }
      const query = {
        ...q,
        order: { field: "name", direction: "asc" },
        limit: 1,
      };
      const first = await app.entities.find(null, query);
      assert.equal(first.records[0].fields.name.value, "Asha");
      const second = await app.entities.find(null, {
        ...query,
        cursor: first.nextCursor,
      });
      assert.equal(second.records[0].fields.name.value, "Zoe");
      const third = await app.entities.find(null, {
        ...query,
        cursor: second.nextCursor,
      });
      assert.equal(third.records[0].fields.name.state, "unknown");
      assert.equal(third.nextCursor, null);
      await assert.rejects(
        app.entities.find(null, {
          ...query,
          order: { field: "name", direction: "desc" },
          cursor: first.nextCursor,
        }),
        (e) => e.code === "INVALID_INPUT",
      );
    },
  );
  await t.test(
    "two workers racing for one queued job reserve one call",
    async () => {
      let calls = 0;
      handler = (task) => {
        calls++;
        return personFixture(task.text);
      };
      await app.ingest(null, {
        source: "one-claim",
        idempotencyKey: "1",
        payload: { kind: "text", text: "Solo" },
      });
      const results = await Promise.all([
        app.worker.runOnce(null),
        app.worker.runOnce(null),
      ]);
      assert.equal(
        results.filter((x) => x?.state === "waiting_review").length,
        1,
      );
      assert.equal(results.filter((x) => x === null).length, 1);
      assert.equal(calls, 1);
    },
  );
  await t.test(
    "correction and retraction staging retries retain exact prior effects",
    async () => {
      const row = (await app.entities.find(null, q)).records.find(
          (r) => r.id === entityId,
        ),
        history = await app.assertions.explain(null, entityId),
        target = history.find(
          (a) =>
            a.field_id === "email" &&
            a.kind === "set" &&
            a.value === "a@example.test",
        );
      const input = {
        targetAssertionId: target.id,
        expectedRevision: row.revision,
        value: "c@example.test",
        statement: "The corrected address is c@example.test",
        requestKey: "direct-correction",
        reason: "Explicit correction source",
      };
      const staged = await app.assertions.correct(null, input);
      assert.deepEqual(await app.assertions.correct(null, input), staged);
      assert.equal(
        (await app.entities.find(null, q)).records.find(
          (r) => r.id === entityId,
        ).fields.email.value,
        "a@example.test",
      );
      await app.reviews.accept(null, {
        bundleId: staged.bundleId,
        digest: staged.digest,
        requestKey: "accept-direct-correction",
        reason: "Checked exact correction",
      });
      const after = (await app.entities.find(null, q)).records.find(
          (r) => r.id === entityId,
        ),
        corrected = (await app.assertions.explain(null, entityId)).find(
          (a) => a.value === "c@example.test",
        );
      assert.equal(after.fields.email.value, "c@example.test");
      const retract = {
          targetAssertionId: corrected.id,
          expectedRevision: after.revision,
          statement: "Withdraw c@example.test",
          requestKey: "direct-retraction",
          reason: "Explicit withdrawal source",
        },
        withdrawn = await app.assertions.retract(null, retract);
      assert.deepEqual(await app.assertions.retract(null, retract), withdrawn);
      await app.reviews.accept(null, {
        bundleId: withdrawn.bundleId,
        digest: withdrawn.digest,
        requestKey: "accept-direct-retraction",
        reason: "Exact withdrawal reviewed",
      });
      assert.equal(
        (await app.entities.find(null, q)).records.find(
          (r) => r.id === entityId,
        ).fields.email.state,
        "missing",
      );
    },
  );
});
