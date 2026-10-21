import { check } from "../core.js";
import type { Definition, FieldDefinition } from "../types.js";
function valueSchema(f: FieldDefinition): Record<string, unknown> {
  let schema: Record<string, unknown>;
  switch (f.type) {
    case "boolean":
      schema = { type: "boolean" };
      break;
    case "integer":
      schema = { type: "integer" };
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
): Record<string, unknown> {
  check(
    d.concepts.length <= 25,
    "BUDGET_EXHAUSTED",
    "Model task exceeds the 25-concept limit; no definitions were silently omitted",
  );
  const path = kind === "json" ? { path: { type: "string" } } : {};
  const pathRequired = kind === "json" ? ["path"] : [];
  const variants = d.concepts.map((c) => ({
    type: "object",
    properties: {
      mentionId: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
      conceptId: { type: "string", enum: [c.id] },
      name: { type: "string" },
      fields: {
        type: "object",
        properties: Object.fromEntries(
          c.fields.map((f) => [
            f.id,
            {
              type: "object",
              properties: {
                value: valueSchema(f),
                quote: { type: "string" },
                ...path,
                occurrence: { type: "integer", minimum: 0 },
                verification: {
                  type: "string",
                  enum: ["reported", "unknown", "disputed"],
                },
              },
              required: ["value", "quote", ...pathRequired],
              additionalProperties: false,
            },
          ]),
        ),
        additionalProperties: false,
      },
    },
    required: ["mentionId", "conceptId", "name", "fields"],
    additionalProperties: false,
  }));
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
        items: {
          type: "object",
          properties: {
            source: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            target: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            relationId: { type: "string" },
            quote: { type: "string" },
            ...path,
            occurrence: { type: "integer", minimum: 0 },
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
          properties: {
            concept: { type: "string" },
            quote: { type: "string" },
            ...path,
          },
          required: ["concept", "quote", ...pathRequired],
          additionalProperties: false,
        },
      },
    },
    required: ["entities", "relationships", "observations"],
    additionalProperties: false,
  };
}
