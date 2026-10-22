import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createOntave,
  starter,
  extend,
  OntaveError,
} from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { evaluateRead } from "../../dist/evaluation.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
const val = (value) => ({
  state: "value",
  value,
  verification: "reported",
  assertionIds: [randomUUID()],
});

test("bounded evaluator scores identities, relations, uncertainty and read fixtures without writes", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID(),
    other = randomUUID();
  let fail = false;
  const patch = {
    concepts: [
      {
        id: "installation",
        name: "Installation",
        description: "Installation work",
        fields: [
          {
            id: "reference",
            name: "Reference",
            description: "Work reference",
            type: "text",
          },
        ],
      },
    ],
    relations: [
      {
        id: "assigned",
        name: "Assigned",
        source: "installation",
        target: "person",
      },
    ],
  };
  const d = extend(starter, patch);
  const model = fixtureAdapter((task) => {
    if (fail)
      throw new OntaveError(
        "INVALID_MODEL_OUTPUT",
        "Truncated fictional attempt",
        false,
        {
          model: "fixture-truncated",
          usage: { totalTokens: 123 },
          outcome: "truncated",
        },
      );
    const e = personFixture("Ramesh");
    if (task.ontology.concepts.some((c) => c.id === "installation")) {
      e.entities.push({
        mentionId: "work",
        conceptId: "installation",
        name: "I-101",
        fields: { reference: { value: "I-101", quote: "I-101" } },
      });
      e.relationships.push({
        source: "work",
        target: "person_1",
        relationId: "assigned",
        quote: "I-101 assigned to Ramesh",
      });
    } else e.observations.push({ concept: "Installation", quote: "I-101" });
    return e;
  });
  const app = createOntave({
    storage: db.storage,
    model,
    authorize: (ctx) => ({
      actorId: "test",
      workspaceId: ctx === "other" ? other : w,
      capabilities: ["provision", "ingest", "worker", "read", "review"],
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Evaluation",
    seed: "people",
    requestKey: "create",
  });
  await app.workspaces.create("other", {
    workspaceId: other,
    name: "Other",
    seed: "people",
    requestKey: "create",
  });
  const oldContract = await app.contracts.register(null, starter);
  const receipt = await app.ingest(null, {
    source: "eval",
    idempotencyKey: "1",
    payload: { kind: "text", text: "I-101 assigned to Ramesh" },
  });
  await app.worker.runOnce(null);
  const candidate = await app.ontology.propose(null, {
    patch,
    evidenceIds: [receipt.evidence_id],
    requestKey: "propose",
    reason: "Represent work",
  });
  const person = {
    id: randomUUID(),
    conceptId: "person",
    name: "Ramesh",
    revision: 1,
    fields: { name: val("Ramesh"), email: { state: "missing" } },
  };
  const installation = {
    id: randomUUID(),
    conceptId: "installation",
    name: "I-101",
    revision: 1,
    fields: { reference: val("I-101") },
    relationships: {
      assigned: {
        items: [
          {
            id: person.id,
            assertionId: randomUUID(),
            verification: "reported",
          },
        ],
        hasMore: false,
      },
    },
  };
  const extract = {
    id: "extract",
    kind: "extract",
    evidenceId: receipt.evidence_id,
    expected: [
      {
        conceptId: "person",
        fieldId: "name",
        entityName: "Ramesh",
        value: "Ramesh",
        quote: "Ramesh",
      },
      {
        conceptId: "installation",
        fieldId: "reference",
        entityName: "I-101",
        value: "I-101",
        quote: "I-101",
      },
    ],
    identities: [
      { conceptId: "person", name: "Ramesh", existingId: null },
      { conceptId: "installation", name: "I-101", existingId: null },
    ],
    relationships: [
      {
        relationId: "assigned",
        source: { conceptId: "installation", name: "I-101" },
        target: { conceptId: "person", name: "Ramesh" },
        quote: "I-101 assigned to Ramesh",
      },
    ],
    observations: [],
  };
  const tasks = [
    extract,
    { id: "contract", kind: "contract", contractId: oldContract.id },
    {
      id: "old-read",
      kind: "read",
      definition: starter,
      records: [person],
      query: {
        conceptId: "person",
        where: [{ field: "email", op: "stateIs", value: "missing" }],
      },
      expected: { records: [person], hasMore: false },
    },
    {
      id: "new-read",
      kind: "read",
      definition: d,
      records: [person, installation],
      query: { conceptId: "installation", include: ["assigned"] },
      expected: { records: [installation], hasMore: false },
    },
  ];
  const suiteInput = {
    name: "Frozen same fixture both sides",
    tasks,
    maxCalls: 2,
    timeoutMs: 5000,
  };
  const suite = await app.evaluations.registerSuite(null, suiteInput);
  const snapshot = async () =>
    (
      await db.admin.query(
        "SELECT (SELECT count(*) FROM ontave.assertions) AS assertions,(SELECT count(*) FROM ontave.entities) AS entities,(SELECT active_id FROM ontave.workspaces WHERE workspace_id=$1) AS head,(SELECT count(*) FROM ontave.decisions) AS decisions",
        [w],
      )
    ).rows;
  const before = await snapshot();
  await t.test(
    "shared SQL fixtures preserve old reads and enable new reads with frozen source metrics",
    async () => {
      const evaluation = await app.evaluations.evaluate(null, {
        candidateId: candidate.candidateId,
        suiteId: suite.suiteId,
      });
      assert.equal(evaluation.passed, true);
      assert.deepEqual(await snapshot(), before);
      const traces = evaluation.report.traces;
      assert.equal(traces.length, 6);
      assert.equal(
        traces.find((x) => x.side === "candidate" && x.taskId === "extract")
          .metrics.relationships.correct,
        1,
      );
      assert.equal(
        traces.find((x) => x.side === "parent" && x.taskId === "extract")
          .metrics.fields.recall,
        0.5,
      );
      assert.equal(
        traces.find((x) => x.side === "candidate" && x.taskId === "extract")
          .metrics.identities.correct,
        2,
      );
      assert.deepEqual(
        traces.find((x) => x.side === "parent" && x.taskId === "new-read")
          .output,
        { error: "CONTRACT_NOT_AVAILABLE" },
      );
    },
  );
  await t.test(
    "failed provider attempts keep available usage and remain non-passing",
    async () => {
      fail = true;
      let id;
      await assert.rejects(
        app.evaluations.evaluate(null, {
          candidateId: candidate.candidateId,
          suiteId: suite.suiteId,
        }),
        (e) => {
          id = e.details.evaluationId;
          return e.code === "INVALID_MODEL_OUTPUT";
        },
      );
      fail = false;
      const failed = await app.evaluations.get(null, id);
      assert.equal(failed.passed, false);
      assert.equal(failed.report.traces[0].usage.totalTokens, 123);
      assert.equal(failed.report.traces[0].error.outcome, "truncated");
      await assert.rejects(
        app.evaluations.get("other", id),
        (e) => e.code === "NOT_FOUND",
      );
      assert.deepEqual(await snapshot(), before);
    },
  );
  await t.test(
    "suite mutations have new hashes; malformed and executable fixtures are rejected",
    async () => {
      const changed = structuredClone(suiteInput);
      changed.tasks[0].expected[0].value = "Different";
      assert.notEqual(
        (await app.evaluations.registerSuite(null, changed)).hash,
        suite.hash,
      );
      const invalid = structuredClone(suiteInput);
      invalid.tasks[2].query.sql = "DROP SCHEMA ontave CASCADE";
      await assert.rejects(
        app.evaluations.registerSuite(null, invalid),
        (e) => e.code === "INVALID_INPUT",
      );
      const dangling = structuredClone(suiteInput);
      dangling.tasks[3].records = [installation];
      await assert.rejects(
        app.evaluations.registerSuite(null, dangling),
        (e) => e.code === "INVALID_INPUT",
      );
      await assert.rejects(
        app.evaluations.registerSuite(null, { ...suiteInput, maxCalls: 1 }),
        (e) => e.code === "INVALID_INPUT",
      );
    },
  );
  await t.test(
    "empty live reads still validate relationships and filters",
    async () => {
      const q = {
        contractId: oldContract.id,
        contractHash: oldContract.hash,
        conceptId: "person",
      };
      await assert.rejects(
        app.entities.find(null, { ...q, include: ["not_declared"] }),
        (e) => e.code === "INVALID_INPUT",
      );
      await assert.rejects(
        app.entities.find(null, {
          ...q,
          where: [{ field: "unknown", op: "eq", value: "x" }],
        }),
        (e) => e.code === "INVALID_INPUT",
      );
    },
  );
  await t.test(
    "read fixtures preserve null, missing, unknown, conflict and deterministic pagination",
    async () => {
      const typed = {
        concepts: [
          {
            id: "sample",
            name: "Sample",
            description: "Read states",
            fields: [
              {
                id: "value",
                name: "Value",
                description: "Optional decimal",
                type: "decimal",
                optional: true,
                nullable: true,
              },
            ],
          },
        ],
        relations: [],
      };
      const results = [
        val("10"),
        val("2"),
        val(null),
        { state: "missing" },
        { state: "unknown", reason: "Withdrawn", assertionIds: [] },
        {
          state: "conflict",
          candidates: [
            {
              value: "1",
              verification: "reported",
              assertionIds: [randomUUID()],
            },
            {
              value: "3",
              verification: "reported",
              assertionIds: [randomUUID()],
            },
          ],
        },
      ];
      const records = results.map((value, i) => ({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        conceptId: "sample",
        name: String(i),
        revision: 1,
        fields: { value },
      }));
      const run = async (query) =>
        db.storage.transaction(w, (c) =>
          evaluateRead(
            c,
            { kind: "read", definition: typed, records, query },
            typed,
            w,
          ),
        );
      const asc = await run({
        conceptId: "sample",
        order: { field: "value", direction: "asc" },
      });
      assert.deepEqual(
        asc.records.map((r) => r.name),
        ["1", "0", "2", "3", "4", "5"],
      );
      const desc = await run({
        conceptId: "sample",
        order: { field: "value", direction: "desc" },
        limit: 2,
      });
      assert.deepEqual(
        desc.records.map((r) => r.name),
        ["0", "1"],
      );
      assert.equal(desc.hasMore, true);
      assert.equal(
        (
          await run({
            conceptId: "sample",
            where: [{ field: "value", op: "eq", value: null }],
          })
        ).records.length,
        1,
      );
      assert.equal(
        (
          await run({
            conceptId: "sample",
            where: [{ field: "value", op: "gt", value: "1" }],
          })
        ).records.length,
        2,
      );
      assert.equal(
        (
          await run({
            conceptId: "sample",
            where: [{ field: "value", op: "stateIs", value: "unknown" }],
          })
        ).records[0].name,
        "4",
      );
    },
  );
});
