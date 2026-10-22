import { check } from "../core.js";
import type { Definition, FieldDefinition } from "../types.js";
function valueSchema(f: FieldDefinition): Record<string, unknown> {
  let schema: Record<string, unknown>;
  switch (f.type) {
    case "boolean":
      schema = { type: "boolean" };
      break;
    case "integer":
      schema = {
        type: "integer",
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      };
      break;
    case "money":
      schema = {
        type: "object",
        properties: {
          amount: { type: "string" },
          currency: { type: "string" },
        },
        required: ["amount", "currency"],
        additionalProperties: false,
      };
      break;
    case "date":
      schema = {
        type: "string",
        format: "date",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
      };
      break;
    case "timestamp":
      schema = { type: "string", format: "date-time" };
      break;
    case "decimal":
      schema = {
        type: "string",
        pattern: "^-?(0|[1-9][0-9]{0,27})(\\.[0-9]{1,10})?$",
      };
      break;
    case "enum":
      schema = { type: "string", enum: f.values };
      break;
    default:
      schema = { type: "string" };
  }
  return f.nullable ? { anyOf: [schema, { type: "null" }] } : schema;
}
export function responseSchema(
  d: Definition,
  kind: "text" | "json" = "text",
  verifiedFields: string[] = [],
  options: {
    text?: string;
    candidates?: { id: string; conceptId: string }[];
    identifierRules?: { authority: string; kind: string }[];
  } = {},
): Record<string, unknown> {
  check(
    d.concepts.length <= 25,
    "BUDGET_EXHAUSTED",
    "Model task exceeds the 25-concept limit; no definitions were silently omitted",
  );
  // Short text receipts have one immutable evidence anchor. The provider chooses
  // facts, not quotation text; schema constraints prevent ellipses/paraphrasing.
  const anchored =
    kind === "text" &&
    typeof options.text === "string" &&
    Buffer.byteLength(options.text) > 0 &&
    Buffer.byteLength(options.text) <= 1024;
  const quote = anchored
    ? { type: "string", enum: [options.text] }
    : { type: "string" };
  const path = kind === "json" ? { path: { type: "string" } } : {};
  const pathRequired = kind === "json" ? ["path"] : [];
  const reference = {
    quote,
    ...path,
    occurrence: anchored
      ? { type: "integer", enum: [0] }
      : { type: "integer", minimum: 0 },
  };
  const rules = options.identifierRules ?? [];
  const identifiers = rules.length
    ? {
        identifiers: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              authority: {
                type: "string",
                enum: [...new Set(rules.map((r) => r.authority))],
              },
              kind: {
                type: "string",
                enum: [...new Set(rules.map((r) => r.kind))],
              },
              value: { type: "string" },
              ...reference,
            },
            required: ["authority", "kind", "value", "quote", ...pathRequired],
            additionalProperties: false,
          },
        },
      }
    : {};
  const variants = d.concepts.map((c) => {
    const candidates = (options.candidates ?? []).filter(
      (x) => x.conceptId === c.id,
    );
    return {
      type: "object",
      properties: {
        mentionId: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
        conceptId: { type: "string", enum: [c.id] },
        name: { type: "string" },
        ...(candidates.length
          ? {
              existingId: { type: "string", enum: candidates.map((x) => x.id) },
            }
          : {}),
        ...identifiers,
        fields: {
          type: "object",
          properties: Object.fromEntries(
            c.fields.map((f) => [
              f.id,
              {
                type: "object",
                properties: {
                  value: valueSchema(f),
                  ...reference,
                  verification: {
                    type: "string",
                    enum: verifiedFields.includes(c.id + "." + f.id)
                      ? ["reported", "verified", "unknown", "disputed"]
                      : ["reported", "unknown", "disputed"],
                  },
                },
                required: ["value", "quote", ...pathRequired],
                additionalProperties: false,
              },
            ]),
          ),
          required: candidates.length
            ? []
            : c.fields.filter((f) => !f.optional).map((f) => f.id),
          additionalProperties: false,
        },
      },
      required: ["mentionId", "conceptId", "name", "fields"],
      additionalProperties: false,
    };
  });
  return {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: variants.length ? { anyOf: variants } : { type: "object" },
        ...(variants.length ? {} : { maxItems: 0 }),
      },
      relationships: {
        type: "array",
        ...(d.relations.length ? {} : { maxItems: 0 }),
        items: {
          type: "object",
          properties: {
            source: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            target: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            relationId: d.relations.length
              ? { type: "string", enum: d.relations.map((r) => r.id) }
              : { type: "string" },
            ...reference,
          },
          required: [
            "source",
            "target",
            "relationId",
            "quote",
            ...pathRequired,
          ],
          additionalProperties: false,
        },
      },
      observations: {
        type: "array",
        items: {
          type: "object",
          properties: { concept: { type: "string" }, ...reference },
          required: ["concept", "quote", ...pathRequired],
          additionalProperties: false,
        },
      },
    },
    required: ["entities", "relationships", "observations"],
    additionalProperties: false,
  };
}
