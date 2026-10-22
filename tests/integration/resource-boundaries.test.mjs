import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter, json } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
test("payload, metadata, operation, query, suite and configured resource boundaries fail atomically", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let handler = () => personFixture("Solo"),
    calls = 0;
  const config = {
    storage: db.storage,
    model: fixtureAdapter((task) => {
      calls++;
      return handler(task);
    }),
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "ingest", "worker", "read", "review"],
    }),
  };
  const app = createOntave(config);
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Bounds",
    seed: "people",
    requestKey: "create",
  });
  const contract = await app.contracts.register(null, starter);
  await t.test(
    "only bounded positive integer overrides at or below the profile are accepted",
    async () => {
      for (const [key, value] of Object.entries(app.limits)) {
        for (const bad of [0, -1, 1.5, value + 1, Number.MAX_SAFE_INTEGER])
          assert.throws(
            () => createOntave({ ...config, limits: { [key]: bad } }),
            (e) => e.code === "INVALID_INPUT",
          );
        assert.equal(
          createOntave({ ...config, limits: { [key]: 1 } }).limits[key],
          1,
        );
      }
      assert.throws(
        () => createOntave({ ...config, limits: { unknown: 1 } }),
        (e) => e.code === "INVALID_INPUT",
      );
    },
  );
  await t.test(
    "payload and metadata accept the exact ceiling and reject the next byte",
    async () => {
      const payload = "x".repeat(262144),
        r = await app.ingest(null, {
          source: "bounds",
          idempotencyKey: "payload",
          payload: { kind: "text", text: payload },
        });
      assert.equal(
        (await app.evidence.get(null, r.evidence_id)).range.totalBytes,
        262144,
      );
      const n = 16384 - Buffer.byteLength(json({ sourceReference: "" }));
      const accepted = await app.ingest(null, {
        source: "bounds",
        idempotencyKey: "metadata",
        payload: { kind: "text", text: "Solo" },
        metadata: { sourceReference: "x".repeat(n) },
      });
      assert.equal(
        Buffer.byteLength(
          json((await app.evidence.get(null, accepted.evidence_id)).metadata),
        ),
        16384,
      );
      const before = (await app.jobs.list(null)).length;
      await assert.rejects(
        app.ingest(null, {
          source: "bounds",
          idempotencyKey: "too-large",
          payload: { kind: "text", text: payload + "x" },
        }),
        (e) => e.code === "PAYLOAD_TOO_LARGE",
      );
      await assert.rejects(
        app.ingest(null, {
          source: "bounds",
          idempotencyKey: "metadata-plus",
          payload: { kind: "text", text: "Solo" },
          metadata: { sourceReference: "x".repeat(n + 1) },
        }),
        (e) => e.code === "PAYLOAD_TOO_LARGE",
      );
      assert.equal((await app.jobs.list(null)).length, before);
      assert.equal(calls, 0);
      assert.equal(
        (await app.worker.runOnce(null)).error.code,
        "BUDGET_EXHAUSTED",
      );
      assert.equal(calls, 0);
      await app.worker.runOnce(null);
    },
  );
  const bundleOutput = (extra) => ({
    entities: [
      ...Array.from({ length: 83 }, (_, i) => ({
        mentionId: "p_" + i,
        conceptId: "person",
        name: "Solo",
        fields: {
          name: { value: "Solo", quote: "Solo" },
          email: { value: "s@example.test", quote: "s@example.test" },
        },
      })),
      { mentionId: "last", conceptId: "person", name: "Unbound", fields: {} },
      ...(extra
        ? [
            {
              mentionId: "extra",
              conceptId: "person",
              name: "Unbound",
              fields: {},
            },
          ]
        : []),
    ],
    relationships: [],
    observations: [],
  });
  await t.test(
    "250 operations stage; a late required-field failure rolls back all prior inserts",
    async () => {
      handler = () => bundleOutput(false);
      await app.ingest(null, {
        source: "bounds",
        idempotencyKey: "250",
        payload: { kind: "text", text: "Solo s@example.test" },
      });
      const work = await app.worker.runOnce(null);
      assert.equal(work.state, "waiting_review");
      const b = await app.reviews.get(null, work.bundleId);
      await assert.rejects(
        app.reviews.accept(null, {
          bundleId: b.id,
          digest: b.hash,
          requestKey: "missing-required",
          reason: "No partial publication allowed",
        }),
        (e) => e.code === "VALIDATION_FAILED",
      );
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.entities WHERE workspace_id=$1",
            [w],
          )
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.assertions WHERE workspace_id=$1",
            [w],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "251 operations fail before any bundle or canonical write",
    async () => {
      handler = () => bundleOutput(true);
      const receipt = await app.ingest(null, {
          source: "bounds",
          idempotencyKey: "251",
          payload: { kind: "text", text: "Solo s@example.test" },
        }),
        work = await app.worker.runOnce(null);
      assert.equal(work.error.code, "BUDGET_EXHAUSTED");
      assert.equal((await app.jobs.get(null, receipt.job_id)).bundle_id, null);
      assert.equal((await app.jobs.get(null, receipt.job_id)).state, "failed");
    },
  );
  await t.test(
    "closed read and independent suite boundaries reject excess work",
    async () => {
      const q = {
        contractId: contract.id,
        contractHash: contract.hash,
        conceptId: "person",
      };
      assert.equal(
        (await app.entities.find(null, { ...q, limit: 100 })).records.length,
        0,
      );
      for (const input of [
        { ...q, limit: 101 },
        { ...q, include: Array(11).fill("x") },
        {
          ...q,
          where: Array.from({ length: 21 }, () => ({
            field: "name",
            op: "eq",
            value: "Solo",
          })),
        },
        { ...q, cursor: "x".repeat(8193) },
      ])
        await assert.rejects(
          app.entities.find(null, input),
          (e) => e.code === "INVALID_INPUT",
        );
      const suite = {
        name: "at-limit",
        maxCalls: 80,
        timeoutMs: 600000,
        tasks: Array.from({ length: 40 }, (_, i) => ({
          kind: "contract",
          id: "c" + i,
          contractId: contract.id,
        })),
      };
      await app.evaluations.registerSuite(null, suite);
      for (const input of [
        { ...suite, maxCalls: 81 },
        { ...suite, timeoutMs: 600001 },
        {
          ...suite,
          tasks: [
            ...suite.tasks,
            { kind: "contract", id: "extra", contractId: contract.id },
          ],
        },
      ])
        await assert.rejects(
          app.evaluations.registerSuite(null, input),
          (e) => e.code === "INVALID_INPUT",
        );
    },
  );
});
