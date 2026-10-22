import { Pool } from "pg";
import type { PoolClient, PoolConfig } from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { check, OntaveError, parseUUID } from "./core.js";

export interface Storage {
  transaction<T>(
    workspace: string,
    fn: (client: PoolClient) => Promise<T>,
    options?: { isolation: "read committed" },
  ): Promise<T>;
  close(): Promise<void>;
}
export function postgres(config: PoolConfig): Storage {
  check(
    !!config.connectionString || !!config.host,
    "INVALID_INPUT",
    "Explicit PostgreSQL connection configuration is required",
  );
  const pool = new Pool({
    ...config,
    max: config.max ?? 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  let checked = false;
  // pg emits idle connection loss on the pool. Consume it without logging
  // connection details; pg removes that client and the next transaction reconnects.
  pool.on("error", () => {
    checked = false;
  });
  return {
    async transaction(workspace, fn, options) {
      parseUUID(workspace);
      for (let attempt = 0; attempt < 3; attempt++) {
        const c = await pool.connect().catch(() => {
          throw new OntaveError(
            "STORAGE_UNAVAILABLE",
            "Unable to connect to the configured database",
            true,
          );
        });
        try {
          if (!checked) {
            const r = await c.query(
              "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
            );
            check(
              !r.rows[0].rolsuper && !r.rows[0].rolbypassrls,
              "FORBIDDEN",
              "Runtime requires a non-superuser role without BYPASSRLS",
            );
            const owned = await c.query(
              "SELECT 1 FROM pg_tables WHERE schemaname='ontave' AND tableowner=current_user LIMIT 1",
            );
            check(
              owned.rowCount === 0,
              "FORBIDDEN",
              "Use a separate non-owner runtime role",
            );
            checked = true;
          }
          await c.query(
            options?.isolation === "read committed"
              ? "BEGIN ISOLATION LEVEL READ COMMITTED"
              : "BEGIN ISOLATION LEVEL REPEATABLE READ",
          );
          await c.query("SELECT set_config('ontave.workspace_id',$1,true)", [
            workspace,
          ]);
          const result = await fn(c);
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK").catch(() => {});
          if (
            e &&
            typeof e === "object" &&
            "code" in e &&
            ["40001", "40P01"].includes(String(e.code))
          ) {
            if (attempt < 2) continue;
            throw new OntaveError(
              "STALE_BUNDLE",
              "Concurrent change; retry the operation",
              true,
            );
          }
          if (e instanceof OntaveError) throw e;
          const code =
            e && typeof e === "object" && "code" in e ? String(e.code) : "";
          if (code === "23505")
            throw new OntaveError(
              "IDEMPOTENCY_CONFLICT",
              "Concurrent uniqueness conflict; inspect the existing scoped operation",
              true,
            );
          if (code === "23503")
            throw new OntaveError(
              "NOT_FOUND",
              "Referenced scoped record is unavailable",
            );
          if (["23514", "22P02", "22003"].includes(code))
            throw new OntaveError(
              "VALIDATION_FAILED",
              "Database value or constraint validation failed",
            );
          if (code === "42501")
            throw new OntaveError(
              "FORBIDDEN",
              "Database role does not permit this operation",
            );
          throw new OntaveError(
            "STORAGE_UNAVAILABLE",
            "Database transaction failed",
            true,
          );
        } finally {
          c.release();
        }
      }
      throw new OntaveError(
        "STALE_BUNDLE",
        "Transaction retry budget exhausted",
        true,
      );
    },
    async close() {
      await pool.end();
    },
  };
}
const migrationFiles = [
  "001_foundation.sql",
  "002_proposals.sql",
  "003_contract_lineage.sql",
  "004_worker_events.sql",
];
async function migrationSources() {
  return Promise.all(
    migrationFiles.map(async (file, index) => {
      const sql = await readFile(
        new URL("../migrations/" + file, import.meta.url),
        "utf8",
      );
      return {
        version: index + 1,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}
export async function migrationPlan(
  admin: Pool,
): Promise<{ version: number; checksum: string; pending: boolean }[]> {
  const sources = await migrationSources();
  const exists = await admin.query(
    "SELECT to_regclass('ontave.migrations') AS table_name",
  );
  const rows = exists.rows[0].table_name
    ? (
        await admin.query(
          "SELECT version,checksum FROM ontave.migrations ORDER BY version",
        )
      ).rows
    : [];
  check(
    rows.every((r) =>
      sources.some((s) => s.version === r.version && s.checksum === r.checksum),
    ),
    "VALIDATION_FAILED",
    "Applied migration checksum or version mismatch",
  );
  return sources.map((s) => ({
    version: s.version,
    checksum: s.checksum,
    pending: !rows.some((r) => r.version === s.version),
  }));
}
export async function migrate(admin: Pool, runtimeRole: string): Promise<void> {
  check(
    /^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole),
    "INVALID_INPUT",
    "Invalid runtime role",
  );
  const sources = await migrationSources(),
    c = await admin.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('ontave:internal-migrations'))",
    );
    const exists = await c.query(
      "SELECT to_regclass('ontave.migrations') AS table_name",
    );
    const applied = exists.rows[0].table_name
      ? (
          await c.query(
            "SELECT version,checksum FROM ontave.migrations ORDER BY version",
          )
        ).rows
      : [];
    check(
      applied.every((r) =>
        sources.some(
          (s) => s.version === r.version && s.checksum === r.checksum,
        ),
      ),
      "VALIDATION_FAILED",
      "Applied migration checksum or version mismatch",
    );
    for (const source of sources) {
      if (applied.some((r) => r.version === source.version)) continue;
      await c.query(source.sql);
      await c.query(
        "INSERT INTO ontave.migrations(version,checksum) VALUES($1,$2)",
        [source.version, source.checksum],
      );
    }
    await c.query(`GRANT USAGE ON SCHEMA ontave TO "${runtimeRole}"`);
    await c.query(
      `GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA ontave TO "${runtimeRole}"`,
    );
    await c.query(`REVOKE INSERT ON ontave.migrations FROM "${runtimeRole}"`);
    await c.query(
      `GRANT UPDATE ON ontave.workspaces,ontave.jobs,ontave.entities,ontave.projections TO "${runtimeRole}"`,
    );
    await c.query(
      `GRANT UPDATE(state,published_id) ON ontave.candidates TO "${runtimeRole}"`,
    );
    await c.query(
      `GRANT UPDATE(state,result,error) ON ontave.proposal_requests TO "${runtimeRole}"`,
    );
    await c.query(`GRANT DELETE ON ontave.projections TO "${runtimeRole}"`);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
