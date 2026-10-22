import type { PoolClient } from "pg";
import { z } from "zod";
import type {
  Definition,
  EntityQuery,
  EntityRecord,
  FieldResult,
  FieldDefinition,
} from "./types.js";
import {
  check,
  hash,
  json,
  normalizeValue,
  validateValue,
  decodeCursor,
  encodeCursor,
  parseUUID,
  uuid,
  idSchema,
} from "./core.js";
import { validateContractRecords } from "./codegen.js";
export const entityQuerySchema = z
  .object({
    contractId: uuid,
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    conceptId: idSchema,
    where: z
      .array(
        z
          .object({
            field: idSchema,
            op: z.enum([
              "eq",
              "in",
              "gt",
              "gte",
              "lt",
              "lte",
              "stateIs",
              "verificationIn",
            ]),
            value: z.json(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    order: z
      .object({ field: idSchema, direction: z.enum(["asc", "desc"]) })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(8192).optional(),
    include: z.array(idSchema).max(10).optional(),
  })
  .strict();

/** Shared SQL implementation for live reads and bounded, immutable evaluator fixtures. */
export async function readRecords(
  c: Pick<PoolClient, "query">,
  input: EntityQuery,
  d: Definition,
  workspace: string,
  cursorSecret: string,
  ontologyHash: string,
) {
  // Fresh bulk imports can have severely stale cardinality statistics. A nested loop
  // can rescan an entire scoped field index for every entity (quadratic work).
  // This closed read profile uses hash/merge joins; settings reset at transaction end.
  await c.query(
    "SELECT set_config('enable_nestloop','off',true),set_config('jit','off',true)",
  );
  const parsed = entityQuerySchema.safeParse(input);
  check(parsed.success, "INVALID_INPUT", "Invalid closed structured query");
  const query = parsed.data as EntityQuery;
  const concept = d.concepts.find((x) => x.id === query.conceptId);
  check(concept, "INVALID_INPUT", "Concept absent from contract");
  for (const rid of query.include ?? [])
    check(
      d.relations.some((x) => x.id === rid && x.source === concept.id),
      "INVALID_INPUT",
      "Relationship absent from contract",
    );
  const values: unknown[] = [query.conceptId],
    joins: string[] = [],
    where = ["e.concept_id=$1"];
  const bind = (x: unknown) => {
    values.push(x);
    return "$" + values.length;
  };
  // Keep an explicit scoped index bound in the compiled query as well as RLS.
  where.push(`e.workspace_id=${bind(workspace)}::uuid`);
  let idx = 0;
  const column = (f: FieldDefinition) =>
    ["integer", "decimal"].includes(f.type)
      ? "val_num"
      : f.type === "boolean"
        ? "val_bool"
        : ["date", "timestamp"].includes(f.type)
          ? "val_ts"
          : "val_text";
  for (const filter of query.where ?? []) {
    const f = concept.fields.find((x) => x.id === filter.field);
    check(f, "INVALID_INPUT", "Unknown filter field");
    const alias = "p" + idx++;
    joins.push(
      `LEFT JOIN ontave.projections ${alias} ON ${alias}.workspace_id=e.workspace_id AND ${alias}.entity_id=e.id AND ${alias}.field_id=${bind(f.id)}`,
    );
    if (filter.op === "stateIs") {
      check(
        typeof filter.value === "string" &&
          ["value", "unknown", "missing", "conflict"].includes(filter.value),
        "INVALID_INPUT",
        "Unknown state",
      );
      where.push(
        `coalesce(${alias}.result->>'state',${f.optional ? "'missing'" : "'unknown'"})=${bind(filter.value)}`,
      );
      continue;
    }
    if (filter.op === "verificationIn") {
      check(
        Array.isArray(filter.value) &&
          filter.value.every(
            (x) =>
              typeof x === "string" &&
              ["reported", "verified", "disputed", "unknown"].includes(x),
          ),
        "INVALID_INPUT",
        "Invalid verification filter",
      );
      where.push(
        `${alias}.result->>'verification'=ANY(${bind(filter.value)}::text[])`,
      );
      continue;
    }
    check(
      ["eq", "in", "gt", "gte", "lt", "lte"].includes(filter.op),
      "INVALID_INPUT",
      "Unsupported operator",
    );
    const vals = filter.op === "in" ? filter.value : [filter.value];
    check(
      Array.isArray(vals) && vals.length > 0 && vals.length <= 100,
      "INVALID_INPUT",
      "Invalid predicate value set",
    );
    for (const v of vals) validateValue(f, v);
    where.push(`${alias}.result->>'state'='value'`);
    if (filter.op === "eq" || filter.op === "in")
      where.push(
        "(" +
          vals
            .map(
              (v) =>
                `${alias}.result->'value'=${bind(json(normalizeValue(f, v)))}::jsonb`,
            )
            .join(" OR ") +
          ")",
      );
    else {
      check(
        filter.value !== null &&
          ["integer", "decimal", "date", "timestamp", "text", "enum"].includes(
            f.type,
          ),
        "INVALID_INPUT",
        "Range unsupported for this value type",
      );
      const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op as "gt"];
      where.push(`${alias}.${column(f)} ${op} ${bind(filter.value)}`);
    }
  }
  let rankExpression = "3";
  let order = "e.id ASC",
    cursorOrder: any = null;
  const queryHash = hash({ ...query, cursor: null, limit: null });
  if (query.order) {
    const f = concept.fields.find((x) => x.id === query.order!.field);
    check(
      f &&
        f.type !== "money" &&
        ["asc", "desc"].includes(query.order.direction),
      "INVALID_INPUT",
      "Unsupported ordering",
    );
    const dir = query.order.direction === "asc" ? "ASC" : "DESC",
      col = column(f);
    rankExpression = `coalesce(sort.state_rank,${f.optional ? 3 : 4})`;
    joins.push(
      `LEFT JOIN ontave.projections sort ON sort.workspace_id=e.workspace_id AND sort.entity_id=e.id AND sort.field_id=${bind(f.id)}`,
    );
    order = `${rankExpression} ASC,sort.${col} ${dir} NULLS LAST,e.id ASC`;
    cursorOrder = { field: f.id, col, direction: query.order.direction };
    if (query.cursor) {
      const cur = decodeCursor(query.cursor, cursorSecret) as any;
      check(
        cur.workspace === workspace && cur.queryHash === queryHash,
        "INVALID_INPUT",
        "Cursor belongs to another scope/query",
      );
      const rank = bind(cur.rank),
        id = bind(parseUUID(cur.id));
      const val = bind(cur.value);
      const cmp = dir === "ASC" ? ">" : "<";
      where.push(
        `(${rankExpression}>${rank} OR (${rankExpression}=${rank} AND ((sort.${col} ${cmp} ${val}) OR (sort.${col} IS NOT DISTINCT FROM ${val} AND e.id>${id}::uuid))))`,
      );
    }
  } else if (query.cursor) {
    const cur = decodeCursor(query.cursor, cursorSecret) as any;
    check(
      cur.workspace === workspace && cur.queryHash === queryHash,
      "INVALID_INPUT",
      "Cursor belongs to another scope/query",
    );
    where.push(`e.id>${bind(parseUUID(cur.id))}::uuid`);
  }
  const select = cursorOrder
    ? `,${rankExpression} AS sort_rank,sort.${cursorOrder.col}::text AS sort_value`
    : "";
  const rows = await c.query(
    `SELECT e.*${select} FROM ontave.entities e ${joins.join(" ")} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${bind((query.limit ?? 25) + 1)}`,
    values,
  );
  const hasMore = rows.rows.length > (query.limit ?? 25);
  const selected = rows.rows.slice(0, query.limit ?? 25);
  const pageProjections = selected.length
    ? await c.query(
        "SELECT entity_id,field_id,result FROM ontave.projections WHERE workspace_id=$1 AND entity_id=ANY($2::uuid[])",
        [workspace, selected.map((x) => x.id)],
      )
    : { rows: [] };
  const records: EntityRecord[] = [];
  for (const row of selected) {
    const projections = pageProjections.rows.filter(
      (p) => p.entity_id === row.id,
    );
    const fields: Record<string, FieldResult> = {};
    for (const f of concept.fields) {
      fields[f.id] =
        projections.find((x) => x.field_id === f.id)?.result ??
        (f.optional
          ? { state: "missing" }
          : {
              state: "unknown",
              reason: "No accepted value",
              assertionIds: [],
            });
      if (fields[f.id]!.state === "value")
        validateValue(f, (fields[f.id] as any).value);
    }
    const item: EntityRecord = {
      id: row.id,
      conceptId: row.concept_id,
      name: row.name,
      revision: row.revision,
      fields,
    };
    if (query.include?.length) {
      check(
        query.include.length <= 10,
        "INVALID_INPUT",
        "Too many included relationships",
      );
      item.relationships = {};
      for (const rid of query.include) {
        const rel = d.relations.find(
          (x) => x.id === rid && x.source === concept.id,
        );
        check(rel, "INVALID_INPUT", "Relationship absent from contract");
        const rr = await c.query(
          "SELECT DISTINCT ON(a.target_entity_id) a.id AS \"assertionId\",a.target_entity_id AS id,a.verification,te.concept_id AS target_concept FROM ontave.assertions a JOIN ontave.entities te ON te.workspace_id=a.workspace_id AND te.id=a.target_entity_id WHERE a.entity_id=$1 AND a.relation_id=$2 AND a.kind='set' AND NOT EXISTS(SELECT 1 FROM ontave.assertions r WHERE r.target_assertion_id=a.id AND r.kind='retract') ORDER BY a.target_entity_id,a.created_at,a.id LIMIT 26",
          [row.id, rid],
        );
        check(rr.rows.every(link=>link.target_concept===rel.target),"VALIDATION_FAILED","Stored relationship endpoint violates the contract");
        item.relationships[rid] = {
          items: rr.rows.slice(0, 25).map(({id,verification,assertionId})=>({id,verification,assertionId})),
          hasMore: rr.rows.length > 25,
        };
      }
    }
    records.push(item);
  }
  validateContractRecords(records, d);
  const last = selected.at(-1);
  return {
    records,
    nextCursor:
      hasMore && last
        ? encodeCursor(
            {
              workspace: workspace,
              queryHash,
              id: last.id,
              rank: last.sort_rank ?? null,
              value: last.sort_value ?? null,
            },
            cursorSecret,
          )
        : null,
    contractHash: query.contractHash,
    ontologyHash: ontologyHash,
  };
}
