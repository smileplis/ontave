import test from "node:test";
import assert from "node:assert/strict";
import { scoreExtraction } from "../dist/evaluation.js";
import { starter } from "../dist/index.js";
import { personFixture } from "../dist/testing.js";
test("semantic scoring counts duplicate claims, wrong identity, evidence and abstention independently", () => {
  const task = {
    kind: "extract",
    expected: [
      {
        conceptId: "person",
        fieldId: "name",
        entityName: "Asha",
        value: "Asha",
        quote: "Asha",
      },
    ],
    identities: [{ conceptId: "person", name: "Asha", existingId: null }],
    observations: [],
    relationships: [],
  };
  const e = personFixture("Asha");
  assert.equal(scoreExtraction(e, task, starter).passed, true);
  const duplicate = structuredClone(e);
  duplicate.entities.push({
    ...structuredClone(e.entities[0]),
    mentionId: "other",
  });
  const d = scoreExtraction(duplicate, task, starter);
  assert.equal(d.fields.precision, 0.5);
  assert.equal(d.identities.precision, 0.5);
  const wrong = structuredClone(e);
  wrong.entities[0].existingId = "00000000-0000-4000-8000-000000000001";
  assert.equal(scoreExtraction(wrong, task, starter).identities.passed, false);
  const source = structuredClone(e);
  source.entities[0].fields.name.quote = "someone else";
  assert.equal(scoreExtraction(source, task, starter).fields.correct, 0);
  const abstain = scoreExtraction(
    { entities: [], relationships: [], observations: [] },
    task,
    starter,
  );
  assert.equal(abstain.fields.recall, 0);
  assert.equal(abstain.identities.recall, 0);
  assert.equal(
    scoreExtraction(
      { entities: [], relationships: [], observations: [] },
      {
        kind: "extract",
        expected: [],
        observations: [],
        relationships: [],
        identities: [],
      },
      starter,
    ).passed,
    true,
  );
});

test("explicit text equivalences preserve action status, evidence and verification", () => {
  const definition = {
    concepts: [
      {
        id: "request",
        name: "Request",
        description: "Requested work",
        fields: [
          {
            id: "description",
            name: "Description",
            description: "Requested action",
            type: "text",
          },
        ],
      },
    ],
    relations: [],
  };
  const task = {
    kind: "extract",
    expected: [
      {
        conceptId: "request",
        fieldId: "description",
        value: "maintenance review",
        equivalentValues: ["Schedule maintenance review"],
        quote: "Schedule maintenance review",
        verification: "reported",
      },
    ],
  };
  const output = {
    entities: [
      {
        mentionId: "r",
        conceptId: "request",
        name: "Work",
        fields: {
          description: {
            value: "Schedule maintenance review",
            quote: "Schedule maintenance review",
            verification: "reported",
          },
        },
      },
    ],
    relationships: [],
    observations: [],
  };
  assert.equal(scoreExtraction(output, task, definition).fields.passed, true);
  for (const value of [
    "maintenance completed",
    "Cancel maintenance review",
    "No maintenance review",
  ]) {
    const wrong = structuredClone(output);
    wrong.entities[0].fields.description.value = value;
    assert.equal(scoreExtraction(wrong, task, definition).fields.correct, 0);
  }
  const verified = structuredClone(output);
  verified.entities[0].fields.description.verification = "verified";
  assert.equal(scoreExtraction(verified, task, definition).fields.correct, 0);
  const wrongEvidence = structuredClone(output);
  wrongEvidence.entities[0].fields.description.quote = "another source";
  assert.equal(
    scoreExtraction(wrongEvidence, task, definition).fields.correct,
    0,
  );
  const exactTask = structuredClone(task);
  delete exactTask.expected[0].equivalentValues;
  assert.equal(
    scoreExtraction(output, exactTask, definition).fields.correct,
    0,
  );
});

test("text equivalences cannot relax numeric, date or currency values", () => {
  for (const [type, gold, wrong] of [
    ["integer", 12, 13],
    ["date", "2026-10-22", "2026-10-23"],
    [
      "money",
      { amount: "50", currency: "INR" },
      { amount: "50", currency: "USD" },
    ],
  ]) {
    const definition = {
      concepts: [
        {
          id: "record",
          name: "Record",
          description: "Test",
          fields: [{ id: "value", name: "Value", description: "Test", type }],
        },
      ],
      relations: [],
    };
    const task = {
      kind: "extract",
      expected: [
        {
          conceptId: "record",
          fieldId: "value",
          value: gold,
          equivalentValues: [String(wrong)],
        },
      ],
    };
    const output = {
      entities: [
        {
          mentionId: "r",
          conceptId: "record",
          name: "Record",
          fields: { value: { value: wrong, quote: "Source" } },
        },
      ],
      relationships: [],
      observations: [],
    };
    assert.equal(scoreExtraction(output, task, definition).fields.correct, 0);
  }
});
