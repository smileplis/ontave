import { mkdir, writeFile, lstat, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { Definition, EntityRecord, FieldDefinition } from "./types.js";
import { check, definition, hash, json, validateValue, uuid } from "./core.js";

export function validateContractRecords(
  raw: unknown,
  d: Definition,
): EntityRecord[] {
  check(
    Array.isArray(raw),
    "VALIDATION_FAILED",
    "Expected an array of records",
  );
  for (const record of raw) {
    check(
      record &&
        typeof record === "object" &&
        typeof record.id === "string" &&
        Number.isSafeInteger(record.revision) &&
        record.revision > 0 &&
        typeof record.name === "string",
      "VALIDATION_FAILED",
      "Invalid entity envelope",
    );
    check(
      uuid.safeParse(record.id).success,
      "VALIDATION_FAILED",
      "Invalid entity ID",
    );
    const c = d.concepts.find((c) => c.id === record.conceptId);
    check(c, "VALIDATION_FAILED", "Record concept not in contract");
    check(
      record.fields && typeof record.fields === "object",
      "VALIDATION_FAILED",
      "Missing fields",
    );
    for (const f of c.fields) {
      const r = record.fields[f.id];
      check(
        r && typeof r === "object",
        "VALIDATION_FAILED",
        "Missing FieldResult envelope",
      );
      const allowedKeys: Record<string, string[]> = {
        value: ["state", "value", "verification", "assertionIds"],
        missing: ["state"],
        unknown: ["state", "reason", "assertionIds"],
        conflict: ["state", "candidates"],
      };
      check(
        allowedKeys[r.state] &&
          Object.keys(r).every((k) => allowedKeys[r.state]!.includes(k)),
        "VALIDATION_FAILED",
        "Unexpected properties in field envelope",
      );
      const provenance = (ids: unknown) => {
        check(
          Array.isArray(ids) &&
            ids.every(
              (x) => typeof x === "string" && uuid.safeParse(x).success,
            ),
          "VALIDATION_FAILED",
          "Invalid assertion IDs",
        );
      };
      if (r.state === "value") {
        provenance(r.assertionIds);
        validateValue(f, r.value);
        check(
          ["reported", "verified", "disputed", "unknown"].includes(
            r.verification,
          ) &&
            Array.isArray(r.assertionIds) &&
            r.assertionIds.length > 0,
          "VALIDATION_FAILED",
          "Invalid value provenance",
        );
      } else if (r.state === "missing")
        check(
          f.optional,
          "VALIDATION_FAILED",
          "Required field cannot be missing",
        );
      else if (r.state === "unknown") {
        provenance(r.assertionIds);
        check(
          typeof r.reason === "string" && Array.isArray(r.assertionIds),
          "VALIDATION_FAILED",
          "Invalid unknown envelope",
        );
      } else if (r.state === "conflict") {
        check(
          Array.isArray(r.candidates) && r.candidates.length >= 2,
          "VALIDATION_FAILED",
          "Conflict needs competing values",
        );
        for (const v of r.candidates) {
          provenance(v.assertionIds);
          validateValue(f, v.value);
          check(
            ["reported", "verified", "disputed", "unknown"].includes(
              v.verification,
            ) &&
              Array.isArray(v.assertionIds) &&
              v.assertionIds.length > 0,
            "VALIDATION_FAILED",
            "Invalid conflict provenance",
          );
        }
      } else check(false, "VALIDATION_FAILED", "Unknown field state");
    }
    check(
      Object.keys(record.fields).every((k) => c.fields.some((f) => f.id === k)),
      "VALIDATION_FAILED",
      "Unexpected contract field",
    );
    if (record.relationships !== undefined) {
      check(
        record.relationships &&
          typeof record.relationships === "object" &&
          !Array.isArray(record.relationships),
        "VALIDATION_FAILED",
        "Invalid relationship envelope",
      );
      for (const [rid, selection] of Object.entries(record.relationships) as [
        string,
        any,
      ][]) {
        check(
          d.relations.some((r) => r.id === rid && r.source === c.id),
          "VALIDATION_FAILED",
          "Relationship absent from contract",
        );
        check(
          selection &&
            typeof selection.hasMore === "boolean" &&
            Array.isArray(selection.items) &&
            selection.items.length <= 25,
          "VALIDATION_FAILED",
          "Invalid linked result",
        );
        for (const link of selection.items)
          check(
            link &&
              uuid.safeParse(link.id).success &&
              uuid.safeParse(link.assertionId).success &&
              ["reported", "verified", "disputed", "unknown"].includes(
                link.verification,
              ),
            "VALIDATION_FAILED",
            "Invalid link provenance",
          );
      }
    }
  }
  return raw as EntityRecord[];
}
const typeName = (f: FieldDefinition) => {
  const t =
    f.type === "integer"
      ? "number"
      : f.type === "boolean"
        ? "boolean"
        : f.type === "money"
          ? "{ amount: string; currency: string }"
          : f.type === "enum"
            ? f.values!.map((v) => JSON.stringify(v)).join(" | ")
            : "string";
  return t + (f.nullable ? " | null" : "");
};
export async function generateContract(
  lock: {
    id: string;
    hash: string;
    definition: Definition;
    sourceOntologyId: string | null;
    sourceOntologyHash: string | null;
  },
  outputDirectory: string,
): Promise<void> {
  const d = definition(lock.definition);
  check(
    uuid.safeParse(lock.id).success &&
      uuid.safeParse(lock.sourceOntologyId).success &&
      typeof lock.sourceOntologyHash === "string" &&
      /^[a-f0-9]{64}$/.test(lock.sourceOntologyHash),
    "VALIDATION_FAILED",
    "Contract lock requires valid contract and source ontology references",
  );
  check(
    hash(d) === lock.hash,
    "VALIDATION_FAILED",
    "Contract lock hash does not match its definitions",
  );
  const out = resolve(outputDirectory),
    parent = dirname(out);
  await mkdir(parent, { recursive: true });
  const canonicalParent = await realpath(parent);
  check(
    canonicalParent === parent,
    "INVALID_INPUT",
    "Generation through a symlink parent is refused",
  );
  const existing = await lstat(out).catch(() => null);
  check(
    !existing || (existing.isDirectory() && !existing.isSymbolicLink()),
    "INVALID_INPUT",
    "Output must be a real directory",
  );
  await mkdir(out, { recursive: true });
  for (const filename of [
    "contract.json",
    "index.d.ts",
    "index.mjs",
    "index.d.mts",
    "validator.mjs",
  ]) {
    const target = await lstat(resolve(out, filename)).catch(() => null);
    check(
      !target || (!target.isSymbolicLink() && target.isFile()),
      "INVALID_INPUT",
      "Refusing symlink or non-file output",
    );
  }
  const declarations = `// Generated by Ontave. Contract ${lock.hash}\nimport type { FieldResult } from 'ontave';\nexport type OntaveEntities = {\n${d.concepts.map((c) => `  ${JSON.stringify(c.id)}: { id: string; conceptId: ${JSON.stringify(c.id)}; name: string; revision: number; fields: { ${c.fields.map((f) => `${JSON.stringify(f.id)}: FieldResult<${typeName(f)}>;`).join(" ")} } };`).join("\n")}\n};\nexport declare const contractHash: ${JSON.stringify(lock.hash)};\nexport declare function validate(records: unknown): Array<OntaveEntities[keyof OntaveEntities]>;\n`;
  await writeFile(
    resolve(out, "contract.json"),
    json({ ...lock, definition: d, dialect: "ontave-definition-v1" }) + "\n",
  );
  await writeFile(resolve(out, "index.d.ts"), declarations);
  await writeFile(resolve(out, "index.d.mts"), declarations);
  await writeFile(
    resolve(out, "index.mjs"),
    "export {contractHash,validate} from './validator.mjs';\n",
  );
  await writeFile(
    resolve(out, "validator.mjs"),
    `import { validateContractRecords } from 'ontave';\nconst definition = JSON.parse(${JSON.stringify(json(d))});\nexport const contractHash = ${JSON.stringify(lock.hash)};\nexport const validate = records => validateContractRecords(records, definition);\n`,
  );
}
