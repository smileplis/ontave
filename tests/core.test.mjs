import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceSpan,
  hash,
  json,
  definition,
  extend,
  compatible,
  starter,
  validateValue,
} from "../dist/index.js";
import {
  validateExtraction,
  encodeCursor,
  decodeCursor,
} from "../dist/core.js";

test("canonical JSON is key-order independent and rejects unsupported/cyclic input", () => {
  assert.throws(() => json({ text: "\ud800" }));
  assert.throws(() => json(Object.defineProperty({}, "hidden", { value: 1 })));
  const array = [1];
  array.extra = 2;
  assert.throws(() => json(array));
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 }));
  for (const v of [
    NaN,
    Infinity,
    undefined,
    new Date(),
    { a: undefined },
    [, 1],
  ])
    assert.throws(() => json(v));
  const cyclic = {};
  cyclic.a = cyclic;
  assert.throws(() => json(cyclic));
});
test("UTF-8 evidence spans use byte coordinates and disambiguate repeated quotes", () => {
  const text = "₹50 — राहुल. ₹50";
  const span = sourceSpan(text, "₹50", 1);
  assert.equal(
    Buffer.from(text).subarray(span.startByte, span.endByte).toString(),
    "₹50",
  );
  assert.throws(() => sourceSpan(text, "₹50"));
  assert.throws(() => sourceSpan(text, "missing"));
  assert.throws(() => sourceSpan(text, "₹50", 3));
});
test("definition changes preserve IDs and reject unsupported meaning/type changes", () => {
  const person = starter.concepts.find((c) => c.id === "person");
  const patch = {
    concepts: [
      {
        ...person,
        fields: [
          {
            id: "city",
            name: "City",
            description: "Reported city",
            type: "text",
            optional: true,
          },
        ],
      },
    ],
    relations: [],
  };
  const next = extend(starter, patch);
  assert.ok(compatible(starter, next));
  assert.equal(next.concepts.find((c) => c.id === "person").fields.length, 3);
  assert.throws(() =>
    extend(starter, {
      concepts: [{ ...person, name: "Buyer" }],
      relations: [],
    }),
  );
  assert.throws(() =>
    extend(starter, {
      concepts: [
        {
          ...person,
          fields: [{ ...person.fields[0], type: "integer" }],
        },
      ],
      relations: [],
    }),
  );
  assert.throws(() =>
    extend(starter, {
      concepts: [
        {
          ...person,
          fields: [{ id: "x", name: "X", description: "X", type: "text" }],
        },
      ],
      relations: [],
    }),
  );
});
test("new relationship can connect existing concepts without redefining them", () => {
  const next = extend(starter, {
    concepts: [],
    relations: [
      {
        id: "works_at",
        name: "Works at",
        source: "person",
        target: "organization",
      },
    ],
  });
  assert.equal(next.relations.length, 1);
  assert.throws(() => definition({ concepts: [], relations: next.relations }));
});
test("value schemas distinguish money strings, null, dates, booleans and numbers", () => {
  const f = (type) => ({ id: "x", name: "X", description: "X", type });
  validateValue(f("money"), { amount: "450000", currency: "INR" });
  validateValue(f("decimal"), "0.1");
  for (const v of [0.1, "1e3", "NaN"])
    assert.throws(() => validateValue(f("decimal"), v));
  assert.throws(() =>
    validateValue(f("money"), { amount: 0.1, currency: "INR" }),
  );
  assert.throws(() => validateValue(f("date"), "2026-02-30"));
  assert.throws(() => validateValue(f("timestamp"), "2026-10-21T12:00:00"));
  validateValue(f("timestamp"), "2026-10-21T12:00:00+05:30");
  assert.throws(() => validateValue(f("boolean"), "true"));
  assert.throws(() => validateValue(f("text"), null));
  validateValue({ ...f("text"), nullable: true }, null);
});
test("timestamps reject nonexistent calendar dates and rollover times", () => {
  const field = {
    id: "at",
    name: "At",
    description: "Instant",
    type: "timestamp",
  };
  for (const value of [
    "2023-02-30T00:00:00Z",
    "2026-10-21T24:00:00Z",
    "0000-01-01T00:00:00Z",
  ])
    assert.throws(() => validateValue(field, value));
  validateValue(field, "2024-02-29T12:30:00+05:30");
});
test("extraction rejects fabricated quotes, fields, endpoints and invalid formats", () => {
  const e = {
    entities: [
      {
        mentionId: "p",
        conceptId: "person",
        name: "Rahul",
        fields: { name: { value: "Rahul", quote: "Rahul" } },
      },
    ],
    relationships: [],
    observations: [],
  };
  assert.equal(validateExtraction(e, "Rahul", starter).entities.length, 1);
  assert.throws(() => validateExtraction(e, "Riya", starter));
  assert.throws(() =>
    validateExtraction(
      {
        ...e,
        entities: [
          {
            ...e.entities[0],
            fields: { invented: { value: 1, quote: "Rahul" } },
          },
        ],
      },
      "Rahul",
      starter,
    ),
  );
  assert.throws(() =>
    validateExtraction(
      {
        ...e,
        relationships: [
          { source: "p", target: "x", relationId: "bad", quote: "Rahul" },
        ],
      },
      "Rahul",
      starter,
    ),
  );
  assert.throws(() =>
    validateExtraction({ entities: "wrong" }, "Rahul", starter),
  );
});
test("cursors are tamper evident and scoped by caller-supplied binding", () => {
  const key = "a".repeat(32),
    cursor = encodeCursor({ workspace: "a", id: 1 }, key);
  assert.deepEqual(decodeCursor(cursor, key), { workspace: "a", id: 1 });
  assert.throws(() => decodeCursor(cursor.replace(/^./, "Z"), key));
  assert.throws(() => decodeCursor(cursor, "b".repeat(32)));
});

