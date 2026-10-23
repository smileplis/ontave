// Flexible JSONB comparator. No Ontave imports, physical migration or future concept definition per event.
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  frozenDefinition,
  policy,
  digest,
  validatePlan,
  clone,
} from "./shared.mjs";
import { businessValues } from "./frozen-app.mjs";
import { reuseCurrentDefinitions } from "./references.mjs";
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
export async function migrateFlexible(admin, role) {
  if (!/^[a-z][a-z0-9_]*$/.test(role)) fail("INVALID_ROLE");
  await admin.query(`CREATE SCHEMA IF NOT EXISTS adaptive_plain;
    CREATE TABLE IF NOT EXISTS adaptive_plain.models(workspace_id uuid PRIMARY KEY,definition jsonb NOT NULL,revision integer NOT NULL);
    CREATE TABLE IF NOT EXISTS adaptive_plain.events(workspace_id uuid NOT NULL,id uuid NOT NULL,event_key text NOT NULL,source text NOT NULL,text text NOT NULL,input_hash text NOT NULL,state text NOT NULL,error text,PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,event_key));
    CREATE TABLE IF NOT EXISTS adaptive_plain.entities(workspace_id uuid NOT NULL,id uuid NOT NULL,concept_id text NOT NULL,entity_key text NOT NULL,name text NOT NULL,PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,concept_id,entity_key));
    CREATE TABLE IF NOT EXISTS adaptive_plain.claims(workspace_id uuid NOT NULL,id uuid NOT NULL,event_id uuid NOT NULL,entity_id uuid NOT NULL,fields jsonb NOT NULL,PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,event_id,entity_id),FOREIGN KEY(workspace_id,event_id) REFERENCES adaptive_plain.events(workspace_id,id),FOREIGN KEY(workspace_id,entity_id) REFERENCES adaptive_plain.entities(workspace_id,id));
    CREATE TABLE IF NOT EXISTS adaptive_plain.links(workspace_id uuid NOT NULL,event_id uuid NOT NULL,source_id uuid NOT NULL,target_id uuid NOT NULL,relation_id text NOT NULL,quote text NOT NULL,PRIMARY KEY(workspace_id,event_id,source_id,target_id,relation_id));
    CREATE TABLE IF NOT EXISTS adaptive_plain.decisions(workspace_id uuid NOT NULL,id uuid NOT NULL,event_id uuid NOT NULL,kind text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(workspace_id,id));`);
  for (const table of [
    "models",
    "events",
    "entities",
    "claims",
    "links",
    "decisions",
  ]) {
    await admin.query(
      `ALTER TABLE adaptive_plain.${table} ENABLE ROW LEVEL SECURITY;ALTER TABLE adaptive_plain.${table} FORCE ROW LEVEL SECURITY;`,
    );
    const existing = await admin.query(
      "SELECT 1 FROM pg_policies WHERE schemaname='adaptive_plain' AND tablename=$1 AND policyname='workspace_scope'",
      [table],
    );
    if (!existing.rowCount)
      await admin.query(
        `CREATE POLICY workspace_scope ON adaptive_plain.${table} USING(workspace_id=nullif(current_setting('adaptive.workspace_id',true),'')::uuid) WITH CHECK(workspace_id=nullif(current_setting('adaptive.workspace_id',true),'')::uuid)`,
      );
  }
  await admin.query(
    `GRANT USAGE ON SCHEMA adaptive_plain TO "${role}";GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA adaptive_plain TO "${role}";GRANT UPDATE ON adaptive_plain.models,adaptive_plain.events TO "${role}"`,
  );
}
export class FlexiblePostgres {
  constructor(connectionString, { reuseDefinitions = false } = {}) {
    this.reuseDefinitions = reuseDefinitions;
    this.pool = new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    this.pool.on("error", () => {});
    this.workspaceId = randomUUID();
  }
  async tx(fn) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await this.pool.connect();
      try {
        const role = (
          await c.query(
            "SELECT rolsuper,rolbypassrls,EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='adaptive_plain' AND tableowner=current_user) AS owns FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0];
        if (role.rolsuper || role.rolbypassrls || role.owns) fail("FORBIDDEN");
        await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await c.query("SELECT set_config('adaptive.workspace_id',$1,true)", [
          this.workspaceId,
        ]);
        const result = await fn(c);
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        if (["40001", "40P01"].includes(e.code) && attempt < 2) continue;
        throw e;
      } finally {
        c.release();
      }
    }
  }
  async setup() {
    await this.tx((c) =>
      c.query("INSERT INTO adaptive_plain.models VALUES($1,$2,1)", [
        this.workspaceId,
        JSON.stringify(frozenDefinition),
      ]),
    );
  }
  async definition() {
    return this.tx(
      async (c) =>
        (await c.query("SELECT definition FROM adaptive_plain.models")).rows[0]
          .definition,
    );
  }
  async apply(event, plan, { seed = false } = {}) {
    const eventId = randomUUID(),
      hash = digest({ source: event.source ?? "supplier", text: event.text });
    const receipt = await this.tx(async (c) => {
      const old = (
        await c.query(
          "SELECT * FROM adaptive_plain.events WHERE event_key=$1",
          [event.id],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== hash) fail("IDEMPOTENCY_CONFLICT");
        return old;
      }
      return (
        await c.query(
          "INSERT INTO adaptive_plain.events VALUES($1,$2,$3,$4,$5,$6,'queued',NULL) RETURNING *",
          [
            this.workspaceId,
            eventId,
            event.id,
            event.source ?? "supplier",
            event.text,
            hash,
          ],
        )
      ).rows[0];
    });
    if (receipt.state === "completed")
      return { state: "completed", duplicate: true, events: [] };
    try {
      return await this.tx(async (c) => {
        const before = (
          await c.query(
            "SELECT definition FROM adaptive_plain.models FOR UPDATE",
          )
        ).rows[0].definition;
        const candidate = this.reuseDefinitions
          ? reuseCurrentDefinitions(plan, before)
          : plan;
        if (!policy.sources.includes(event.source ?? "supplier"))
          fail("FORBIDDEN");
        const after = validatePlan(candidate, before, event.text);
        if (plan.observations.length) fail("UNRESOLVED_OBSERVATION");
        const ids = new Map();
        for (const e of plan.entities) {
          let key =
            e.conceptId === "quotation"
              ? String(e.fields.reference.value)
              : e.conceptId === "quote_line"
                ? String(e.fields.quote_reference.value) +
                  ":" +
                  String(e.fields.sku.value)
                : event.id + ":" + e.mentionId;
          const old = (
            await c.query(
              "SELECT id FROM adaptive_plain.entities WHERE concept_id=$1 AND entity_key=$2",
              [e.conceptId, key],
            )
          ).rows[0];
          if (!seed && !e.conceptId.startsWith(policy.namespace) && !old)
            fail("UNRESOLVED_PARENT");
          if (
            e.conceptId === "quotation" &&
            plan.relationships.some((r) => r.target === e.mentionId) &&
            !old
          )
            fail("UNRESOLVED_PARENT");
          const id = old?.id ?? randomUUID();
          if (!old)
            await c.query(
              "INSERT INTO adaptive_plain.entities VALUES($1,$2,$3,$4,$5)",
              [this.workspaceId, id, e.conceptId, key, e.name],
            );
          ids.set(e.mentionId, id);
          await c.query(
            "INSERT INTO adaptive_plain.claims VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
            [
              this.workspaceId,
              randomUUID(),
              receipt.id,
              id,
              JSON.stringify(e.fields),
            ],
          );
        }
        for (const r of plan.relationships)
          await c.query(
            "INSERT INTO adaptive_plain.links VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
            [
              this.workspaceId,
              receipt.id,
              ids.get(r.source),
              ids.get(r.target),
              r.relationId,
              r.quote,
            ],
          );
        if (digest(before) !== digest(after))
          await c.query(
            "UPDATE adaptive_plain.models SET definition=$1,revision=revision+1",
            [JSON.stringify(after)],
          );
        await c.query(
          "INSERT INTO adaptive_plain.decisions VALUES($1,$2,$3,$4,$5)",
          [
            this.workspaceId,
            randomUUID(),
            receipt.id,
            "policy-accept",
            JSON.stringify({
              policyHash: digest(policy),
              requestedPatch: plan.patch,
              appliedPatch: candidate.patch,
              normalization: candidate.normalization ?? [],
              semanticAccuracyQualified: false,
            }),
          ],
        );
        await c.query(
          "UPDATE adaptive_plain.events SET state='completed' WHERE id=$1",
          [receipt.id],
        );
        return {
          state: "completed",
          events: candidate.patch.concepts.length
            ? [{ kind: "policy-publication" }]
            : [],
        };
      });
    } catch (e) {
      await this.tx((c) =>
        c.query(
          "UPDATE adaptive_plain.events SET state='pending',error=$2 WHERE id=$1",
          [receipt.id, e.code ?? e.message],
        ),
      );
      return {
        state: "pending",
        events: [],
        exception: { code: e.code ?? e.message },
      };
    }
  }
  async records(c, conceptId, definition) {
    const rows = (
      await c.query(
        "SELECT e.*,c.fields,ev.event_key FROM adaptive_plain.entities e JOIN adaptive_plain.claims c ON(c.workspace_id=e.workspace_id AND c.entity_id=e.id) JOIN adaptive_plain.events ev ON(ev.workspace_id=c.workspace_id AND ev.id=c.event_id) WHERE e.concept_id=$1 ORDER BY e.entity_key,c.id",
        [conceptId],
      )
    ).rows;
    const groups = Map.groupBy(rows, (r) => r.id),
      result = [];
    for (const [id, sources] of groups) {
      const fields = {};
      for (const f of definition.concepts.find((x) => x.id === conceptId)
        .fields) {
        const claims = sources
            .filter((s) => s.fields[f.id])
            .map((s) => ({ id: s.id, value: s.fields[f.id].value })),
          values = [
            ...new Map(claims.map((x) => [digest(x.value), x.value])).values(),
          ];
        fields[f.id] =
          values.length > 1
            ? {
                state: "conflict",
                candidates: values.map((value) => ({
                  value,
                  verification: "reported",
                  assertionIds: claims.map((x) => x.id),
                })),
              }
            : values.length
              ? {
                  state: "value",
                  value: values[0],
                  verification: "reported",
                  assertionIds: claims.map((x) => x.id),
                }
              : { state: "missing" };
      }
      result.push({
        id,
        conceptId,
        fields,
        sourceEventIds: [...new Set(sources.map((x) => x.event_key))],
      });
    }
    return result;
  }
  async findFrozen(query) {
    return this.tx(async (c) => {
      let rows = await this.records(c, query.conceptId, frozenDefinition);
      for (const f of query.where ?? [])
        rows = rows.filter(
          (r) =>
            f.op === "eq" &&
            r.fields[f.field]?.state === "value" &&
            digest(r.fields[f.field].value) === digest(f.value),
        );
      if (query.order)
        rows.sort(
          (a, b) =>
            String(a.fields[query.order.field]?.value ?? "").localeCompare(
              String(b.fields[query.order.field]?.value ?? ""),
              "en",
              { numeric: true },
            ) * (query.order.direction === "desc" ? -1 : 1),
        );
      return businessValues(rows.slice(0, query.limit ?? 25));
    });
  }
  async related(parentConcept) {
    return this.tx(async (c) => {
      const d = (await c.query("SELECT definition FROM adaptive_plain.models"))
          .rows[0].definition,
        parents = await this.records(c, parentConcept, d),
        result = [];
      for (const relation of d.relations.filter(
        (r) => r.target === parentConcept,
      ))
        for (const row of await this.records(c, relation.source, d)) {
          const links = (
            await c.query(
              "SELECT target_id FROM adaptive_plain.links WHERE source_id=$1 AND relation_id=$2",
              [row.id, relation.id],
            )
          ).rows;
          result.push({
            ...row,
            parentReferences: [
              ...new Set(
                links.map(
                  (l) =>
                    parents.find((p) => p.id === l.target_id)?.fields.reference
                      .value,
                ),
              ),
            ],
          });
        }
      return result;
    });
  }
  close() {
    return this.pool.end();
  }
}
