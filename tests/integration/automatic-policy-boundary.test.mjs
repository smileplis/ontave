import test from "node:test";
import assert from "node:assert/strict";
import { disposablePostgres } from "../helpers/postgres.mjs";
import { AdaptiveOntave } from "../../examples/adaptive-quotes/ontave.mjs";
import { seeds, cases } from "../../examples/adaptive-quotes/cases.mjs";
import { fixturePlan } from "../../examples/adaptive-quotes/fixture.mjs";
import { createOntave } from "../../dist/index.js";
import { postgres } from "../../dist/postgres.js";
import { policy } from "../../examples/adaptive-quotes/shared.mjs";
import { oldQueries } from "../../examples/adaptive-quotes/frozen-app.mjs";

async function stage(store, event, plan) {
  store.event = event;
  store.plan = plan;
  store.parent = await store.definition();
  const receipt = await store.runtime.ingest(store.context, {
    source: "supplier",
    idempotencyKey: event.id,
    payload: { kind: "text", text: event.text },
  });
  store.evidence.set(receipt.evidence_id, event.id);
  await store.runtime.worker.runOnce(store.context);
  return {
    receipt,
    view: await store.runtime.reviews.forJob(store.context, receipt.job_id),
  };
}
const accept = (store, view, key) =>
  store.runtime.reviews.acceptByPolicy(store.context, {
    bundleId: view.bundle.id,
    digest: view.bundle.hash,
    requestKey: key,
  });
const rootPlan = (fields) => ({
  patch: { concepts: [], relations: [] },
  entities: [
    {
      mentionId: "q",
      conceptId: "quotation",
      name: "Q17",
      fields: { reference: { value: "Q17", quote: "Q17" }, ...fields },
    },
  ],
  relationships: [],
  observations: [],
});
async function records(store, conceptId) {
  return (
    await store.runtime.entities.find(store.context, {
      contractId: store.contract.id,
      contractHash: store.contract.hash,
      conceptId,
      limit: 100,
    })
  ).records;
}
async function snapshot(store, db) {
  const counts = {};
  for (const table of ["entities", "assertions", "identifiers", "projections"])
    counts[table] = Number(
      (
        await db.admin.query(
          `SELECT count(*) FROM ontave.${table} WHERE workspace_id=$1`,
          [store.workspaceId],
        )
      ).rows[0].count,
    );
  return {
    queries: await oldQueries(store),
    quotations: await records(store, "quotation"),
    lines: await records(store, "quote_line"),
    related: await store.related("quotation"),
    counts,
  };
}
async function mustHold(
  store,
  db,
  event,
  plan,
  { resolveLine = false, identity } = {},
) {
  const before = await snapshot(store, db);
  let { receipt, view } = await stage(store, event, plan);
  if (resolveLine && view.bundle.body.pending.length) {
    const line = (await records(store, "quote_line")).find(
      (r) => r.fields.quote_reference.value === "Q17",
    );
    await store.runtime.reviews.resolveIdentity(store.context, {
      bundleId: view.bundle.id,
      digest: view.bundle.hash,
      mentionId: "line",
      entityId: line.id,
      requestKey: "fixture-identity/" + event.id,
      reason:
        "Fixture links the exact existing quote line so the field boundary is tested independently of identity ambiguity",
    });
    view = await store.runtime.reviews.forJob(store.context, receipt.job_id);
  }
  if (identity) {
    await store.runtime.reviews.resolveIdentity(store.context, {
      bundleId: view.bundle.id,
      digest: view.bundle.hash,
      ...identity,
      requestKey: "fixture-extension/" + event.id,
      reason: "Explicit fixture binds the already accepted extension identity",
    });
    view = await store.runtime.reviews.forJob(store.context, receipt.job_id);
  }
  assert.equal(view.job.state, "waiting_review");
  await assert.rejects(
    accept(store, view, "blocked/" + event.id),
    (e) => e.code === "FORBIDDEN",
  );
  assert.deepEqual(
    await snapshot(store, db),
    before,
    "Rejected automatic writes must leave every accepted field, revision, assertion, identifier and frozen query unchanged",
  );
  assert.equal(
    (await store.runtime.jobs.get(store.context, receipt.job_id)).state,
    "waiting_review",
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT count(*) FROM ontave.decisions WHERE workspace_id=$1 AND operation='accept' AND result->>'bundleId'=$2",
        [store.workspaceId, view.bundle.id],
      )
    ).rows[0].count,
    "0",
  );
}

