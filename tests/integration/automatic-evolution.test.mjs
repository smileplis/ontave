import test from "node:test";
import assert from "node:assert/strict";
import { disposablePostgres } from "../helpers/postgres.mjs";
import { AdaptiveOntave } from "../../examples/adaptive-quotes/ontave.mjs";
import {
  FlexiblePostgres,
  migrateFlexible,
} from "../../examples/adaptive-quotes/plain.mjs";
import { seeds, cases } from "../../examples/adaptive-quotes/cases.mjs";
import {
  fixturePlan,
  fixturePatch,
} from "../../examples/adaptive-quotes/fixture.mjs";
import {
  oldQueries,
  relatedCollections,
} from "../../examples/adaptive-quotes/frozen-app.mjs";
import {
  frozenDefinition,
  policy,
  digest,
} from "../../examples/adaptive-quotes/shared.mjs";
import { scoreRelated } from "../../examples/adaptive-quotes/scoring.mjs";
import { createOntave } from "../../dist/index.js";
import { postgres } from "../../dist/postgres.js";
test("automatic additive evolution retains old queries, explicit source identity, provenance and strict default behavior", async (t) => {
  const db = await disposablePostgres();
  t.after(() => db.stop());
  await migrateFlexible(db.admin, "ontave_runtime");
  for (const name of ["ontave", "flexible", "strict"])
    await t.test(name, async () => {
      const store =
        name === "flexible"
          ? new FlexiblePostgres(db.connectionString)
          : new AdaptiveOntave(db.connectionString, {
              automatic: name !== "strict",
            });
      try {
        await store.setup();
        for (const seed of seeds)
          await store.apply({ ...seed, source: "supplier" }, seed.plan, {
            seed: true,
          });
        const before = await oldQueries(store);
        const event = cases[0],
          plan = fixturePlan(event, frozenDefinition),
          outcome = await store.apply(event, plan),
          score = scoreRelated(await relatedCollections(store), event);
        assert.deepEqual(await oldQueries(store), before);
        if (name === "strict") {
          assert.equal(score.correct, 0);
          assert.equal(outcome.state, "waiting_ontology");
          await assert.rejects(
            store.runtime.ontology.publishByPolicy(store.context, {
              candidateId: crypto.randomUUID(),
              candidateHash: "0".repeat(64),
              requestKey: "disabled",
              reason: "No automation selected",
            }),
            (e) => e.code === "FORBIDDEN",
          );
          return;
        }
        assert.equal(score.correct, 2);
        assert.equal(outcome.state, "completed");
        assert.equal(
          (await store.definition()).concepts.length,
          frozenDefinition.concepts.length + 1,
        );
        for (const row of await relatedCollections(store))
          for (const value of Object.values(row.fields))
            if (value.state === "value")
              assert.equal(value.verification, "reported");
        const prior = await relatedCollections(store);
        assert.equal((await store.apply(event, plan)).duplicate, true);
        assert.deepEqual(await relatedCollections(store), prior);
        if (name === "ontave") {
          const unknown = {
              id: "unknown-root-only",
              source: "supplier",
              text: "Quotation Q999 is not present in the application.",
            },
            unknownPlan = {
              patch: { concepts: [], relations: [] },
              entities: [
                {
                  mentionId: "q",
                  conceptId: "quotation",
                  name: "Q999",
                  fields: { reference: { value: "Q999", quote: "Q999" } },
                },
              ],
              relationships: [],
              observations: [],
            };
          assert.equal(
            (await store.apply(unknown, unknownPlan)).exception.code,
            "FORBIDDEN",
          );
          assert.deepEqual(await oldQueries(store), before);
          const denied = createOntave({
            storage: postgres({ connectionString: db.connectionString }),
            authorize: store.authorize,
            automation: { ...policy, relationshipTargets: ["quote_line"] },
          });
          try {
            const restricted = { ...cases[1], id: "restricted-parent" };
            store.event = restricted;
            store.parent = await store.definition();
            store.plan = fixturePlan(restricted, store.parent);
            const receipt = await store.runtime.ingest(store.context, {
              source: "supplier",
              idempotencyKey: restricted.id,
              payload: { kind: "text", text: restricted.text },
            });
            await store.runtime.worker.runOnce(store.context);
            const view = await store.runtime.reviews.forJob(
              store.context,
              receipt.job_id,
            );
            await assert.rejects(
              denied.reviews.acceptByPolicy(store.context, {
                bundleId: view.bundle.id,
                digest: view.bundle.hash,
                requestKey: "wrong-parent-policy",
              }),
              (e) => e.code === "FORBIDDEN",
            );
            const foreign = cases.find((e) => e.id === "guard-10"),
              blocked = await store.apply(
                foreign,
                fixturePlan(foreign, await store.definition()),
              );
            assert.equal(blocked.exception.code, "FORBIDDEN");
            assert.equal(
              scoreRelated(await relatedCollections(store), foreign).proposed,
              0,
            );
            const decisions = await db.admin.query(
              "SELECT operation,actor,reason,result FROM ontave.decisions WHERE workspace_id=$1 AND operation='publishByPolicy'",
              [store.workspaceId],
            );
            assert.equal(decisions.rowCount, 1);
            assert.equal(
              decisions.rows[0].result.authorization.semanticAccuracyQualified,
              false,
            );
            assert.match(decisions.rows[0].actor, /^automation\//);
          } finally {
            await denied.close();
          }
        }
      } finally {
        await store.close();
      }
    });
});
