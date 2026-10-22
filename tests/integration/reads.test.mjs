import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOntave, hash, json } from "../../dist/index.js";
import { fixtureAdapter } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
const fields = [
  { id: "name", type: "text" },
  { id: "count", type: "integer" },
  { id: "price", type: "decimal" },
  { id: "amount", type: "money" },
  { id: "ready", type: "boolean" },
  { id: "date", type: "date" },
  { id: "at", type: "timestamp" },
  { id: "status", type: "enum", values: ["open", "closed"] },
  { id: "nullable", type: "text", optional: true, nullable: true },
  { id: "extra", type: "text", optional: true },
].map((f) => ({ ...f, name: f.id, description: "Typed " + f.id }));
const patch = {
  concepts: [
    { id: "sample", name: "Sample", description: "Scalar dialect", fields },
  ],
  relations: [],
};
const base = {
  name: "Sample",
  count: 10,
  price: "10.00",
  amount: { amount: "12.50", currency: "INR" },
  ready: true,
  date: "2026-01-01",
  at: "2026-01-01T12:00:00+05:30",
  status: "open",
  nullable: null,
};
function extraction(task) {
  const data = JSON.parse(task.text),
    ref = (field) => {
      const quote = json(data[field]),
        target =
          task.text.indexOf(json(field) + ":" + quote) + json(field).length + 1;
      let at = -1,
        occurrence = -1;
      do {
        at = task.text.indexOf(quote, at + 1);
        occurrence++;
      } while (at !== target && at >= 0);
      return { quote, occurrence, path: "/" + field };
    };
  return task.ontology.concepts.length
    ? {
        entities: [
          {
            mentionId: "sample",
            conceptId: "sample",
            name: data.name,
            fields: Object.fromEntries(
              Object.keys(data).map((field) => [
                field,
                { value: data[field], ...ref(field) },
              ]),
            ),
          },
        ],
        relationships: [],
        observations: [],
      }
    : {
        entities: [],
        relationships: [],
        observations: [{ concept: "Sample", ...ref("name") }],
      };
}
test("all scalar reads, hostile input, cursor scope and pure inspection preserve accepted state", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID(),
    other = randomUUID();
  let calls = 0;
  const app = createOntave({
    storage: db.storage,
    model: fixtureAdapter((task) => {
      calls++;
      return extraction(task);
    }),
    authorize: (ctx) => ({
      actorId: "test",
      workspaceId: ctx === "other" ? other : w,
      capabilities:
        ctx === "reader"
          ? ["read"]
          : ["provision", "ingest", "worker", "read", "review"],
    }),
  });
  t.after(async () => {
    await app.close();
    await db.stop();
  });
  for (const [ctx, id] of [
    [null, w],
    ["other", other],
  ])
    await app.workspaces.create(ctx, {
      workspaceId: id,
      name: "Typed",
      seed: "empty",
      requestKey: "create",
    });
  const receipt = await app.ingest(null, {
    source: "types",
    idempotencyKey: "base",
    payload: { kind: "json", value: base },
  });
  await app.worker.runOnce(null);
  const candidate = await app.ontology.propose(null, {
    patch,
    evidenceIds: [receipt.evidence_id],
    requestKey: "patch",
    reason: "Scalar coverage",
  });
  const suite = await app.evaluations.registerSuite(null, {
    name: "typed",
    maxCalls: 2,
    timeoutMs: 10000,
    tasks: [
      {
        id: "types",
        kind: "extract",
        evidenceId: receipt.evidence_id,
        expected: Object.entries(base).map(([fieldId, value]) => ({
          conceptId: "sample",
          fieldId,
          value,
        })),
      },
    ],
  });
  const evaluated = await app.evaluations.evaluate(null, {
    candidateId: candidate.candidateId,
    suiteId: suite.suiteId,
  });
  assert.equal(evaluated.passed, true);
  await app.ontology.publish(null, {
    candidateId: candidate.candidateId,
    candidateHash: candidate.hash,
    evaluationId: evaluated.evaluationId,
    evaluationHash: evaluated.hash,
    requestKey: "publish",
    reason: "Typed suite passed",
  });
  const contract = await app.contracts.register(null, patch),
    q = {
      contractId: contract.id,
      contractHash: contract.hash,
      conceptId: "sample",
    };
  const staged = await app.worker.runOnce(null);
  let b = await app.reviews.get(null, staged.bundleId);
  await app.reviews.accept(null, {
    bundleId: b.id,
    digest: b.hash,
    requestKey: "accept",
    reason: "Checked fictional typed values",
  });
  for (let i = 0; i < 3; i++) {
    await app.ingest(null, {
      source: "types",
      idempotencyKey: "row" + i,
      payload: {
        kind: "json",
        value: {
          ...base,
          name: "Other " + i,
          count: 20 + i,
          price: String(i + 2),
          ready: false,
          status: "closed",
        },
      },
    });
    const r = await app.worker.runOnce(null);
    const b = await app.reviews.get(null, r.bundleId);
    await app.reviews.accept(null, {
      bundleId: b.id,
      digest: b.hash,
      requestKey: "accept" + i,
      reason: "Checked typed row",
    });
  }
  const find = (where) => app.entities.find(null, { ...q, where });
  await t.test(
    "typed predicates preserve exact money, decimals, offsets, enums and booleans",
    async () => {
      for (const [field, value] of Object.entries(base)) {
        assert.equal(
          (await find([{ field, op: "eq", value }])).records.length,
          ["name", "count", "price", "ready", "status"].includes(field) ? 1 : 4,
          field,
        );
      }
      assert.equal(
        (await find([{ field: "price", op: "gt", value: "9" }])).records.length,
        1,
      );
      assert.equal(
        (await find([{ field: "date", op: "gte", value: "2026-01-01" }]))
          .records.length,
        4,
      );
      assert.equal(
        (
          await find([
            { field: "at", op: "lt", value: "2026-01-01T12:00:01+05:30" },
          ])
        ).records.length,
        4,
      );
      assert.equal(
        (await find([{ field: "status", op: "in", value: ["closed"] }])).records
          .length,
        3,
      );
      assert.equal(
        (await find([{ field: "extra", op: "stateIs", value: "missing" }]))
          .records.length,
        4,
      );
      assert.equal(
        (
          await find([
            { field: "name", op: "verificationIn", value: ["verified"] },
          ])
        ).records.length,
        0,
      );
      assert.equal(
        (
          await find([
            { field: "name", op: "verificationIn", value: ["reported"] },
          ])
        ).records.length,
        4,
      );
    },
  );
  await t.test(
    "invalid untyped predicates and hostile identifiers fail without broadening queries",
    async () => {
      for (const filter of [
        { field: "name;DROP TABLE", op: "eq", value: "x" },
        { field: "amount", op: "gt", value: base.amount },
        { field: "nullable", op: "gt", value: null },
        { field: "count", op: "eq", value: "10" },
        { field: "status", op: "eq", value: "unknown" },
        { field: "extra", op: "stateIs", value: ["missing"] },
        { field: "name", op: "verificationIn", value: [["reported"]] },
      ])
        await assert.rejects(
          find([filter]),
          (e) => e.code === "INVALID_INPUT" || e.code === "VALIDATION_FAILED",
        );
      assert.equal(
        (
          await find([
            {
              field: "name",
              op: "eq",
              value: "'; DROP TABLE ontave.entities; --",
            },
          ])
        ).records.length,
        0,
      );
      await assert.rejects(
        app.entities.find(null, {
          ...q,
          order: { field: "amount", direction: "asc" },
        }),
        (e) => e.code === "INVALID_INPUT",
      );
    },
  );
  await t.test(
    "signed cursors are deterministic on unchanged data and bind predicates, contracts and scope",
    async () => {
      const ids = [];
      let cursor;
      do {
        const page = await app.entities.find(null, {
          ...q,
          order: { field: "date", direction: "asc" },
          limit: 1,
          ...(cursor ? { cursor } : {}),
        });
        ids.push(page.records[0].id);
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(ids, [...ids].sort());
      assert.equal(new Set(ids).size, 4);
      const first = await app.entities.find(null, {
        ...q,
        order: { field: "count", direction: "asc" },
        limit: 1,
      });
      await assert.rejects(
        app.entities.find(null, {
          ...q,
          order: { field: "count", direction: "desc" },
          cursor: first.nextCursor,
        }),
        (e) => e.code === "INVALID_INPUT",
      );
      const alternate=await app.contracts.register(null,{concepts:[{...patch.concepts[0],fields:patch.concepts[0].fields.filter(f=>["name","count"].includes(f.id))}],relations:[]});
      await assert.rejects(app.entities.find(null,{...q,contractId:alternate.id,contractHash:alternate.hash,order:{field:"count",direction:"asc"},cursor:first.nextCursor}),e=>e.code==="INVALID_INPUT");
      await assert.rejects(
        app.entities.find("other", { ...q, cursor: first.nextCursor }),
        (e) => e.code === "CONTRACT_NOT_AVAILABLE",
      );
      await assert.rejects(
        app.entities.find(null, { ...q, cursor: first.nextCursor + "x" }),
        (e) => e.code === "INVALID_INPUT",
      );
    },
  );
  await t.test(
    "pure SDK reads invoke no model and mutate no retained state",
    async () => {
      const state = async () =>
        (
          await db.admin.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='ontave' ORDER BY table_name",
          )
        ).rows;
      const snapshot = async () => {
        const result = {};
        for (const { table_name } of await state()) {
          result[table_name] = (
            await db.admin.query(
              `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') AS data FROM ontave.${table_name} t`,
            )
          ).rows[0].data;
        }
        return hash(result);
      };
      const before = await snapshot(),
        modelBefore = calls;
      for (let i = 0; i < 3; i++) {
        await app.entities.find("reader", q);
        await app.ontology.inspect(null);
        await app.ontology.diff(null, candidate.candidateId);
        await app.contracts.pull(null, contract.id);
        await app.evidence.get(null, receipt.evidence_id);
        await app.reviews.get(null, b.id);
        await app.evaluations.get(null, evaluated.evaluationId);
        await app.jobs.list(null);
        await app.jobs.get(null, receipt.job_id);
        await app.jobs.attempts(null, receipt.job_id);
        await app.metrics.summary("reader");
      }
      assert.equal(calls, modelBefore);
      assert.equal(await snapshot(), before);
      await assert.rejects(
        app.ingest("reader", {}),
        (e) => e.code === "FORBIDDEN",
      );
      await assert.rejects(
        app.reviews.reject("reader", {}),
        (e) => e.code === "FORBIDDEN",
      );
      await assert.rejects(
        app.jobs.reprocess("reader", {}),
        (e) => e.code === "FORBIDDEN",
      );
      await assert.rejects(
        app.ontology.propose("reader", {}),
        (e) => e.code === "FORBIDDEN",
      );
      await assert.rejects(
        app.contracts.register("reader", patch),
        (e) => e.code === "FORBIDDEN",
      );
      assert.equal(await snapshot(), before);
    },
  );
});
