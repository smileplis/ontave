// Explicit deterministic local measurement; no inference calls or old application resources.
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { createOntave, starter } from "../dist/index.js";
import { fixtureAdapter, personFixture } from "../dist/testing.js";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
const concurrency = 4;
const summarize = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return {
    samples: v.length,
    p50Ms: v[Math.floor(v.length * 0.5)],
    p95Ms: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))],
  };
};
async function parallel(count, fn) {
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const n = index++;
        if (n >= count) return;
        await fn(n);
      }
    }),
  );
}
const db = await disposablePostgres(),
  reports = [];
async function save() {
  await writeFile(
    "artifacts/load-measurements.json",
    JSON.stringify(
      {
        mode: "local deterministic fictional bulk ingest then drain; automated approvals; zero provider calls",
        node: process.version,
        postgres: (await db.admin.query("SHOW server_version")).rows[0]
          .server_version,
        platform: os.platform(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        logicalCPUs: os.cpus().length,
        memoryBytes: os.totalmem(),
        poolMax: 8,
        database:
          "disposable localhost PostgreSQL; shared warmed instance, separate workspaces",
        reports,
      },
      null,
      2,
    ) + "\n",
  );
}
try {
  for (const size of [100, 1000, 10000]) {
    let profiling = false;
    const queryProfile = [],
      compiledPlans = [];
    const w = randomUUID(),
      storage = {
        transaction: (workspace, fn, options) =>
          db.storage.transaction(
            workspace,
            (c) =>
              fn(
                new Proxy(c, {
                  get(target, key) {
                    if (key !== "query") return Reflect.get(target, key);
                    return async (...args) => {
                      const at = performance.now();
                      const result = await target.query(...args);
                      if (profiling) {
                        const sql = String(args[0]);
                        queryProfile.push({ sql, ms: performance.now() - at });
                        if (sql.startsWith("SELECT e.*")) {
                          const plan = await target.query(
                            "EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) " + sql,
                            args[1],
                          );
                          compiledPlans.push(plan.rows);
                        }
                      }
                      return result;
                    };
                  },
                }),
              ),
            options,
          ),
        close: async () => {},
      };
    const app = createOntave({
      storage,
      model: fixtureAdapter((task) => personFixture(task.text)),
      authorize: () => ({
        actorId: "load-harness",
        workspaceId: w,
        capabilities: ["provision", "read", "ingest", "review", "worker"],
      }),
    });
    await app.workspaces.create(null, {
      workspaceId: w,
      name: "LOAD-" + size,
      seed: "people",
      requestKey: "create",
    });
    const contract = await app.contracts.register(null, starter),
      receiptMs = [],
      stageMs = [],
      reviewMs = [],
      readMs = [],
      failures = [];
    const start = performance.now();
    await parallel(size, async (n) => {
      const at = performance.now();
      await app.ingest(null, {
        source: "load",
        idempotencyKey: String(n),
        payload: { kind: "text", text: "Load" + String(n).padStart(5, "0") },
      });
      receiptMs.push(performance.now() - at);
    });
    const ingested = performance.now();
    let processed = 0;
    await parallel(size, async (n) => {
      const at = performance.now(),
        work = await app.worker.runOnce(null);
      stageMs.push(performance.now() - at);
      if (work?.state !== "waiting_review") {
        failures.push(work ?? { state: "no-claim" });
        return;
      }
      const b = await app.reviews.get(null, work.bundleId),
        reviewAt = performance.now();
      await app.reviews.accept(null, {
        bundleId: b.id,
        digest: b.hash,
        requestKey: "accept-" + n,
        reason: "Automated fictional deterministic load fixture",
      });
      reviewMs.push(performance.now() - reviewAt);
      processed++;
    });
    const finished = performance.now();
    for (let n = 0; n < 40; n++) {
      profiling = n >= 38;
      const at = performance.now();
      await app.entities.find(null, {
        contractId: contract.id,
        contractHash: contract.hash,
        conceptId: "person",
        order: { field: "name", direction: n % 2 ? "asc" : "desc" },
        limit: 25,
      });
      readMs.push(performance.now() - at);
      profiling = false;
    }
    const counts = (
      await db.admin.query(
        "SELECT state,count(*)::int AS count FROM ontave.jobs WHERE workspace_id=$1 GROUP BY state",
        [w],
      )
    ).rows;
    const queue = (
      await db.admin.query(
        "SELECT extract(epoch from (min(r.created_at)-j.created_at))*1000 AS ms FROM ontave.jobs j JOIN ontave.runs r ON r.workspace_id=j.workspace_id AND r.job_id=j.id WHERE j.workspace_id=$1 GROUP BY j.id,j.created_at",
        [w],
      )
    ).rows.map((x) => Number(x.ms));
    const attempts = (
      await db.admin.query(
        "SELECT sum(greatest(0,attempts-1))::int AS retries FROM ontave.jobs WHERE workspace_id=$1",
        [w],
      )
    ).rows[0].retries;
    const plan = await db.storage.transaction(
      w,
      async (c) =>
        (
          await c.query(
            "EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT e.*,coalesce(p.state_rank,3) AS sort_rank,p.val_text::text AS sort_value FROM ontave.entities e LEFT JOIN LATERAL (SELECT * FROM ontave.projections sp WHERE sp.workspace_id=e.workspace_id AND sp.entity_id=e.id AND sp.field_id='name' LIMIT 1) p ON true WHERE e.concept_id='person' AND e.workspace_id=current_setting('ontave.workspace_id')::uuid ORDER BY coalesce(p.state_rank,3),p.val_text NULLS LAST,e.id LIMIT 26",
          )
        ).rows,
    );
    reports.push({
      size,
      concurrency,
      processed,
      failures,
      counts,
      retries: attempts,
      maxQueueDepth: size,
      bulkReceiptMs: ingested - start,
      stageAndAutomatedReviewMs: finished - ingested,
      receiptsPerSecond: size / ((ingested - start) / 1000),
      processedPerSecond: processed / ((finished - ingested) / 1000),
      receipt: summarize(receiptMs),
      stage: summarize(stageMs),
      automatedReview: summarize(reviewMs),
      read: summarize(readMs),
      receiptToStaging: summarize(queue),
      plan,
      queryProfile,
      compiledPlans,
    });
    await save();
    console.log(
      JSON.stringify({
        size,
        processed,
        failures: failures.length,
        receiptP95: reports.at(-1).receipt.p95Ms,
        readP95: reports.at(-1).read.p95Ms,
      }),
    );
    if (failures.length)
      throw Error("Load failures recorded; do not mark benchmark passed");
  }
  const report = {
    mode: "local deterministic fictional bulk ingest then drain; automated test approvals; zero provider calls; not production SLOs",
    node: process.version,
    postgres: (await db.admin.query("SHOW server_version")).rows[0]
      .server_version,
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCPUs: os.cpus().length,
    memoryBytes: os.totalmem(),
    poolMax: 8,
    database:
      "disposable localhost PostgreSQL; one shared warmed instance across three separate workspaces",
    reports,
  };
  await writeFile(
    "artifacts/load-measurements.json",
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await db.storage.close();
  await db.stop();
}
