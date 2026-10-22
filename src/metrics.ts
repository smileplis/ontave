import type { PoolClient } from "pg";
/** Aggregate, workspace-scoped operational counts. These are not semantic accuracy estimates. */
export async function operationalMetrics(c: Pick<PoolClient, "query">) {
  const grouped = async (table: string, column: string) =>
    Object.fromEntries(
      (
        await c.query(
          `SELECT ${column} AS key,count(*)::int AS count FROM ontave.${table} GROUP BY ${column}`,
        )
      ).rows.map((r) => [r.key, r.count]),
    );
  const count = async (sql: string) => (await c.query(sql)).rows[0];
  const jobs = await grouped("jobs", "state"),
    reviews = await grouped("decisions", "operation"),
    events = await grouped("worker_events", "event");
  const totals = await count(
    `SELECT (SELECT count(*)::int FROM ontave.evidence) AS evidence,(SELECT count(*)::int FROM ontave.entities) AS entities,(SELECT count(*)::int FROM ontave.versions) AS ontology_versions,(SELECT count(*)::int FROM ontave.assertions WHERE kind='set' AND field_id IS NOT NULL) AS field_assertions,(SELECT count(*)::int FROM ontave.assertions WHERE kind='set' AND relation_id IS NOT NULL) AS relationship_assertions,(SELECT count(*)::int FROM ontave.assertions WHERE kind='retract') AS retractions,(SELECT count(*)::int FROM ontave.assertions WHERE kind='set' AND span ? 'startByte' AND span ? 'endByte') AS source_referenced_assertions`,
  );
  const usage = await count(
    `SELECT count(*)::int AS finalized_runs,count(usage)::int AS runs_with_reported_usage,coalesce(sum(CASE WHEN coalesce(usage->>'totalTokenCount',usage->>'total_tokens',usage->>'totalTokens','') ~ '^[0-9]{1,16}$' THEN coalesce(usage->>'totalTokenCount',usage->>'total_tokens',usage->>'totalTokens')::numeric ELSE NULL END),0)::text AS reported_total_tokens FROM ontave.runs`,
  );
  const unfinalized = await count(
    `SELECT count(*)::int AS count FROM ontave.worker_events s WHERE s.event='started' AND NOT EXISTS(SELECT 1 FROM ontave.worker_events f WHERE f.job_id=s.job_id AND f.fence=s.fence AND f.event IN ('completed','failed'))`,
  );
  const latency = await count(
    `SELECT count(*)::int AS samples,percentile_cont(0.5) WITHIN GROUP(ORDER BY ms) AS p50_ms,percentile_cont(0.95) WITHIN GROUP(ORDER BY ms) AS p95_ms FROM (SELECT extract(epoch FROM (min(b.created_at)-j.created_at))*1000 AS ms FROM ontave.jobs j JOIN ontave.bundles b ON b.workspace_id=j.workspace_id AND b.job_id=j.id GROUP BY j.id,j.created_at) x`,
  );
  return {
    version: "ontave-operational-metrics-v1",
    totals,
    jobs,
    reviews,
    worker: {
      events,
      ...usage,
      unfinalizedAttempts: unfinalized.count,
      usageUnknownRuns: usage.finalized_runs - usage.runs_with_reported_usage,
    },
    verification: await grouped("assertions", "verification"),
    currentFields: (
      await c.query(
        "SELECT result->>'state' AS state,count(*)::int AS count FROM ontave.projections GROUP BY result->>'state'",
      )
    ).rows,
    receiptToFirstStaging: latency,
    limitations: [
      "Counts reflect this transaction's authorized workspace, including retained history.",
      "Reported tokens exclude unknown or interrupted provider usage and are not a bill.",
      "Review decisions are action counts; human review time and accuracy require separately labeled measurements.",
    ],
  };
}
