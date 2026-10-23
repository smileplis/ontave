import test from "node:test";
import assert from "node:assert/strict";
import { quotationCases } from "../examples/supplier-quotes/cases.mjs";
import { validateOutput } from "../examples/supplier-quotes/domain.mjs";
import {
  scoreFields,
  aggregate,
  wilson,
  bootstrapByFamily,
} from "../examples/supplier-quotes/scoring.mjs";
test("frozen quotation labels have valid scalar types and exact source references; supplier families do not cross splits", () => {
  const families = new Map();
  for (const c of quotationCases) {
    validateOutput(c.expected, c.text);
    const score = scoreFields(c.expected, c.expected, c.text);
    assert.equal(score.f1, 1);
    assert.equal(score.documentExact, true);
    if (families.has(c.family)) assert.equal(families.get(c.family), c.split);
    families.set(c.family, c.split);
  }
  assert.equal(quotationCases.filter((c) => c.split === "holdout").length, 16);
});
test("quotation scorer penalizes duplicate, incorrect-row and unsupported claims and keeps abstention denominator", () => {
  const c = quotationCases[0],
    copy = structuredClone(c.expected);
  copy.records.push(structuredClone(copy.records[1]));
  const duplicates = scoreFields(copy, c.expected, c.text);
  assert.ok(duplicates.falsePositive > 0);
  assert.equal(duplicates.recall, 1);
  assert.ok(duplicates.precision < 1);
  const wrong = structuredClone(c.expected);
  wrong.records[1].fields.unit_price.value.amount = "1";
  assert.equal(scoreFields(wrong, c.expected, c.text).missed, 1);
  const absent = scoreFields(null, c.expected, c.text);
  assert.equal(absent.recall, 0);
  assert.equal(absent.missed, absent.expected);
  const unsupported = structuredClone(c.expected);
  unsupported.records[1].fields.unit_price.quote = "invented";
  assert.equal(scoreFields(unsupported, c.expected, c.text).missed, 1);
  assert.throws(() => validateOutput(unsupported, c.text));
});
test("empty predictions never turn empty ground truth into unsupported perfection for a mixed corpus", () => {
  const rows = quotationCases.map((c) =>
    scoreFields({ records: [], observations: [] }, c.expected, c.text),
  );
  const total = aggregate(rows);
  assert.equal(total.recall, 0);
  assert.equal(total.microF1, 0);
  assert.equal(total.precision, null);
  assert.ok(total.documentExact < 1);
});
test("confidence intervals are reproducible, cluster repeated observations and disclose limited binary evidence", () => {
  const rows = [
    { family: "a", score: 1 },
    { family: "a", score: 1 },
    { family: "b", score: 0 },
  ];
  const select = (rs) => rs.reduce((n, r) => n + r.score, 0) / rs.length;
  assert.deepEqual(
    bootstrapByFamily(rows, select, 200),
    bootstrapByFamily(rows, select, 200),
  );
  const interval = wilson(0, 24);
  assert.equal(interval.lower, 0);
  assert.ok(interval.upper > 0.1);
  assert.equal(wilson(0, 0), null);
});
