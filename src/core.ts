import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";
import { Decimal } from "decimal.js";
import { z } from "zod";
import type {
  Definition,
  Extraction,
  FieldDefinition,
  Json,
  Span,
  EvidenceRef,
} from "./types.js";

export class OntaveError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: {
      model?: string;
      usage?: Json;
      outcome?: string;
      evaluationId?: string;
    },
  ) {
    super(message);
    this.name = "OntaveError";
  }
}
export function check(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new OntaveError(code, message);
}
/** Bound a non-cooperating adapter without retaining abort listeners after each task. */
export async function abortable<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
  code = "MODEL_UNAVAILABLE",
): Promise<T> {
  check(!signal.aborted, code, "Operation was aborted before it started");
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        new OntaveError(
          code,
          "Operation aborted or deadline exceeded; provider usage may be unknown",
          code === "MODEL_UNAVAILABLE",
        ),
      );
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
export function json(value: unknown): string {
  const ancestors = new Set<object>();
  function visit(v: unknown): void {
    if (typeof v === "string") {
      check(
        !v.includes("\0"),
        "INVALID_INPUT",
        "NUL characters are unsupported by PostgreSQL text and JSONB",
      );
      check(
        !/[\uD800-\uDFFF]/u.test(v),
        "INVALID_INPUT",
        "Unpaired Unicode surrogates are unsupported",
      );
      return;
    }
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") {
      check(Number.isFinite(v), "INVALID_INPUT", "JSON numbers must be finite");
      return;
    }
    check(
      typeof v === "object" && v !== null,
      "INVALID_INPUT",
      "Unsupported JSON value",
    );
    check(!ancestors.has(v), "INVALID_INPUT", "Cyclic JSON");
    check(
      Array.isArray(v) ||
        Object.getPrototypeOf(v) === Object.prototype ||
        Object.getPrototypeOf(v) === null,
      "INVALID_INPUT",
      "JSON must use plain objects",
    );
    ancestors.add(v);
    if (Array.isArray(v)) {
      check(
        Reflect.ownKeys(v).every(
          (k) =>
            k === "length" ||
            (typeof k === "string" &&
              /^(0|[1-9]\d*)$/.test(k) &&
              Number(k) < v.length),
        ),
        "INVALID_INPUT",
        "Extra JSON array properties are unsupported",
      );
      for (let i = 0; i < v.length; i++) {
        check(i in v, "INVALID_INPUT", "Sparse JSON arrays are unsupported");
        const entry = Object.getOwnPropertyDescriptor(v, String(i))!;
        check(
          "value" in entry,
          "INVALID_INPUT",
          "JSON array accessors are unsupported",
        );
        visit(entry.value);
      }
    } else
      for (const key of Reflect.ownKeys(v)) {
        check(
          typeof key === "string",
          "INVALID_INPUT",
          "Symbol keys are unsupported",
        );
        check(
          !key.includes("\0"),
          "INVALID_INPUT",
          "NUL characters in JSON keys are unsupported",
        );
        check(
          !/[\uD800-\uDFFF]/u.test(key),
          "INVALID_INPUT",
          "Unpaired Unicode in keys is unsupported",
        );
        const d = Object.getOwnPropertyDescriptor(v, key)!;
        check(
          d.enumerable,
          "INVALID_INPUT",
          "Hidden JSON properties are unsupported",
        );
        check("value" in d, "INVALID_INPUT", "JSON accessors are unsupported");
        visit(d.value);
      }
    ancestors.delete(v);
  }
  visit(value);
  const out = canonicalize(value);
  check(out !== undefined, "INVALID_INPUT", "Invalid JSON");
  return out;
}
export function hash(value: unknown): string {
  return createHash("sha256").update(json(value)).digest("hex");
}
export const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine(
    (id) => id !== "constructor" && id !== "prototype",
    "Reserved object property name",
  );
