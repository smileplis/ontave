import { z } from "zod";
import type { PoolClient } from "pg";
import type {
  Definition,
  EntityQuery,
  EntityRecord,
  EvaluationTask,
  Extraction,
  Json,
} from "./types.js";
import {
  check,
  compatible,
  definition,
  definitionSchema,
  hash,
  idSchema,
  json,
  normalizeValue,
  sameValue,
  sourceReference,
  sourceSpan,
  uuid,
} from "./core.js";
import { validateContractRecords } from "./codegen.js";
import { entityQuerySchema, readRecords } from "./read.js";

const ref = {
  quote: z.string().min(1),
  path: z.string().optional(),
  occurrence: z.number().int().min(0).optional(),
};
const endpoint = z
  .object({
    conceptId: idSchema,
    name: z.string().min(1).optional(),
    fields: z.record(idSchema, z.json()).optional(),
  })
  .strict()
  .refine((x) => !!x.name || !!Object.keys(x.fields ?? {}).length);
const verification = z.enum(["reported", "verified", "disputed", "unknown"]);
export const evaluationSuiteSchema = z
  .object({
    name: z.string().min(1).max(200),
    maxCalls: z.number().int().min(1).max(80),
    timeoutMs: z.number().int().min(1).max(600000),
    tasks: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
              kind: z.literal("extract"),
              evidenceId: uuid,
              expected: z
                .array(
                  z
                    .object({
                      conceptId: idSchema,
                      fieldId: idSchema,
                      value: z.json(),
                      verification: verification.optional(),
                      equivalentValues: z
                        .array(z.string().max(8192))
                        .min(1)
                        .max(20)
                        .optional(),
                      entityName: z.string().optional(),
                      quote: ref.quote.optional(),
                      path: ref.path,
                      occurrence: ref.occurrence,
                    })
                    .strict(),
                )
                .max(250),
              identities: z
                .array(
                  z
                    .object({
                      conceptId: idSchema,
                      name: z.string(),
                      existingId: uuid.nullable(),
                      identifiers: z
                        .array(
                          z
                            .object({
                              authority: z.string(),
                              kind: z.string(),
                              value: z.string(),
                            })
                            .strict(),
                        )
                        .max(20)
                        .optional(),
                    })
                    .strict(),
                )
                .max(100)
                .optional(),
              relationships: z
                .array(
                  z
                    .object({
                      relationId: idSchema,
                      source: endpoint,
                      target: endpoint,
                      ...ref,
                    })
                    .strict(),
                )
                .max(250)
                .optional(),
              observations: z
                .array(z.object({ concept: z.string(), ...ref }).strict())
                .max(250)
                .optional(),
              candidates: z
                .array(
                  z
                    .object({ id: uuid, name: z.string(), conceptId: idSchema })
                    .strict(),
                )
                .max(10)
                .optional(),
            })
            .strict(),
          z
            .object({
              id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
              kind: z.literal("contract"),
              contractId: uuid,
            })
            .strict(),
          z
            .object({
              id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
              kind: z.literal("read"),
              definition: definitionSchema,
              records: z.array(z.json()).max(100),
              query: entityQuerySchema.omit({
                contractId: true,
                contractHash: true,
                cursor: true,
              }),
              expected: z.union([
                z
                  .object({
                    records: z.array(z.json()).max(100),
                    hasMore: z.boolean(),
                  })
                  .strict(),
                z
                  .object({
                    error: z.enum(["INVALID_INPUT", "CONTRACT_NOT_AVAILABLE"]),
                  })
                  .strict(),
              ]),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(40),
  })
  .strict();

