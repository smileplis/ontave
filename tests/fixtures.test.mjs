import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hash } from "../dist/index.js";
import { validateExtraction } from "../dist/core.js";
import { scoreExtraction, validateReadFixture } from "../dist/evaluation.js";
test("maintainer labels preserve every input, exact sources, denominators and executable read fixtures", async () => {
  const labels = JSON.parse(
      await readFile("fixtures/release-v1/labels.json", "utf8"),
    ),
    manifest = JSON.parse(
      await readFile("fixtures/release-v1/manifest.json", "utf8"),
    ),
    { definitions } = JSON.parse(
      await readFile("fixtures/release-v1/definitions.json", "utf8"),
    );
  assert.equal(labels.length, 60);
  assert.equal(hash(labels), manifest.labelsHash);
  assert.equal(
    labels.reduce((n, l) => n + l.expected.length, 0),
    179,
  );
  assert.equal(
    labels.reduce((n, l) => n + l.relationships.length, 0),
    107,
  );
  for (const l of labels) {
    const e = validateExtraction(
      structuredClone(l.annotatedExample),
      l.text,
      definitions[l.domain],
    );
    assert.equal(
      scoreExtraction(
        e,
        {
          kind: "extract",
          expected: l.expected,
          relationships: l.relationships,
          observations: l.observations,
        },
        definitions[l.domain],
        l.text,
      ).passed,
      true,
      l.id,
    );
  }
  const reads = JSON.parse(
    await readFile("fixtures/release-v1/read-tasks.json", "utf8"),
  );
  assert.equal(reads.tasks.length, 20);
  assert.equal(hash(reads.tasks), reads.hash);
  for (const t of reads.tasks) validateReadFixture(t);
});
