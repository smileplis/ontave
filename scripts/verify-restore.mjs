// Operator recovery exercise using only disposable databases and fictional data.
import { spawnSync } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createOntave, starter } from "../dist/index.js";
import { migrate, migrationPlan } from "../dist/postgres.js";
import { fixtureAdapter, personFixture } from "../dist/testing.js";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
const bin = process.env.ONTAVE_PG_CLIENT_BIN || "/opt/homebrew/opt/libpq/bin";
const source = await disposablePostgres();
let target;
const workspaceId = randomUUID();
const access = () => ({
  actorId: "restore-test",
  workspaceId,
  capabilities: ["provision", "read", "ingest", "review", "worker"],
});
const app = (db) =>
  createOntave({
    storage: db.storage,
    model: fixtureAdapter(() => personFixture("Ramesh")),
    authorize: access,
  });
const original = app(source);
const privateEnv = (db) => {
  const u = new URL(db.admin.options.connectionString);
  return {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: String(db.port),
    PGDATABASE: "postgres",
    PGUSER: "postgres",
    PGPASSWORD: decodeURIComponent(u.password),
  };
};
function run(name, args, db) {
  const result = spawnSync(resolve(bin, name), args, {
    env: privateEnv(db),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${name} did not complete successfully`);
  return result.stdout;
}
async function snapshot(db) {
  const tables = (
    await db.admin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='ontave' ORDER BY tablename",
    )
  ).rows;
  const out = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const { rows } = await db.admin.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS data FROM ontave.${tablename} t`,
    );
    const serialized = JSON.stringify(rows[0].data);
    out[tablename] = {
      rows: rows[0].data.length,
      sha256: createHash("sha256").update(serialized).digest("hex"),
    };
  }
  return out;
}
try {
  await original.workspaces.create(null, {
    workspaceId,
    name: "Fictional restore boundary",
    requestKey: "create",
    seed: "people",
  });
  const contract = await original.contracts.register(null, starter);
  const first = await original.ingest(null, {
    source: "restore",
    idempotencyKey: "accepted",
    payload: { kind: "text", text: "Ramesh" },
  });
  const work = await original.worker.runOnce(null);
  const bundle = await original.reviews.get(null, work.bundleId);
  await original.reviews.accept(null, {
    bundleId: bundle.id,
    digest: bundle.hash,
    requestKey: "accept",
    reason: "Known fictional restore fixture",
  });
  await original.ingest(null, {
    source: "restore",
    idempotencyKey: "waiting",
    payload: { kind: "text", text: "Ramesh" },
  });
  const waiting = await original.worker.runOnce(null);
  const before = await snapshot(source);
  const dir = await mkdtemp(resolve("artifacts/restore-"));
  const dump = resolve(dir, "ontave.dump");
  const dumpVersion = run("pg_dump", ["--version"], source).trim();
  run("pg_dump", ["--format=custom", "--no-password", "--file", dump], source);
  target = await disposablePostgres();
  await target.admin.query("DROP SCHEMA ontave CASCADE");
  run(
    "pg_restore",
    [
      "--single-transaction",
      "--exit-on-error",
      "--no-password",
      "--dbname=postgres",
      dump,
    ],
    target,
  );
  const after = await snapshot(target);
  assert.deepEqual(after, before);
  await migrate(target.admin, "ontave_runtime");
  assert.ok((await migrationPlan(target.admin)).every((x) => !x.pending));
  const restored = app(target);
  const page = await restored.entities.find(null, {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  });
  assert.equal(page.records.length, 1);
  assert.equal(page.records[0].fields.name.value, "Ramesh");
  assert.equal(
    (await restored.jobs.get(null, waiting.jobId)).state,
    "waiting_identity",
  );
  assert.equal(
    (await restored.evidence.get(null, first.evidence_id)).payload,
    "Ramesh",
  );
  await target.storage.transaction(randomUUID(), async (c) =>
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM ontave.evidence")).rows[0]
        .n,
      0,
    ),
  );
  const report = {
    ok: true,
    createdAt: new Date().toISOString(),
    mode: "operator pg_dump/pg_restore; two disposable PostgreSQL instances; stopped writers and workers; fictional data only",
    node: process.version,
    client: dumpVersion,
    tables: before,
    checks: {
      allTableContentHashesMatch: true,
      acceptedContractRead: true,
      evidencePreserved: true,
      waitingIdentityPreserved: true,
      restrictedRuntimeRole: true,
      wrongWorkspaceEmpty: true,
      migrationPlanClean: true,
    },
    limitations: [
      "No in-flight processing lease was restored in this exercise; separate fencing tests cover expired worker leases.",
      "No managed backup service or automatic application rollback is supplied.",
    ],
  };
  await writeFile(
    "artifacts/restore-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: true,
      tables: Object.keys(before).length,
      checks: report.checks,
    }),
  );
} finally {
  await source.storage.close();
  await source.stop();
  if (target) {
    await target.storage.close();
    await target.stop();
  }
}