export function counts<T>(
  gold: T[],
  proposed: T[],
  matches: (g: T, p: T) => boolean,
) {
  const used = new Set<number>();
  for (const g of gold) {
    const i = proposed.findIndex((p, i) => !used.has(i) && matches(g, p));
    if (i >= 0) used.add(i);
  }
  const correct = used.size,
    falsePositive = proposed.length - correct,
    missed = gold.length - correct;
  return {
    correct,
    proposed: proposed.length,
    expected: gold.length,
    falsePositive,
    missed,
    precision: proposed.length
      ? correct / proposed.length
      : gold.length
        ? 0
        : 1,
    recall: gold.length ? correct / gold.length : 1,
    passed: !falsePositive && !missed,
  };
}
function referenceMatches(
  g: { quote?: string; path?: string; occurrence?: number },
  p: { quote: string; path?: string; occurrence?: number },
  text?: string,
) {
  if (text !== undefined && g.quote !== undefined) {
    try {
      const gold = sourceSpan(text, g.quote, g.occurrence),
        proposed = sourceSpan(text, p.quote, p.occurrence);
      return (
        (g.path === undefined || g.path === p.path) &&
        gold.startByte >= proposed.startByte &&
        gold.endByte <= proposed.endByte
      );
    } catch {
      return false;
    }
  }
  return (
    (g.quote === undefined || g.quote === p.quote) &&
    (g.path === undefined || g.path === p.path) &&
    (g.occurrence === undefined || g.occurrence === (p.occurrence ?? 0))
  );
}
function equivalentFieldValue(
  field: import("./types.js").FieldDefinition,
  g: any,
  proposed: Json,
) {
  return (
    sameValue(normalizeValue(field, g.value), proposed) ||
    (field.type === "text" &&
      (g.equivalentValues ?? []).some((v: string) =>
        sameValue(normalizeValue(field, v), proposed),
      ))
  );
}
function endpointMatches(
  g: any,
  p: any,
  task: Extract<EvaluationTask, { kind: "extract" }>,
  d: Definition,
) {
  return (
    (g.name === undefined || g.name === p.name) &&
    Object.entries(g.fields ?? {}).every(([key, value]) => {
      if (!p.fields[key]) return false;
      const field = d.concepts
        .find((c) => c.id === g.conceptId)
        ?.fields.find((f) => f.id === key);
      if (!field) return false;
      const expected = task.expected.find(
        (e) =>
          e.conceptId === g.conceptId &&
          e.fieldId === key &&
          sameValue(e.value, value as Json),
      );
      return equivalentFieldValue(
        field,
        expected ?? { value },
        p.fields[key].value,
      );
    })
  );
}
/** One-to-one matches: duplicates and wrong entity assignments cannot inflate precision. */
export function scoreExtraction(
  e: Extraction,
  task: Extract<EvaluationTask, { kind: "extract" }>,
  d: Definition,
  text?: string,
) {
  const proposed = e.entities.flatMap((m) =>
    Object.entries(m.fields).map(([fieldId, f]) => ({
      conceptId: m.conceptId,
      entityName: m.name,
      fieldId,
      ...f,
    })),
  );
  const fields = counts(task.expected as any[], proposed as any[], (g, p) => {
    const f = d.concepts
      .find((c) => c.id === g.conceptId)
      ?.fields.find((f) => f.id === g.fieldId);
    return (
      !!f &&
      g.conceptId === p.conceptId &&
      g.fieldId === p.fieldId &&
      (g.entityName === undefined || g.entityName === p.entityName) &&
      equivalentFieldValue(f, g, p.value) &&
      (g.verification ?? "reported") === (p.verification ?? "reported") &&
      referenceMatches(g, p, text)
    );
  });
  const identities =
    task.identities === undefined
      ? null
      : counts(
          task.identities as any[],
          e.entities as any[],
          (g, p) =>
            g.conceptId === p.conceptId &&
            g.name === p.name &&
            g.existingId === (p.existingId ?? null) &&
            (g.identifiers === undefined ||
              counts(
                g.identifiers,
                p.identifiers ?? [],
                (a: any, b: any) =>
                  a.authority === b.authority &&
                  a.kind === b.kind &&
                  a.value === b.value,
              ).passed),
        );
  const relations = e.relationships.map((r) => ({
    ...r,
    source: e.entities.find((m) => m.mentionId === r.source)!,
    target: e.entities.find((m) => m.mentionId === r.target)!,
  }));
  const relationships =
    task.relationships === undefined
      ? null
      : counts(
          task.relationships as any[],
          relations as any[],
          (g, p) =>
            g.relationId === p.relationId &&
            g.source.conceptId === p.source.conceptId &&
            endpointMatches(g.source, p.source, task, d) &&
            g.target.conceptId === p.target.conceptId &&
            endpointMatches(g.target, p.target, task, d) &&
            referenceMatches(g, p),
        );
  const observations =
    task.observations === undefined
      ? null
      : counts(
          task.observations,
          e.observations,
          (g, p) => g.concept === p.concept && referenceMatches(g, p),
        );
  return {
    fields,
    identities,
    relationships,
    observations,
    passed: [fields, identities, relationships, observations].every(
      (s) => s === null || s.passed,
    ),
  };
}
export function validateReadFixture(
  task: Extract<EvaluationTask, { kind: "read" }>,
) {
  const d = definition(task.definition);
  validateContractRecords(task.records, d);
  check(
    new Set(task.records.map((r) => r.id)).size === task.records.length,
    "INVALID_INPUT",
    "Duplicate fixture entity ID",
  );
  for (const r of task.records)
    for (const [rid, links] of Object.entries(r.relationships ?? {})) {
      const rel = d.relations.find(
        (x) => x.id === rid && x.source === r.conceptId,
      );
      check(
        rel && !links.hasMore,
        "INVALID_INPUT",
        "Read fixture must contain complete declared links",
      );
      for (const l of links.items)
        check(
          task.records.some((t) => t.id === l.id && t.conceptId === rel.target),
          "INVALID_INPUT",
          "Read fixture has a missing or mistyped endpoint",
        );
    }
  if ("records" in task.expected)
    validateContractRecords(task.expected.records, d);
}
/** Read-only CTEs hold the same frozen fixture on both sides; no workspace tables are written. */
export async function evaluateRead(
  c: Pick<PoolClient, "query">,
  task: Extract<EvaluationTask, { kind: "read" }>,
  side: Definition,
  workspace: string,
) {
  if (!compatible(task.definition, side))
    return { error: "CONTRACT_NOT_AVAILABLE" };
  const entities: Json[] = [],
    projections: Json[] = [],
    assertions: Json[] = [];
  for (const r of task.records) {
    entities.push({
      workspace_id: workspace,
      id: r.id,
      concept_id: r.conceptId,
      name: r.name,
      revision: r.revision,
    });
    const concept = task.definition.concepts.find((x) => x.id === r.conceptId)!;
    for (const f of concept.fields) {
      const result = r.fields[f.id]!;
      const value = result.state === "value" ? result.value : null;
      projections.push({
        workspace_id: workspace,
        entity_id: r.id,
        field_id: f.id,
        result: result as unknown as Json,
        state_rank:
          result.state === "value"
            ? value === null
              ? 2
              : 1
            : { missing: 3, unknown: 4, conflict: 5 }[result.state],
        val_text:
          value !== null && ["text", "enum"].includes(f.type)
            ? String(value)
            : null,
        val_num:
          value !== null && ["integer", "decimal"].includes(f.type)
            ? String(value)
            : null,
        val_bool: value !== null && f.type === "boolean" ? value : null,
        val_ts:
          value !== null && ["date", "timestamp"].includes(f.type)
            ? String(value)
            : null,
      });
    }
    for (const [relation_id, links] of Object.entries(r.relationships ?? {}))
      for (const l of links.items)
        assertions.push({
          workspace_id: workspace,
          entity_id: r.id,
          relation_id,
          id: l.assertionId,
          target_entity_id: l.id,
          verification: l.verification,
          kind: "set",
          created_at: "2000-01-01T00:00:00Z",
          target_assertion_id: null,
        });
  }
  const fixture = json({ entities, projections, assertions });
  const client = {
    query: async (sql: string, values: unknown[] = []) => {
      if (
        sql ===
        "SELECT set_config('enable_nestloop','off',true),set_config('jit','off',true)"
      )
        return c.query(sql);
      check(
        /^SELECT\b/.test(sql),
        "INVALID_INPUT",
        "Evaluator only permits fixed reads",
      );
      const n = values.length + 1;
      const prefix = `WITH fixture_entities AS (SELECT * FROM jsonb_to_recordset($${n}::jsonb->'entities') AS x(workspace_id uuid,id uuid,concept_id text,name text,revision integer)),fixture_projections AS (SELECT * FROM jsonb_to_recordset($${n}::jsonb->'projections') AS x(workspace_id uuid,entity_id uuid,field_id text,result jsonb,state_rank integer,val_text text,val_num numeric,val_bool boolean,val_ts timestamptz)),fixture_assertions AS (SELECT * FROM jsonb_to_recordset($${n}::jsonb->'assertions') AS x(workspace_id uuid,entity_id uuid,relation_id text,id uuid,target_entity_id uuid,verification text,kind text,created_at timestamptz,target_assertion_id uuid)) `;
      return c.query(
        prefix +
          sql
            .replaceAll("ontave.entities", "fixture_entities")
            .replaceAll("ontave.projections", "fixture_projections")
            .replaceAll("ontave.assertions", "fixture_assertions"),
        [...values, fixture],
      );
    },
  } as Pick<PoolClient, "query">;
  try {
    const result = await readRecords(
      client,
      {
        ...task.query,
        contractId: "00000000-0000-4000-8000-000000000001",
        contractHash: hash(task.definition),
      } as EntityQuery,
      task.definition,
      workspace,
      "isolated-fixture-cursor",
      hash(side),
    );
    return { records: result.records, hasMore: result.nextCursor !== null };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "INVALID_INPUT")
      return { error: "INVALID_INPUT" };
    throw e;
  }
}
