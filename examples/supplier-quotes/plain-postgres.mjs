// Plain LLM + PostgreSQL comparator. No imports from Ontave, its internals or test fixtures.
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { digest, validateOutput, recordKey, canonical } from "./domain.mjs";
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const check = (ok, code) => {
  if (!ok) fail(code);
};
export async function migratePlain(admin, runtimeRole) {
  check(/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole), "INVALID_ROLE");
  await admin.query(`
    CREATE SCHEMA IF NOT EXISTS quotation_plain;
    CREATE TABLE IF NOT EXISTS quotation_plain.evidence (
      workspace_id uuid NOT NULL,id uuid NOT NULL,source text NOT NULL,event_key text NOT NULL,envelope_hash text NOT NULL,text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,source,event_key));
    CREATE TABLE IF NOT EXISTS quotation_plain.jobs (
      workspace_id uuid NOT NULL,id uuid NOT NULL,evidence_id uuid NOT NULL,state text NOT NULL CHECK(state IN('queued','processing','waiting_review','waiting_identity','waiting_ontology','completed','rejected','failed')),
      attempts integer NOT NULL DEFAULT 0,fence integer NOT NULL DEFAULT 0,lease_until timestamptz,bundle_id uuid,error text,
      created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,evidence_id) REFERENCES quotation_plain.evidence(workspace_id,id));
    CREATE TABLE IF NOT EXISTS quotation_plain.bundles (
      workspace_id uuid NOT NULL,id uuid NOT NULL,job_id uuid NOT NULL,evidence_id uuid NOT NULL,hash text NOT NULL,body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES quotation_plain.jobs(workspace_id,id),FOREIGN KEY(workspace_id,evidence_id) REFERENCES quotation_plain.evidence(workspace_id,id));
    CREATE TABLE IF NOT EXISTS quotation_plain.entities (
      workspace_id uuid NOT NULL,id uuid NOT NULL,type text NOT NULL,key text NOT NULL,revision integer NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,id));
    CREATE TABLE IF NOT EXISTS quotation_plain.assertions (
      workspace_id uuid NOT NULL,id uuid NOT NULL,entity_id uuid NOT NULL,field_id text NOT NULL,value jsonb NOT NULL,
      verification text NOT NULL CHECK(verification='reported'),evidence_id uuid NOT NULL,bundle_id uuid NOT NULL,quote text NOT NULL,
      PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,entity_id) REFERENCES quotation_plain.entities(workspace_id,id),FOREIGN KEY(workspace_id,evidence_id) REFERENCES quotation_plain.evidence(workspace_id,id),FOREIGN KEY(workspace_id,bundle_id) REFERENCES quotation_plain.bundles(workspace_id,id));
    CREATE TABLE IF NOT EXISTS quotation_plain.decisions (
      workspace_id uuid NOT NULL,id uuid NOT NULL,kind text NOT NULL,request_key text NOT NULL,input_hash text NOT NULL,actor_id text NOT NULL,reason text NOT NULL,result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,kind,request_key));
    CREATE INDEX IF NOT EXISTS quotation_jobs_claim ON quotation_plain.jobs(workspace_id,state,created_at);
    CREATE INDEX IF NOT EXISTS quotation_assertions_entity ON quotation_plain.assertions(workspace_id,entity_id);
  `);
  for (const table of [
    "evidence",
    "jobs",
    "bundles",
    "entities",
    "assertions",
    "decisions",
  ]) {
    await admin.query(
      `ALTER TABLE quotation_plain.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE quotation_plain.${table} FORCE ROW LEVEL SECURITY;`,
    );
    const policy = await admin.query(
      "SELECT 1 FROM pg_policies WHERE schemaname=$1 AND tablename=$2 AND policyname=$3",
      ["quotation_plain", table, "workspace_scope"],
    );
    if (!policy.rowCount)
      await admin.query(
        `CREATE POLICY workspace_scope ON quotation_plain.${table} USING(workspace_id=nullif(current_setting('quotation.workspace_id',true),'')::uuid) WITH CHECK(workspace_id=nullif(current_setting('quotation.workspace_id',true),'')::uuid)`,
      );
  }
  await admin.query(
    `GRANT USAGE ON SCHEMA quotation_plain TO "${runtimeRole}"; GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA quotation_plain TO "${runtimeRole}"; GRANT UPDATE ON quotation_plain.jobs,quotation_plain.entities TO "${runtimeRole}";`,
  );
}
export class PlainQuotationStore {
  constructor({ connectionString, authorize, extract }) {
    this.pool = new Pool({
      connectionString,
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    this.pool.on("error", () => {});
    this.authorize = authorize;
    this.extract = extract;
  }
  async transaction(context, capability, fn) {
    const access = await this.authorize(context);
    check(
      access?.capabilities?.includes(capability) && uuid(access.workspaceId),
      "FORBIDDEN",
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await this.pool
        .connect()
        .catch(() => fail("STORAGE_UNAVAILABLE"));
      try {
        const role = (
          await c.query(
            "SELECT rolsuper,rolbypassrls,EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='quotation_plain' AND tableowner=current_user) AS owner FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0];
        check(!role.rolsuper && !role.rolbypassrls && !role.owner, "FORBIDDEN");
        await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await c.query("SELECT set_config('quotation.workspace_id',$1,true)", [
          access.workspaceId,
        ]);
        const result = await fn(c, access);
        await c.query("COMMIT");
        return result;
      } catch (error) {
        await c.query("ROLLBACK").catch(() => {});
        if (["40001", "40P01"].includes(error.code) && attempt < 2) continue;
        if (error.code && /^[A-Z_]+$/.test(error.code)) throw error;
        fail(
          error.code === "23505"
            ? "IDEMPOTENCY_CONFLICT"
            : "STORAGE_UNAVAILABLE",
        );
      } finally {
        c.release();
      }
    }
  }
  async ingest(context, { source = "supplier", id, text }) {
    check(
      typeof source === "string" &&
        source.length > 0 &&
        source.length <= 200 &&
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 200 &&
        typeof text === "string" &&
        Buffer.byteLength(text) <= 262144,
      "INVALID_INPUT",
    );
    return this.transaction(context, "ingest", async (c, a) => {
      const envelope = digest({ source, id, text }),
        evidenceId = randomUUID(),
        jobId = randomUUID();
      const inserted = await c.query(
        "INSERT INTO quotation_plain.evidence(workspace_id,id,source,event_key,envelope_hash,text) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,source,event_key) DO NOTHING RETURNING id",
        [a.workspaceId, evidenceId, source, id, envelope, text],
      );
      if (!inserted.rowCount) {
        const old = (
          await c.query(
            "SELECT e.envelope_hash,e.id AS evidence_id,j.id AS job_id FROM quotation_plain.evidence e JOIN quotation_plain.jobs j ON(j.workspace_id=e.workspace_id AND j.evidence_id=e.id) WHERE e.source=$1 AND e.event_key=$2",
            [source, id],
          )
        ).rows[0];
        check(old?.envelope_hash === envelope, "IDEMPOTENCY_CONFLICT");
        return { evidenceId: old.evidence_id, jobId: old.job_id };
      }
      await c.query(
        "INSERT INTO quotation_plain.jobs(workspace_id,id,evidence_id,state) VALUES($1,$2,$3,'queued')",
        [a.workspaceId, jobId, evidenceId],
      );
      return { evidenceId, jobId };
    });
  }
  async process(context) {
    check(typeof this.extract === "function", "MODEL_UNAVAILABLE");
    const claimed = await this.transaction(context, "worker", async (c) => {
      const r = await c.query(
        "SELECT * FROM quotation_plain.jobs WHERE (state='queued' OR (state='processing' AND lease_until<now())) AND attempts<3 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!r.rowCount) return null;
      const job = (
        await c.query(
          "UPDATE quotation_plain.jobs SET state='processing',attempts=attempts+1,fence=fence+1,lease_until=now()+interval '90 seconds' WHERE id=$1 RETURNING *",
          [r.rows[0].id],
        )
      ).rows[0];
      const evidence = (
        await c.query("SELECT * FROM quotation_plain.evidence WHERE id=$1", [
          job.evidence_id,
        ])
      ).rows[0];
      return { job, evidence };
    });
    if (!claimed) return null;
    let output, error, timer;
    try {
      output = validateOutput(
        await Promise.race([
          this.extract(claimed.evidence.text),
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(Error("MODEL_TIMEOUT")), 45000);
            timer.unref();
          }),
        ]),
        claimed.evidence.text,
      );
    } catch {
      error = "INVALID_OR_UNAVAILABLE_EXTRACTION";
    } finally {
      clearTimeout(timer);
    }
    return this.transaction(context, "worker", async (c, a) => {
      const current = (
        await c.query(
          "SELECT * FROM quotation_plain.jobs WHERE id=$1 AND state='processing' AND fence=$2 AND lease_until>now() FOR UPDATE",
          [claimed.job.id, claimed.job.fence],
        )
      ).rows[0];
      check(current, "LEASE_LOST");
      if (error) {
        await c.query(
          "UPDATE quotation_plain.jobs SET state='failed',error=$2 WHERE id=$1",
          [current.id, error],
        );
        return { jobId: current.id, state: "failed", error };
      }
      const resolutions = {},
        pending = [],
        identityCandidates = {};
      for (let i = 0; i < output.records.length; i++) {
        const record = output.records[i],
          matches = (
            await c.query(
              "SELECT id,type,key,revision FROM quotation_plain.entities WHERE type=$1 AND key=$2 ORDER BY id LIMIT 10",
              [record.type, recordKey(record)],
            )
          ).rows;
        if (matches.length) {
          pending.push("m" + i);
          identityCandidates["m" + i] = matches;
        } else
          resolutions["m" + i] = {
            entityId: randomUUID(),
            revision: 0,
            mode: "new",
          };
      }
      const body = { output, resolutions, pending, identityCandidates },
        bundleId = randomUUID(),
        hash = digest(body),
        state = output.observations.length
          ? "waiting_ontology"
          : pending.length
            ? "waiting_identity"
            : "waiting_review";
      await c.query(
        "INSERT INTO quotation_plain.bundles(workspace_id,id,job_id,evidence_id,hash,body) VALUES($1,$2,$3,$4,$5,$6)",
        [a.workspaceId, bundleId, current.id, claimed.evidence.id, hash, body],
      );
      await c.query(
        "UPDATE quotation_plain.jobs SET state=$2,bundle_id=$3,lease_until=NULL WHERE id=$1",
        [current.id, state, bundleId],
      );
      return { jobId: current.id, bundleId, state };
    });
  }
  async review(context, jobId) {
    check(uuid(jobId), "INVALID_INPUT");
    return this.transaction(context, "review", async (c, a) => {
      check(a.capabilities.includes("read"), "FORBIDDEN");
      const job = (
        await c.query("SELECT * FROM quotation_plain.jobs WHERE id=$1", [jobId])
      ).rows[0];
      check(job, "NOT_FOUND");
      const evidence = (
        await c.query(
          "SELECT id,text FROM quotation_plain.evidence WHERE id=$1",
          [job.evidence_id],
        )
      ).rows[0];
      const bundle = job.bundle_id
        ? (
            await c.query("SELECT * FROM quotation_plain.bundles WHERE id=$1", [
              job.bundle_id,
            ])
          ).rows[0]
        : null;
      return {
        jobId,
        state: job.state,
        evidence: { id: evidence.id, text: evidence.text },
        bundle: bundle
          ? {
              id: bundle.id,
              digest: bundle.hash,
              output: bundle.body.output,
              pending: bundle.body.pending,
              identityCandidates: bundle.body.identityCandidates,
            }
          : null,
      };
    });
  }
  async decision(context, kind, input, operation) {
    check(
      uuid(input.bundleId) &&
        /^[a-f0-9]{64}$/.test(input.digest) &&
        typeof input.key === "string" &&
        input.key.length > 0 &&
        input.key.length <= 200 &&
        typeof input.reason === "string" &&
        input.reason.trim().length > 0 &&
        input.reason.length <= 2000,
      "INVALID_INPUT",
    );
    return this.transaction(context, "review", async (c, a) => {
      const hash = digest(input),
        old = (
          await c.query(
            "SELECT * FROM quotation_plain.decisions WHERE kind=$1 AND request_key=$2",
            [kind, input.key],
          )
        ).rows[0];
      if (old) {
        check(old.input_hash === hash, "IDEMPOTENCY_CONFLICT");
        return old.result;
      }
      const b = (
        await c.query(
          "SELECT b.*,j.state,j.bundle_id AS current_bundle FROM quotation_plain.bundles b JOIN quotation_plain.jobs j ON(j.workspace_id=b.workspace_id AND j.id=b.job_id) WHERE b.id=$1 FOR UPDATE OF j",
          [input.bundleId],
        )
      ).rows[0];
      check(b, "NOT_FOUND");
      check(
        b.hash === input.digest &&
          b.current_bundle === b.id &&
          ["waiting_review", "waiting_identity", "waiting_ontology"].includes(
            b.state,
          ),
        "STALE_BUNDLE",
      );
      const result = await operation(c, a, b);
      await c.query(
        "INSERT INTO quotation_plain.decisions(workspace_id,id,kind,request_key,input_hash,actor_id,reason,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          a.workspaceId,
          randomUUID(),
          kind,
          input.key,
          hash,
          a.actorId,
          input.reason,
          result,
        ],
      );
      return result;
    });
  }
  async revised(c, a, b, body) {
    const id = randomUUID(),
      hash = digest(body),
      state = body.output.observations.length
        ? "waiting_ontology"
        : body.pending.length
          ? "waiting_identity"
          : "waiting_review";
    await c.query(
      "INSERT INTO quotation_plain.bundles(workspace_id,id,job_id,evidence_id,hash,body) VALUES($1,$2,$3,$4,$5,$6)",
      [a.workspaceId, id, b.job_id, b.evidence_id, hash, body],
    );
    await c.query(
      "UPDATE quotation_plain.jobs SET bundle_id=$2,state=$3 WHERE id=$1",
      [b.job_id, id, state],
    );
    return { bundleId: id, digest: hash };
  }
  amend(context, input) {
    return this.decision(context, "amend", input, async (c, a, b) => {
      const evidence = (
        await c.query("SELECT text FROM quotation_plain.evidence WHERE id=$1", [
          b.evidence_id,
        ])
      ).rows[0];
      const output = validateOutput(input.output, evidence.text);
      // Preserve identity binding; edits cannot silently change the set of record identities.
      check(
        canonical(output.records.map((r) => [r.type, recordKey(r)])) ===
          canonical(b.body.output.records.map((r) => [r.type, recordKey(r)])),
        "IDENTITY_CHANGE_REQUIRES_NEW_REVIEW",
      );
      return this.revised(c, a, b, { ...b.body, output });
    });
  }
  resolveIdentity(context, input) {
    return this.decision(context, "identity", input, async (c, a, b) => {
      check(b.body.pending.includes(input.mentionId), "INVALID_INPUT");
      const record = b.body.output.records[Number(input.mentionId.slice(1))];
      check(record, "INVALID_INPUT");
      let resolution = { entityId: randomUUID(), revision: 0, mode: "new" };
      if (input.entityId !== "new") {
        check(uuid(input.entityId), "INVALID_INPUT");
        const entity = (
          await c.query(
            "SELECT * FROM quotation_plain.entities WHERE id=$1 AND type=$2",
            [input.entityId, record.type],
          )
        ).rows[0];
        check(entity, "NOT_FOUND");
        resolution = {
          entityId: entity.id,
          revision: entity.revision,
          mode: "link",
        };
      }
      return this.revised(c, a, b, {
        ...b.body,
        resolutions: { ...b.body.resolutions, [input.mentionId]: resolution },
        pending: b.body.pending.filter((m) => m !== input.mentionId),
      });
    });
  }
  accept(context, input) {
    return this.decision(context, "accept", input, async (c, a, b) => {
      check(
        b.state === "waiting_review" &&
          !b.body.pending.length &&
          !b.body.output.observations.length,
        "UNRESOLVED_DEPENDENCIES",
      );
      const evidence = (
        await c.query("SELECT text FROM quotation_plain.evidence WHERE id=$1", [
          b.evidence_id,
        ])
      ).rows[0];
      validateOutput(b.body.output, evidence.text);
      const ids = [];
      for (let i = 0; i < b.body.output.records.length; i++) {
        const record = b.body.output.records[i],
          resolution = b.body.resolutions["m" + i];
        check(resolution, "UNRESOLVED_IDENTITY");
        if (resolution.mode === "new")
          await c.query(
            "INSERT INTO quotation_plain.entities(workspace_id,id,type,key,revision) VALUES($1,$2,$3,$4,0)",
            [
              a.workspaceId,
              resolution.entityId,
              record.type,
              recordKey(record),
            ],
          );
        const updated = await c.query(
          "UPDATE quotation_plain.entities SET revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING id",
          [resolution.entityId, resolution.revision],
        );
        check(updated.rowCount === 1, "STALE_BUNDLE");
        for (const [field, claim] of Object.entries(record.fields))
          await c.query(
            "INSERT INTO quotation_plain.assertions(workspace_id,id,entity_id,field_id,value,verification,evidence_id,bundle_id,quote) VALUES($1,$2,$3,$4,$5,'reported',$6,$7,$8)",
            [
              a.workspaceId,
              randomUUID(),
              resolution.entityId,
              field,
              JSON.stringify(claim.value),
              b.evidence_id,
              b.id,
              claim.quote,
            ],
          );
        ids.push(resolution.entityId);
      }
      await c.query(
        "UPDATE quotation_plain.jobs SET state='completed' WHERE id=$1",
        [b.job_id],
      );
      return { entityIds: ids };
    });
  }
  reject(context, input) {
    return this.decision(context, "reject", input, async (c, a, b) => {
      await c.query(
        "UPDATE quotation_plain.jobs SET state='rejected' WHERE id=$1",
        [b.job_id],
      );
      return { rejected: true };
    });
  }
  async read(context) {
    return this.transaction(context, "read", async (c) => {
      const entities = (
          await c.query(
            "SELECT * FROM quotation_plain.entities ORDER BY id LIMIT 100",
          )
        ).rows,
        assertions = (
          await c.query(
            "SELECT * FROM quotation_plain.assertions WHERE entity_id=ANY($1::uuid[]) ORDER BY id",
            [entities.map((e) => e.id)],
          )
        ).rows;
      return {
        records: entities.map((e) => {
          const fields = {};
          for (const a of assertions.filter((a) => a.entity_id === e.id)) {
            fields[a.field_id] ??= [];
            fields[a.field_id].push(a);
          }
          return {
            id: e.id,
            conceptId: e.type,
            name: e.key,
            revision: e.revision,
            fields: Object.fromEntries(
              Object.entries(fields).map(([field, rows]) => {
                const groups = Object.groupBy(rows, (r) => canonical(r.value)),
                  values = Object.values(groups);
                return [
                  field,
                  values.length === 1
                    ? {
                        state: "value",
                        value: values[0][0].value,
                        verification: "reported",
                        assertionIds: values[0].map((r) => r.id),
                      }
                    : {
                        state: "conflict",
                        candidates: values.map((v) => ({
                          value: v[0].value,
                          verification: "reported",
                          assertionIds: v.map((r) => r.id),
                        })),
                      },
                ];
              }),
            ),
          };
        }),
      };
    });
  }
  async explain(context, entityId) {
    check(uuid(entityId), "INVALID_INPUT");
    return this.transaction(
      context,
      "read",
      async (c) =>
        (
          await c.query(
            "SELECT id,evidence_id,field_id,value,verification,quote FROM quotation_plain.assertions WHERE entity_id=$1 ORDER BY id",
            [entityId],
          )
        ).rows,
    );
  }
  async close() {
    await this.pool.end();
  }
}
