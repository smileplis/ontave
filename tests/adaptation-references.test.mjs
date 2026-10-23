import test from "node:test";
import assert from "node:assert/strict";
import {
  expandKnownReferences,
  reuseCurrentDefinitions,
} from "../examples/adaptive-quotes/references.mjs";
import {
  fixturePlan,
  fixturePatch,
} from "../examples/adaptive-quotes/fixture.mjs";
import { cases } from "../examples/adaptive-quotes/cases.mjs";
import {
  frozenDefinition,
  validatePlan,
} from "../examples/adaptive-quotes/shared.mjs";
test("reference bridge expands only explicit authorized keys, normalizes wire IDs and never invents a parent", () => {
  const c = cases[0],
    raw = fixturePlan(c, frozenDefinition);
  raw.entities = raw.entities.filter((e) => e.mentionId !== "q");
  for (const r of raw.relationships) r.target = "Q17";
  const normalized = expandKnownReferences(raw, ["Q17"], c.text);
  assert.equal(
    normalized.entities.filter((e) => e.conceptId === "quotation").length,
    1,
  );
  validatePlan(normalized, frozenDefinition, c.text);
  assert.equal(
    expandKnownReferences(raw, ["Q18"], c.text).entities.filter(
      (e) => e.conceptId === "quotation",
    ).length,
    0,
  );
  assert.equal(
    expandKnownReferences(
      raw,
      ["Q17"],
      c.text.replaceAll("Q17", "Q170"),
    ).entities.filter((e) => e.conceptId === "quotation").length,
    0,
  );
});
test("compatible repeated declarations keep the active model authoritative and do not merge different IDs or types", () => {
  const c = cases[0],
    raw = fixturePlan(c, frozenDefinition),
    active = {
      concepts: [...frozenDefinition.concepts, ...fixturePatch.concepts],
      relations: fixturePatch.relations,
    };
  const reused = reuseCurrentDefinitions(raw, active);
  assert.equal(reused.patch.concepts.length, 0);
  assert.equal(reused.patch.relations.length, 0);
  assert.ok(reused.normalization.length);
  const changed = structuredClone(raw);
  changed.patch.concepts[0].fields[0].type = "text";
  assert.equal(
    reuseCurrentDefinitions(changed, active).patch.concepts.length,
    1,
  );
  changed.patch.concepts[0].id = "ext_other";
  assert.equal(
    reuseCurrentDefinitions(changed, active).patch.concepts.length,
    1,
  );
});