test("automatic acceptance protects accepted records while additive commitments remain usable", async (t) => {
  const db = await disposablePostgres();
  t.after(() => db.stop());
  async function run(name, fn) {
    await t.test(name, async () => {
      const store = new AdaptiveOntave(db.connectionString);
      try {
        await store.setup();
        for (const seed of seeds)
          await store.apply({ ...seed, source: "supplier" }, seed.plan, {
            seed: true,
          });
        await store.apply(
          cases[0],
          fixturePlan(cases[0], await store.definition()),
        );
        await fn(store);
      } finally {
        await store.close();
      }
    });
  }

  for (const [field, value] of [
    ["currency", "USD"],
    ["supplier", "Fictional Replacement"],
    ["valid_until", "2027-01-01"],
  ])
    await run(
      "holds changes or missing-value fills on quotation " + field,
      async (store) => {
        const event = {
          id: "protected-" + field,
          text: `Quotation Q17: ${field} ${value}.`,
        };
        await mustHold(
          store,
          db,
          event,
          rootPlan({ [field]: { value, quote: value } }),
        );
        const found = await store.findFrozen({
          conceptId: "quotation",
          where: [
            { field: "reference", op: "eq", value: "Q17" },
            { field: "currency", op: "eq", value: "INR" },
            { field: "supplier", op: "eq", value: "Fictional Supplier 1" },
          ],
        });
        assert.equal(found.length, 1);
      },
    );

  for (const [label, field, claim] of [
    ["quantity", "quantity", { value: 999, quote: "999" }],
    [
      "price amount",
      "unit_price",
      { value: { amount: "900", currency: "INR" }, quote: "INR 900" },
    ],
    [
      "price currency",
      "unit_price",
      { value: { amount: "500", currency: "USD" }, quote: "USD 500" },
    ],
  ])
    await run("holds quote-line " + label + " changes", async (store) => {
      const event = {
        id: "protected-line-" + label,
        text: "Quotation Q17 SKU PANEL-1 quantity 999 unit prices INR 900 or USD 500.",
      };
      const plan = {
        patch: { concepts: [], relations: [] },
        entities: [
          {
            mentionId: "line",
            conceptId: "quote_line",
            name: "Q17-PANEL-1",
            fields: {
              quote_reference: { value: "Q17", quote: "Q17" },
              sku: { value: "PANEL-1", quote: "PANEL-1" },
              [field]: claim,
            },
          },
        ],
        relationships: [],
        observations: [],
      };
      await mustHold(store, db, event, plan, { resolveLine: true });
    });

  await run(
    "rolls back a new commitment when a later parent mention changes protected fields",
    async (store) => {
      const event = {
        id: "mixed-valid-and-protected",
        source: "supplier",
        text: "Quotation Q17 currency USD. We promise 3 panels on 2027-02-01.",
        expected: [{ reference: "Q17", quantity: 3, date: "2027-02-01" }],
      };
      const plan = fixturePlan(event, await store.definition());
      plan.entities[0].fields.currency = { value: "USD", quote: "USD" };
      plan.entities.push(plan.entities.shift());
      await mustHold(store, db, event, plan);
    },
  );

  await run(
    "protects already accepted extension records too",
    async (store) => {
      const child = (await store.related("quotation"))[0],
        date = child.fields.delivery_date.value;
      const event = {
        id: "protected-existing-extension",
        text: `Quotation Q17 now promises 999 panels on ${date}.`,
      };
      const plan = {
        patch: { concepts: [], relations: [] },
        entities: [
          {
            mentionId: "q",
            conceptId: "quotation",
            name: "Q17",
            fields: { reference: { value: "Q17", quote: "Q17" } },
          },
          {
            mentionId: "child",
            conceptId: child.conceptId,
            name: "Existing promise",
            existingId: child.id,
            fields: {
              quantity: { value: 999, quote: "999" },
              delivery_date: { value: date, quote: date },
            },
          },
        ],
        relationships: [
          {
            source: "child",
            target: "q",
            relationId: "ext_for_quotation",
            quote: event.text,
          },
        ],
        observations: [],
      };
      await mustHold(store, db, event, plan, {
        identity: { mentionId: "child", entityId: child.id },
      });
    },
  );

  await run(
    "does not add a new identifier alias to an existing parent",
    async (store) => {
      const before = await snapshot(store, db),
        event = {
          id: "new-parent-alias",
          text: "Quotation Q17 has another reference Q999.",
        };
      let { receipt, view } = await stage(store, event, rootPlan({}));
      const extraction = structuredClone(view.bundle.body.extraction);
      extraction.entities[0].identifiers.push({
        authority: "quotation_source",
        kind: "reference",
        value: "Q999",
        quote: "Q999",
        occurrence: 0,
      });
      await store.runtime.reviews.amend(store.context, {
        bundleId: view.bundle.id,
        digest: view.bundle.hash,
        requestKey: "fixture-alias",
        extraction,
        reason: "Fixture emulates an additional model-supplied identifier",
      });
      view = await store.runtime.reviews.forJob(store.context, receipt.job_id);
      await assert.rejects(
        accept(store, view, "blocked-alias"),
        (e) => e.code === "FORBIDDEN",
      );
      assert.deepEqual(await snapshot(store, db), before);
    },
  );

  await run(
    "does not accept a chosen candidate from an already conflicted field",
    async (store) => {
      const event = {
        id: "manual-conflict-fixture",
        text: "Quotation Q17 currency USD.",
      };
      const { view } = await stage(
        store,
        event,
        rootPlan({ currency: { value: "USD", quote: "USD" } }),
      );
      await store.runtime.reviews.accept(store.context, {
        bundleId: view.bundle.id,
        digest: view.bundle.hash,
        requestKey: "manual-conflict-fixture",
        reason:
          "Explicit manual fixture creates an existing conflict; automatic policy must not endorse either candidate",
      });
      const event2 = {
        id: "conflict-candidate",
        text: "Quotation Q17 currency INR.",
      };
      await mustHold(
        store,
        db,
        event2,
        rootPlan({ currency: { value: "INR", quote: "INR" } }),
      );
    },
  );

  await run(
    "matching parent values are reference-only and idempotent",
    async (store) => {
      const before = await snapshot(store, db),
        event = {
          id: "matching-reference",
          text: "Quotation Q17 supplier Fictional Supplier 1 currency INR.",
        };
      const { view } = await stage(
        store,
        event,
        rootPlan({
          supplier: {
            value: "Fictional Supplier 1",
            quote: "Fictional Supplier 1",
          },
          currency: { value: "INR", quote: "INR" },
        }),
      );
      const result = await accept(store, view, "matching-reference");
      assert.deepEqual(await accept(store, view, "matching-reference"), result);
      assert.deepEqual(
        await snapshot(store, db),
        before,
        "References must not increment revisions or append duplicate field claims",
      );
    },
  );

  await run(
    "concurrent additive commitments share a parent without changing its values or revision",
    async (store) => {
      const before = await records(store, "quotation"),
        queries = await oldQueries(store),
        views = [];
      for (const [id, quantity, date] of [
        ["concurrent-a", 3, "2027-03-01"],
        ["concurrent-b", 4, "2027-03-02"],
      ]) {
        const event = {
          id,
          source: "supplier",
          text: `Quotation Q17 commits ${quantity} panels on ${date}.`,
          expected: [{ reference: "Q17", quantity, date }],
        };
        views.push(
          (
            await stage(
              store,
              event,
              fixturePlan(event, await store.definition()),
            )
          ).view,
        );
      }
      await Promise.all(
        views.map((view, n) => accept(store, view, "concurrent-" + n)),
      );
      assert.deepEqual(await records(store, "quotation"), before);
      assert.deepEqual(await oldQueries(store), queries);
      const related = await store.related("quotation");
      for (const id of ["concurrent-a", "concurrent-b"])
        assert.equal(
          related.filter((r) => r.sourceEventIds.includes(id)).length,
          1,
        );
    },
  );
  await run(
    "allowing new base entities never grants mutation of existing base fields",
    async (store) => {
      const before = await snapshot(store, db);
      const { view } = await stage(
        store,
        { id: "allow-new-is-not-update", text: "Quotation Q17 currency USD." },
        rootPlan({ currency: { value: "USD", quote: "USD" } }),
      );
      const runtime = createOntave({
        storage: postgres({ connectionString: db.connectionString }),
        authorize: store.authorize,
        automation: { ...policy, allowNewExistingEntities: true },
      });
      try {
        await assert.rejects(
          runtime.reviews.acceptByPolicy(store.context, {
            bundleId: view.bundle.id,
            digest: view.bundle.hash,
            requestKey: "no-mutation-grant",
          }),
          (e) => e.code === "FORBIDDEN",
        );
      } finally {
        await runtime.close();
      }
      assert.deepEqual(await snapshot(store, db), before);
    },
  );

  await run(
    "a concurrent committed parent revision holds the entire stale automatic bundle",
    async (store) => {
      const before = await snapshot(store, db),
        parent = (await records(store, "quotation")).find(
          (r) => r.fields.reference.value === "Q17",
        );
      const event = {
        id: "racing-parent-revision",
        source: "supplier",
        text: "Quotation Q17 commits 2 panels on 2027-04-01.",
        expected: [{ reference: "Q17", quantity: 2, date: "2027-04-01" }],
      };
      const { receipt, view } = await stage(
        store,
        event,
        fixturePlan(event, await store.definition()),
      );
      const writer = await db.admin.connect();
      let result;
      try {
        await writer.query("BEGIN");
        await writer.query(
          "UPDATE ontave.entities SET revision=revision+1 WHERE id=$1",
          [parent.id],
        );
        result = accept(store, view, "racing-accept").then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        let blocked = false;
        for (let n = 0; n < 100; n++) {
          const rows = await db.admin.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query='SELECT * FROM ontave.entities WHERE id=$1 FOR UPDATE'",
          );
          if (rows.rowCount) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          blocked,
          true,
          "The acceptance transaction must lock the parent before checking its current state",
        );
        await writer.query("COMMIT");
        const outcome = await result;
        assert.equal(outcome.error?.code, "STALE_BUNDLE");
      } finally {
        await writer.query("ROLLBACK");
        writer.release();
        if (result) await result;
      }
      const after = await snapshot(store, db);
      assert.deepEqual(after.queries, before.queries);
      assert.deepEqual(after.counts, before.counts);
      assert.deepEqual(after.related, before.related);
      assert.equal(
        (await store.runtime.jobs.get(store.context, receipt.job_id)).state,
        "waiting_review",
      );
      assert.equal(
        (await records(store, "quotation")).find((r) => r.id === parent.id)
          .revision,
        parent.revision + 1,
        "Only the fixture writer may have changed the parent revision",
      );
    },
  );
});