export const uuid = z.uuid();
export function parseUUID(value: unknown): string {
  const r = uuid.safeParse(value);
  check(r.success, "INVALID_INPUT", "Expected a UUID");
  return r.data;
}
const ref = {
  path: z
    .string()
    .max(2048)
    .regex(/^(?:\/(?:[^~]|~[01])*)*$/)
    .optional(),
  quote: z.string().min(1),
  occurrence: z.number().int().nonnegative().optional(),
};
const verification = z.enum(["reported", "verified", "disputed", "unknown"]);
export const extractionSchema = z
  .object({
    entities: z
      .array(
        z
          .object({
            mentionId: idSchema,
            conceptId: idSchema,
            name: z.string().min(1).max(500),
            existingId: uuid.optional(),
            fields: z.record(
              idSchema,
              z
                .object({
                  value: z.json(),
                  ...ref,
                  verification: verification.optional(),
                })
                .strict(),
            ),
            identifiers: z
              .array(
                z
                  .object({
                    authority: idSchema,
                    kind: idSchema,
                    value: z.string().min(1).max(500),
                    ...ref,
                  })
                  .strict(),
              )
              .optional(),
          })
          .strict(),
      )
      .max(100),
    relationships: z
      .array(
        z
          .object({
            source: idSchema,
            target: idSchema,
            relationId: idSchema,
            ...ref,
          })
          .strict(),
      )
      .max(100),
    observations: z
      .array(
        z
          .object({
            concept: z.string().min(1).max(200),
            ...ref,
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
const fieldSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    type: z.enum([
      "text",
      "integer",
      "decimal",
      "money",
      "boolean",
      "date",
      "timestamp",
      "enum",
    ]),
    optional: z.boolean().optional(),
    nullable: z.boolean().optional(),
    values: z.array(z.string()).min(1).max(100).optional(),
  })
  .strict();
export const definitionSchema = z
  .object({
    concepts: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().min(1).max(200),
            aliases: z
              .array(z.string().trim().min(1).max(200))
              .max(20)
              .optional(),
            description: z.string().min(1).max(2000),
            fields: z.array(fieldSchema).max(100),
          })
          .strict(),
      )
      .max(100),
    relations: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().min(1).max(200),
            source: idSchema,
            target: idSchema,
            max: z.literal(1).optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export function definition(value: unknown): Definition {
  const result = definitionSchema.safeParse(value);
  check(
    result.success,
    "VALIDATION_FAILED",
    "Invalid closed ontology definition",
  );
  const d = result.data;
  const seen = new Set<string>();
  for (const c of d.concepts) {
    check(!seen.has(c.id), "VALIDATION_FAILED", "Duplicate concept ID");
    seen.add(c.id);
    if (c.aliases) {
      const names = c.aliases.map((x) =>
        x.normalize("NFKC").toLocaleLowerCase("en-US"),
      );
      check(
        new Set(names).size === names.length,
        "VALIDATION_FAILED",
        "Duplicate concept alias",
      );
      c.aliases.sort((a, b) => a.localeCompare(b, "en"));
    }
    const fields = new Set<string>();
    for (const f of c.fields) {
      check(!fields.has(f.id), "VALIDATION_FAILED", "Duplicate field ID");
      fields.add(f.id);
      check(
        f.type !== "enum" || !!f.values?.length,
        "VALIDATION_FAILED",
        "Enum requires values",
      );
    }
  }
  const relations = new Set<string>();
  for (const r of d.relations) {
    check(
      !relations.has(r.id) && seen.has(r.source) && seen.has(r.target),
      "VALIDATION_FAILED",
      "Invalid relationship definition",
    );
    relations.add(r.id);
  }
  for (const c of d.concepts)
    c.fields.sort((a, b) => a.id.localeCompare(b.id, "en"));
  d.concepts.sort((a, b) => a.id.localeCompare(b.id, "en"));
  d.relations.sort((a, b) => a.id.localeCompare(b.id, "en"));
  return d;
}
export function extend(parent: Definition, raw: unknown): Definition {
  const result = definitionSchema.safeParse(raw);
  check(result.success, "VALIDATION_FAILED", "Invalid additive ontology patch");
  const patch = result.data;
  const out = structuredClone(parent);
  for (const c of patch.concepts) {
    const old = out.concepts.find((x) => x.id === c.id);
    if (!old) {
      check(
        !out.concepts.some(
          (x) => x.name.toLowerCase() === c.name.toLowerCase(),
        ),
        "VALIDATION_FAILED",
        "Concept name collision",
      );
      out.concepts.push(c);
      continue;
    }
    check(
      old.name === c.name &&
        old.description === c.description &&
        (c.aliases === undefined ||
          hash([...(old.aliases ?? [])].sort()) ===
            hash([...c.aliases].sort())),
      "UNSUPPORTED_EVOLUTION",
      "Concept meaning/name changes are unsupported",
    );
    for (const f of c.fields) {
      const existing = old.fields.find((x) => x.id === f.id);
      if (existing)
        check(
          hash(existing) === hash(f),
          "UNSUPPORTED_EVOLUTION",
          "Existing field changes are unsupported",
        );
      else {
        check(
          f.optional === true,
          "UNSUPPORTED_EVOLUTION",
          "New fields on existing concepts must be optional",
        );
        old.fields.push(f);
      }
    }
  }
  for (const r of patch.relations) {
    const old = out.relations.find((x) => x.id === r.id);
    if (old)
      check(
        hash(old) === hash(r),
        "UNSUPPORTED_EVOLUTION",
        "Relationship changes are unsupported",
      );
    else out.relations.push(r);
  }
  return definition(out);
}
export function compatible(contract: Definition, current: Definition): boolean {
  return (
    contract.concepts.every((c) => {
      const now = current.concepts.find((x) => x.id === c.id);
      return (
        now?.name === c.name &&
        now.description === c.description &&
        (c.aliases ?? []).every((alias) => now.aliases?.includes(alias)) &&
        c.fields.every((f) => now.fields.some((n) => hash(n) === hash(f)))
      );
    }) &&
    contract.relations.every((r) =>
      current.relations.some((n) => hash(n) === hash(r)),
    )
  );
}
export function sourceSpan(
  text: string,
  quote: string,
  occurrence?: number,
): Span {
  check(quote.length > 0, "VALIDATION_FAILED", "Empty evidence quote");
  const positions: number[] = [];
  let at = text.indexOf(quote);
  while (at !== -1) {
    positions.push(at);
    at = text.indexOf(quote, at + 1);
  }
  check(positions.length > 0, "VALIDATION_FAILED", "Evidence quote not found");
  check(
    occurrence !== undefined || positions.length === 1,
    "VALIDATION_FAILED",
    "Ambiguous quote requires occurrence index",
  );
  const index = positions[occurrence ?? 0];
  check(index !== undefined, "VALIDATION_FAILED", "Invalid quote occurrence");
  const startByte = Buffer.byteLength(text.slice(0, index), "utf8");
  return { startByte, endByte: startByte + Buffer.byteLength(quote, "utf8") };
}
export function validateValue(field: FieldDefinition, v: Json): void {
  if (v === null) {
    check(
      field.nullable,
      "VALIDATION_FAILED",
      `Field ${field.id} is not nullable`,
    );
    return;
  }
  let ok = false;
  switch (field.type) {
    case "text":
      ok = typeof v === "string" && Buffer.byteLength(v) <= 8192;
      break;
    case "boolean":
      ok = typeof v === "boolean";
      break;
    case "integer":
      ok = typeof v === "number" && Number.isSafeInteger(v);
      break;
    case "decimal":
      ok =
        typeof v === "string" && /^-?(0|[1-9]\d{0,27})(\.\d{1,10})?$/.test(v);
      break;
    case "money":
      ok =
        typeof v === "object" &&
        !Array.isArray(v) &&
        typeof v.amount === "string" &&
        /^-?(0|[1-9]\d{0,27})(\.\d{1,10})?$/.test(v.amount) &&
        typeof v.currency === "string" &&
        /^[A-Z]{3}$/.test(v.currency) &&
        Object.keys(v).length === 2;
      break;
    case "date":
      ok =
        typeof v === "string" &&
        /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v;
      break;
    case "timestamp":
      ok =
        typeof v === "string" &&
        /^(?!0000)\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(
          v,
        ) &&
        Number.isFinite(Date.parse(v)) &&
        Number.isFinite(Date.parse(v.slice(0, 10))) &&
        new Date(v.slice(0, 10)).toISOString().slice(0, 10) === v.slice(0, 10);
      break;
    case "enum":
      ok = typeof v === "string" && !!field.values?.includes(v);
      break;
  }
  check(ok, "VALIDATION_FAILED", `Invalid ${field.type} value for ${field.id}`);
}
/** A JSON Pointer must name the same source value and byte region as the quote. */
export function sourceReference(
  text: string,
  ref: EvidenceRef,
  kind: "text" | "json" = "text",
  expected?: { field: FieldDefinition; value: Json },
): Span {
  const span = sourceSpan(text, ref.quote, ref.occurrence);
  if (kind === "text") {
    check(
      ref.path === undefined,
      "VALIDATION_FAILED",
      "JSON paths require typed JSON evidence",
    );
    return span;
  }
  check(
    typeof ref.path === "string",
    "VALIDATION_FAILED",
    "JSON evidence requires an RFC 6901 path",
  );
  let parsed: Json;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OntaveError("VALIDATION_FAILED", "Invalid JSON evidence");
  }
  check(
    json(parsed) === text,
    "VALIDATION_FAILED",
    "JSON evidence must use the canonical encoding",
  );
  let cursor = 0;
  const locations = new Map<
    string,
    { start: number; end: number; value: Json }
  >();
  const write = (v: string) => {
    cursor += Buffer.byteLength(v, "utf8");
  };
  const escape = (v: string) => v.replaceAll("~", "~0").replaceAll("/", "~1");
  const walk = (value: Json, path: string) => {
    const start = cursor;
    if (Array.isArray(value)) {
      write("[");
      value.forEach((v, i) => {
        if (i) write(",");
        walk(v, path + "/" + i);
      });
      write("]");
    } else if (value && typeof value === "object") {
      write("{");
      Object.keys(value)
        .sort()
        .forEach((k, i) => {
          if (i) write(",");
          write(JSON.stringify(k) + ":");
          walk(value[k]!, path + "/" + escape(k));
        });
      write("}");
    } else write(JSON.stringify(value));
    locations.set(path, { start, end: cursor, value });
  };
  walk(parsed, "");
  const point = locations.get(ref.path);
  check(
    point && span.startByte >= point.start && span.endByte <= point.end,
    "VALIDATION_FAILED",
    "JSON path is absent or quote lies outside its value",
  );
  if (expected)
    check(
      hash(normalizeValue(expected.field, point.value)) ===
        hash(expected.value),
      "VALIDATION_FAILED",
      "Assertion does not match the referenced JSON value",
    );
  return { ...span, path: ref.path };
}
export function normalizeValue(field: FieldDefinition, value: Json): Json {
  validateValue(field, value);
  if (value === null) return null;
  if (field.type === "decimal") return new Decimal(value as string).toFixed();
  if (field.type === "money") {
    const v = value as { amount: string; currency: string };
    return { amount: new Decimal(v.amount).toFixed(), currency: v.currency };
  }
  return value;
}
export function validateExtraction(
  raw: unknown,
  text: string,
  d: Definition,
  kind: "text" | "json" = "text",
): Extraction {
  let e: Extraction;
  try {
    e = extractionSchema.parse(raw) as Extraction;
  } catch {
    throw new OntaveError(
      "INVALID_MODEL_OUTPUT",
      "Extraction does not match the supported envelope",
    );
  }
  const ids = new Set<string>();
  for (const entity of e.entities) {
    check(
      !ids.has(entity.mentionId),
      "VALIDATION_FAILED",
      "Duplicate mention ID",
    );
    ids.add(entity.mentionId);
    const c = d.concepts.find((x) => x.id === entity.conceptId);
    check(c, "VALIDATION_FAILED", "Unknown entity concept");
    for (const [key, f] of Object.entries(entity.fields)) {
      const def = c.fields.find((x) => x.id === key);
      check(def, "VALIDATION_FAILED", "Unknown field");
      f.value = normalizeValue(def, f.value);
      sourceReference(text, f, kind, { field: def, value: f.value });
    }
    for (const i of entity.identifiers ?? [])
      sourceReference(text, i, kind, {
        field: {
          id: "identifier",
          name: "Identifier",
          description: "Identifier source",
          type: "text",
        },
        value: i.value,
      });
  }
  for (const r of e.relationships) {
    const def = d.relations.find((x) => x.id === r.relationId);
    const s = e.entities.find((x) => x.mentionId === r.source),
      t = e.entities.find((x) => x.mentionId === r.target);
    check(
      def && s?.conceptId === def.source && t?.conceptId === def.target,
      "VALIDATION_FAILED",
      "Invalid relationship endpoints",
    );
    sourceReference(text, r, kind);
  }
  for (const o of e.observations) sourceReference(text, o, kind);
  return e;
}
export function sameValue(a: Json, b: Json): boolean {
  return hash(a) === hash(b);
}
export function compareDecimal(a: string, b: string): number {
  return new Decimal(a).comparedTo(b);
}
export function encodeCursor(value: unknown, secret: string): string {
  const payload = Buffer.from(json(value)).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", secret).update(payload).digest("base64url")
  );
}
export function decodeCursor(value: string, secret: string): unknown {
  const [p, s, ...rest] = value.split(".");
  check(p && s && rest.length === 0, "INVALID_INPUT", "Malformed cursor");
  const expected = createHmac("sha256", secret).update(p).digest();
  const actual = Buffer.from(s, "base64url");
  check(
    actual.length === expected.length && timingSafeEqual(actual, expected),
    "INVALID_INPUT",
    "Invalid cursor",
  );
  try {
    return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    throw new OntaveError("INVALID_INPUT", "Malformed cursor payload");
  }
}
export const starter: Definition = definition({
  concepts: [
    {
      id: "person",
      name: "Person",
      description: "An individual person",
      fields: [
        { id: "name", name: "Name", description: "Display name", type: "text" },
        {
          id: "email",
          name: "Email",
          description: "Reported email address",
          type: "text",
          optional: true,
        },
      ],
    },
    {
      id: "organization",
      name: "Organization",
      description: "An organization",
      fields: [
        { id: "name", name: "Name", description: "Display name", type: "text" },
      ],
    },
  ],
  relations: [],
});
