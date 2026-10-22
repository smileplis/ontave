import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../../dist/index.js";
import { mistral } from "../../dist/models/mistral.js";
import { disposablePostgres } from "../helpers/postgres.mjs";

test("provider interruption, rate limits, transient errors and truncation retain evidence and bounded attempts without partial facts", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID();
  let mode,
    calls = 0;
  const app = createOntave({
    storage: db.storage,
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "ingest", "read", "review", "worker"],
    }),
    model: mistral({
      apiKey: "fictional-secret-canary",
      model: "test",
      fetch: async () => {
        calls++;
        if (mode === "interrupt")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(
                  Error("fictional-secret-canary private evidence"),
                );
              },
            }),
          );
        if (mode === "truncated")
          return Response.json({
            choices: [
              {
                finish_reason: "length",
                message: { content: '{"entities":[]' },
              },
            ],
            usage: { total_tokens: 77 },
          });
        return new Response("fictional-secret-canary private evidence", {
          status: mode,
        });
      },
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Provider failure",
    seed: "people",
    requestKey: "create",
  });
  const contract = await app.contracts.register(null, starter);
  for (mode of [429, 503, "interrupt", "truncated"])
    await t.test(
      `failure ${mode} is durable and cannot produce a partial review bundle`,
      async () => {
        const before = calls,
          text = `Retain original source for ${mode}`;
        const receipt = await app.ingest(null, {
          source: "provider",
          idempotencyKey: String(mode),
          payload: { kind: "text", text },
        });
        await app.worker.runOnce(null);
        if (mode !== "truncated") {
          assert.equal(
            (await app.jobs.get(null, receipt.job_id)).state,
            "retry_scheduled",
          );
          await db.admin.query(
            "UPDATE ontave.jobs SET next_at=now()-interval '1 second' WHERE id=$1",
            [receipt.job_id],
          );
          await app.worker.runOnce(null);
        }
        const job = await app.jobs.get(null, receipt.job_id),
          attempts = mode === "truncated" ? 1 : 2;
        assert.equal(job.state, "failed");
        assert.equal(job.calls, attempts);
        assert.equal(calls - before, attempts);
        assert.equal(job.bundle_id, null);
        assert.equal(
          (await app.evidence.get(null, receipt.evidence_id)).payload,
          text,
        );
        const history = await app.jobs.attempts(null, receipt.job_id);
        assert.equal(
          history.filter((x) => x.event === "failed").length,
          attempts,
        );
        const runs = (
          await db.admin.query(
            "SELECT error,usage FROM ontave.runs WHERE job_id=$1",
            [receipt.job_id],
          )
        ).rows;
        assert.equal(runs.length, attempts);
        assert.ok(
          runs.every((r) =>
            mode === "truncated"
              ? r.usage.total_tokens === 77 && r.error.usage === "recorded"
              : r.usage === null && r.error.usage === "unknown",
          ),
        );
        assert.equal(
          JSON.stringify({ job, runs, history }).includes(
            "fictional-secret-canary",
          ),
          false,
        );
        assert.equal(
          (
            await app.entities.find(null, {
              contractId: contract.id,
              contractHash: contract.hash,
              conceptId: "person",
            })
          ).records.length,
          0,
        );
        assert.equal(
          (
            await db.admin.query(
              "SELECT count(*) FROM ontave.bundles WHERE job_id=$1",
              [receipt.job_id],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(await app.worker.runOnce(null), null);
      },
    );
});
