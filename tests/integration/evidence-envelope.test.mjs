import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
test("request identity, event provenance, invalid envelopes and oversized processing preserve atomic evidence", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let calls = 0;
  const app = createOntave({
    storage: db.storage,
    authorize: (ctx) => {
      if (ctx === "forged") throw Error("Private credential failure");
      return {
        actorId: "owner",
        workspaceId: w,
        capabilities: ["provision", "read", "ingest", "worker", "review"],
      };
    },
    model: fixtureAdapter((task) => {
      calls++;
      return personFixture(task.text);
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Envelopes",
    seed: "people",
    requestKey: "create",
  });
  const original = {
    source: "source-a",
    idempotencyKey: "1",
    payload: { kind: "text", text: "Asha" },
  };
  await t.test(
    "same receipt identity conflicts on changed payload; distinct sources and keys stay distinct",
    async () => {
      const a = await app.ingest(null, original);
      assert.equal(
        (await app.ingest(null, original)).evidence_id,
        a.evidence_id,
      );
      await assert.rejects(
        app.ingest(null, {
          ...original,
          payload: { kind: "text", text: "Other" },
        }),
        (e) => e.code === "IDEMPOTENCY_CONFLICT",
      );
      const b = await app.ingest(null, { ...original, source: "source-b" }),
        c = await app.ingest(null, { ...original, idempotencyKey: "2" });
      assert.equal(
        new Set([a.evidence_id, b.evidence_id, c.evidence_id]).size,
        3,
      );
      assert.equal((await app.jobs.list(null)).length, 3);
      assert.equal(calls, 0);
    },
  );
  await t.test(
    "malformed untyped input fails before inference without a partial receipt",
    async () => {
      const before = (await app.jobs.list(null)).length;
      for (const input of [
        null,
        {},
        [],
        { ...original, source: ["forged"] },
        { ...original, idempotencyKey: 1 },
        { ...original, payload: { kind: "pdf", text: "Asha" } },
        { ...original, payload: { kind: "text", text: 123 } },
        { ...original, payload: { kind: "text", text: "x".repeat(262145) } },
      ])
        await assert.rejects(app.ingest(null, input), (e) =>
          ["INVALID_INPUT", "PAYLOAD_TOO_LARGE"].includes(e.code),
        );
      await assert.rejects(
        app.ingest("forged", original),
        (e) => e.code === "UNAUTHORIZED" && !e.message.includes("Private"),
      );
      assert.equal((await app.jobs.list(null)).length, before);
      assert.equal(calls, 0);
    },
  );
  await t.test(
    "source-event chronology and correction references cannot rewrite the earlier receipt",
    async () => {
      const first = await app.ingest(null, {
        ...original,
        idempotencyKey: "event-first",
        metadata: {
          sourceEventTime: "2026-10-10T10:00:00Z",
          sourceTimezone: "Asia/Kolkata",
        },
      });
      const correction = await app.ingest(null, {
        ...original,
        idempotencyKey: "event-correction",
        metadata: {
          sourceEventTime: "2026-10-09T10:00:00Z",
          correctionOf: first.evidence_id,
        },
      });
      assert.equal(
        (await app.evidence.get(null, correction.evidence_id)).metadata
          .correctionOf,
        first.evidence_id,
      );
      assert.equal(
        (await app.evidence.get(null, first.evidence_id)).metadata
          .sourceEventTime,
        "2026-10-10T10:00:00Z",
      );
      assert.equal(
        (await app.evidence.get(null, first.evidence_id)).payload,
        "Asha",
      );
    },
  );
  // Drain earlier queued records without accepting them, then inspect an oversized processing context.
  for (let i = 0; i < 5; i++) await app.worker.runOnce(null);
  await t.test(
    "preserved payload exceeding inference context fails explicitly without a model call",
    async () => {
      const text = "x".repeat(60001),
        before = calls,
        r = await app.ingest(null, {
          source: "oversize-context",
          idempotencyKey: "1",
          payload: { kind: "text", text },
        }),
        result = await app.worker.runOnce(null);
      assert.equal(result.error.code, "BUDGET_EXHAUSTED");
      assert.equal(calls, before);
      assert.equal((await app.jobs.get(null, r.job_id)).state, "failed");
      assert.equal(
        (await app.evidence.get(null, r.evidence_id)).range.totalBytes,
        text.length,
      );
    },
  );
});
