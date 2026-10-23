import test from "node:test";
import assert from "node:assert/strict";
import { automationPolicy, checkAutomaticPatch } from "../dist/policy.js";
import {
  frozenDefinition,
  policy,
} from "../examples/adaptive-quotes/shared.mjs";
import { fixturePatch } from "../examples/adaptive-quotes/fixture.mjs";
test("automatic policy freezes host authority and refuses alterations, extra concepts, field types and unapproved endpoints", () => {
  const raw = structuredClone(policy),
    p = automationPolicy(raw);
  raw.sources.push("forged");
  assert.deepEqual(p.sources, ["supplier"]);
  assert.throws(() => p.sources.push("forged"));
  assert.equal(
    checkAutomaticPatch(frozenDefinition, fixturePatch, p)
      .semanticAccuracyQualified,
    false,
  );
  for (const mutate of [
    (x) => {
      x.concepts[0].id = "quotation";
    },
    (x) => {
      x.concepts.push({ ...x.concepts[0], id: "ext_extra" });
    },
    (x) => {
      x.concepts[0].fields[0].type = "money";
    },
    (x) => {
      x.relations[0].target = "quote_line";
    },
  ]) {
    const patch = structuredClone(fixturePatch);
    mutate(patch);
    assert.throws(() => checkAutomaticPatch(frozenDefinition, patch, p));
  }
});