test("decimal normalization preserves numeric meaning while leaving text identifiers unchanged", async () => {
  const { normalizeValue, definition } = await import("../dist/core.js");
  const decimal = {
    id: "amount",
    name: "Amount",
    description: "Value",
    type: "decimal",
  };
  assert.equal(normalizeValue(decimal, "1.0000000000"), "1");
  assert.equal(normalizeValue(decimal, "-0.00"), "0");
  assert.deepEqual(
    normalizeValue(
      { ...decimal, type: "money" },
      { amount: "12345678901234567890.10", currency: "INR" },
    ),
    { amount: "12345678901234567890.1", currency: "INR" },
  );
  assert.equal(normalizeValue({ ...decimal, type: "text" }, "001"), "001");
  const reordered = structuredClone(starter);
  reordered.concepts.reverse();
  for (const c of reordered.concepts) c.fields.reverse();
  assert.equal(hash(definition(reordered)), hash(starter));
});

test("JSON source references bind paths, values and exact UTF-8 quote regions", async () => {
  const { validateExtraction, sourceReference } =
    await import("../dist/core.js");
  const text = json({ a: [{ name: "Asha" }], b: "Asha" });
  const output = {
    entities: [
      {
        mentionId: "p",
        conceptId: "person",
        name: "Asha",
        fields: {
          name: {
            value: "Asha",
            quote: "Asha",
            occurrence: 0,
            path: "/a/0/name",
          },
        },
      },
    ],
    relationships: [],
    observations: [],
  };
  assert.equal(
    validateExtraction(output, text, starter, "json").entities[0].fields.name
      .path,
    "/a/0/name",
  );
  for (const path of ["/a/3/name", "/b"]) {
    const bad = structuredClone(output);
    bad.entities[0].fields.name.path = path;
    assert.throws(() => validateExtraction(bad, text, starter, "json"));
  }
  const wrong = structuredClone(output);
  wrong.entities[0].fields.name.value = "Riya";
  assert.throws(() => validateExtraction(wrong, text, starter, "json"));
  assert.throws(() => validateExtraction(output, text, starter, "text"));
  const unicode = json({ "/~": "₹🙂" });
  assert.equal(
    sourceReference(unicode, { quote: "₹🙂", path: "/\u007e1\u007e0" }, "json")
      .endByte -
      sourceReference(
        unicode,
        { quote: "₹🙂", path: "/\u007e1\u007e0" },
        "json",
      ).startByte,
    7,
  );
});

test("NUL text and JSON keys are rejected before PostgreSQL serialization", () => {
  for (const value of ["nul\0text", { "nul\0key": 1 }, { nested: ["\0"] }]) {
    assert.throws(
      () => json(value),
      (e) => e.code === "INVALID_INPUT",
    );
  }
});
