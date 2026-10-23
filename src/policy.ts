import { check, definitionSchema, hash } from "./core.js";
import { conceptReuseReasons } from "./definition-review.js";
import type { Definition, FieldDefinition } from "./types.js";

/** Host-selected authority, never inferred from source text or model confidence. */
export interface AutomationPolicy {
  id: string;
  sources: string[];
  namespace: string;
  maxNewConcepts: number;
  maxFieldsPerConcept: number;
  maxNewRelations: number;
  fieldTypes: FieldDefinition["type"][];
  relationshipTargets: string[];
  /** Allows creating base-model entities; existing records remain reference-only. */
  allowNewExistingEntities?: boolean;
}
export function additivePolicy(options: {
  sources: string[];
  relationshipTargets?: string[];
  allowNewExistingEntities?: boolean;
  id?: string;
}): AutomationPolicy {
  return automationPolicy({
    id: options.id ?? "bounded-additive-v1",
    sources: options.sources,
    namespace: "ext_",
    maxNewConcepts: 1,
    maxFieldsPerConcept: 8,
    maxNewRelations: 1,
    fieldTypes: ["text", "integer", "date"],
    relationshipTargets: options.relationshipTargets ?? [],
    allowNewExistingEntities: options.allowNewExistingEntities ?? false,
  });
}
export function automationPolicy(
  raw: AutomationPolicy,
): Readonly<AutomationPolicy> {
  check(
    raw &&
      Object.keys(raw).every((k) =>
        [
          "id",
          "sources",
          "namespace",
          "maxNewConcepts",
          "maxFieldsPerConcept",
          "maxNewRelations",
          "fieldTypes",
          "relationshipTargets",
          "allowNewExistingEntities",
        ].includes(k),
      ),
    "INVALID_INPUT",
    "Unknown automation policy option",
  );
  check(
    raw.allowNewExistingEntities === undefined ||
      typeof raw.allowNewExistingEntities === "boolean",
    "INVALID_INPUT",
    "Invalid base-identity policy",
  );
  check(
    raw && typeof raw.id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(raw.id),
    "INVALID_INPUT",
    "Invalid automation policy ID",
  );
  check(
    Array.isArray(raw.sources) &&
      raw.sources.length > 0 &&
      raw.sources.length <= 20 &&
      raw.sources.every(
        (s) => typeof s === "string" && s.length > 0 && s.length <= 200,
      ),
    "INVALID_INPUT",
    "Select bounded automatic-processing sources",
  );
  check(
    /^[a-z][a-z0-9_]{0,30}_$/.test(raw.namespace),
    "INVALID_INPUT",
    "Automation namespace must end in an underscore",
  );
  check(
    Number.isSafeInteger(raw.maxNewConcepts) &&
      raw.maxNewConcepts >= 1 &&
      raw.maxNewConcepts <= 5 &&
      Number.isSafeInteger(raw.maxFieldsPerConcept) &&
      raw.maxFieldsPerConcept >= 1 &&
      raw.maxFieldsPerConcept <= 20 &&
      Number.isSafeInteger(raw.maxNewRelations) &&
      raw.maxNewRelations >= 0 &&
      raw.maxNewRelations <= 10,
    "INVALID_INPUT",
    "Invalid automatic evolution bounds",
  );
  check(
    Array.isArray(raw.fieldTypes) &&
      raw.fieldTypes.length > 0 &&
      raw.fieldTypes.every((t) =>
        [
          "text",
          "integer",
          "decimal",
          "money",
          "boolean",
          "date",
          "timestamp",
          "enum",
        ].includes(t),
      ) &&
      Array.isArray(raw.relationshipTargets) &&
      raw.relationshipTargets.every(
        (t) => typeof t === "string" && /^[a-z][a-z0-9_]*$/.test(t),
      ),
    "INVALID_INPUT",
    "Invalid automatic evolution types or endpoints",
  );
  const copy = structuredClone(raw);
  for (const value of Object.values(copy))
    if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze(copy);
}
export function checkAutomaticPatch(
  parent: Definition,
  patch: Definition,
  policy: Readonly<AutomationPolicy>,
) {
  const result = definitionSchema.safeParse(patch);
  check(result.success, "VALIDATION_FAILED", "Invalid additive patch");
  const parsed = result.data,
    newIds = new Set(parsed.concepts.map((c) => c.id));
  check(
    parsed.concepts.length > 0 &&
      parsed.concepts.length <= policy.maxNewConcepts &&
      parent.concepts.length + parsed.concepts.length <= 25,
    "FORBIDDEN",
    "Automatic concept budget exceeded",
  );
  check(
    parsed.relations.length <= policy.maxNewRelations,
    "FORBIDDEN",
    "Automatic relation budget exceeded",
  );
  for (const c of parsed.concepts) {
    check(
      c.id.startsWith(policy.namespace) &&
        !parent.concepts.some((old) => old.id === c.id),
      "FORBIDDEN",
      "Automatic evolution only adds namespaced concepts",
    );
    check(
      c.fields.length > 0 &&
        c.fields.length <= policy.maxFieldsPerConcept &&
        c.fields.every((f) => policy.fieldTypes.includes(f.type)),
      "FORBIDDEN",
      "Automatic field profile exceeded",
    );
    check(
      parent.concepts.every((old) => conceptReuseReasons(c, old).length === 0),
      "FORBIDDEN",
      "Possible duplicate concept needs explicit handling",
    );
  }
  for (const r of parsed.relations)
    check(
      r.id.startsWith(policy.namespace) &&
        newIds.has(r.source) &&
        policy.relationshipTargets.includes(r.target) &&
        parent.concepts.some((c) => c.id === r.target) &&
        !parent.relations.some((old) => old.id === r.id),
      "FORBIDDEN",
      "Automatic relationships must point from new concepts to allowed existing concepts",
    );
  if (policy.relationshipTargets.length)
    check(
      parsed.concepts.every((c) =>
        parsed.relations.some((r) => r.source === c.id),
      ),
      "FORBIDDEN",
      "Each automatic extension needs an allowed parent relationship",
    );
  return {
    kind: "bounded-additive-policy",
    policyId: policy.id,
    policyHash: hash(policy),
    checks: [
      "new-namespaced-concepts",
      "bounded-types-and-size",
      "reuse-hints-clear",
      "restricted-relationship-endpoints",
      "existing-contract-compatibility",
    ],
    semanticAccuracyQualified: false,
  };
}
