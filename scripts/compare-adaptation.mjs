import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
import { AdaptiveOntave } from "../examples/adaptive-quotes/ontave.mjs";
import {
  FlexiblePostgres,
  migrateFlexible,
} from "../examples/adaptive-quotes/plain.mjs";
import { seeds, cases, protocol } from "../examples/adaptive-quotes/cases.mjs";
import {
  frozenDefinition,
  digest,
} from "../examples/adaptive-quotes/shared.mjs";
import {
  oldQueries,
  relatedCollections,
} from "../examples/adaptive-quotes/frozen-app.mjs";
import { fixturePlan } from "../examples/adaptive-quotes/fixture.mjs";
import {
  scoreRelated,
  totalScores,
} from "../examples/adaptive-quotes/scoring.mjs";
import { expandKnownReferences } from "../examples/adaptive-quotes/references.mjs";
const args = process.argv.slice(2),
  responseArg = args.find((x) => x.startsWith("--responses=")),
  expand = args.includes("--expand-known-references"),
  reuse = args.includes("--reuse-current-definitions");
assert.ok(
  args.every(
    (a) =>
      a.startsWith("--responses=") ||
      a === "--expand-known-references" ||
      a === "--reuse-current-definitions",
  ) && args.length <= 3,
  "Use --responses=path and optional deterministic bridge flags, or no arguments for fixtures",
);
const input = responseArg
  ? JSON.parse(await readFile(responseArg.slice(12), "utf8"))
  : null;
if (input) {
  assert.equal(input.protocol.casesHash, digest(cases));
  assert.equal(input.protocol.frozenDefinitionHash, digest(frozenDefinition));
}
const root = resolve(
  "artifacts/adaptation",
  new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
);
await mkdir(root, { recursive: true });
const db = await disposablePostgres(),
  all = [],
  stores = [];
try {
  await migrateFlexible(db.admin, "ontave_runtime");
  for (let trial = 1; trial <= (input ? protocol.trials : 1); trial++) {
    const arms = {
      ontave: new AdaptiveOntave(db.connectionString, {
        reuseDefinitions: reuse,
      }),
      flexible: new FlexiblePostgres(db.connectionString, {
        reuseDefinitions: reuse,
      }),
      strict: new AdaptiveOntave(db.connectionString, { automatic: false }),
    };
    stores.push(...Object.values(arms));
    const frozen = {},
      setup = {};
    for (const [name, store] of Object.entries(arms)) {
      const at = performance.now();
      await store.setup();
      for (const seed of seeds)
        await store.apply({ ...seed, source: "supplier" }, seed.plan, {
          seed: true,
        });
      frozen[name] = await oldQueries(store);
      setup[name] = performance.now() - at;
    }
    assert.equal(
      digest(await arms.ontave.definition()),
      digest(frozenDefinition),
    );
    for (let n = 0; n < cases.length; n++) {
      const event = cases[n],
        record = input?.results.find(
          (r) => r.trial === trial && r.id === event.id,
        );
      let plan =
        record?.plan ??
        (input ? null : fixturePlan(event, await arms.flexible.definition()));
      if (expand)
        plan = expandKnownReferences(
          plan,
          seeds.map((s) => s.plan.entities[0].fields.reference.value),
          event.text,
        );
      const row = {
        trial,
        id: event.id,
        family: event.family,
        scope: event.scope ?? "routine",
        acquisitionError: record?.error ?? null,
        arms: {},
      };
      const order =
        n % 2
          ? ["flexible", "ontave", "strict"]
          : ["ontave", "flexible", "strict"];
      for (const name of order) {
        const store = arms[name],
          at = performance.now();
        let outcome,
          error = null,
          related = [];
        try {
          outcome = await store.apply({ ...event, text: event.text }, plan);
          related = await relatedCollections(store);
        } catch (e) {
          error = { code: e.code ?? e.message };
        }
        const after = await oldQueries(store),
          unchanged = digest(after) === digest(frozen[name]);
        const score = scoreRelated(related, event);
        row.arms[name] = {
          state: outcome?.state ?? "failed",
          error,
          exception: outcome?.exception ?? null,
          score,
          oldQueriesUnchanged: unchanged,
          durationMs: performance.now() - at,
          automaticPublications:
            outcome?.events.filter((e) => e.kind === "policy-publication")
              .length ?? 0,
          newConcepts: (await store.definition()).concepts
            .filter(
              (c) => !frozenDefinition.concepts.some((x) => x.id === c.id),
            )
            .map((c) => c.id),
        };
      }
      all.push(row);
      await writeFile(
        resolve(root, `trial-${trial}-${event.id}.json`),
        JSON.stringify(row, null, 2) + "\n",
      );
      console.log(
        JSON.stringify({
          trial,
          id: event.id,
          states: Object.fromEntries(
            Object.entries(row.arms).map(([k, v]) => [k, v.state]),
          ),
        }),
      );
    }
    // Replay one source envelope: this must not add claims in either automated arm.
    for (const name of ["ontave", "flexible"]) {
      const store = arms[name],
        before = await relatedCollections(store),
        first = cases[0];
      let plan = input
        ? input.results.find((r) => r.trial === trial && r.id === first.id)
            ?.plan
        : fixturePlan(first, frozenDefinition);
      if (expand)
        plan = expandKnownReferences(
          plan,
          seeds.map((s) => s.plan.entities[0].fields.reference.value),
          first.text,
        );
      await store.apply(first, plan);
      assert.deepEqual(await relatedCollections(store), before);
    }
    for (const store of Object.values(arms)) await store.close();
    console.log(JSON.stringify({ trial, setupMs: setup }));
  }
  const arms = Object.fromEntries(
    ["ontave", "flexible", "strict"].map((name) => [
      name,
      {
        quality: totalScores(all.map((r) => r.arms[name].score)),
        routineQuality: totalScores(
          all
            .filter((r) => r.scope === "routine")
            .map((r) => r.arms[name].score),
        ),
        oldQueryChecks: all.length * 3,
        oldQueriesUnchanged: all.every((r) => r.arms[name].oldQueriesUnchanged),
        manualReviewActions: 0,
        automaticPublications: all.reduce(
          (n, r) => n + r.arms[name].automaticPublications,
          0,
        ),
        pendingOrFailed: all.filter((r) => r.arms[name].state !== "completed")
          .length,
        latencyMs: all.map((r) => r.arms[name].durationMs),
        conceptsByTrial: Object.fromEntries(
          [...new Set(all.map((r) => r.trial))].map((t) => [
            t,
            all.filter((r) => r.trial === t).at(-1).arms[name].newConcepts,
          ]),
        ),
      },
    ]),
  );
  const files = [
    "examples/adaptive-quotes/frozen-definition.json",
    "examples/adaptive-quotes/frozen-app.mjs",
    "examples/adaptive-quotes/shared.mjs",
    "examples/adaptive-quotes/plain.mjs",
    "examples/adaptive-quotes/ontave.mjs",
    "examples/adaptive-quotes/cases.mjs",
    "examples/adaptive-quotes/scoring.mjs",
    "examples/adaptive-quotes/references.mjs",
    "src/runtime.ts",
    "src/policy.ts",
    "src/automation.ts",
    "dist/runtime.js",
    "scripts/compare-adaptation.mjs",
  ];
  const fileHashes = Object.fromEntries(
    await Promise.all(
      files.map(async (f) => [
        f,
        createHash("sha256")
          .update(await readFile(f))
          .digest("hex"),
      ]),
    ),
  );
  const report = {
    version: "adaptive-quotation-v2",
    createdAt: new Date().toISOString(),
    mode: input
      ? "shared-live-plans-paired-replay"
      : "fixture-verification-not-live-learning",
    currentDefinitionReuse: reuse
      ? "Post-acquisition development ablation: reuse active IDs with matching names and field types, retain active semantics and validate all facts against the current contract. No alias-ID merging or new inference. Original runs retained."
      : false,
    referenceExpansion: expand
      ? "Development replay ablation after v2 exposed direct existing-key relationship targets. Expands only exact source-present authorized quotation keys; no values or semantic labels inferred. Original predictions/errors and original replay are retained. Not fresh end-to-end holdout evidence."
      : false,
    protocol: input?.protocol ?? protocol,
    frozenDefinitionHash: digest(frozenDefinition),
    casesHash: digest(cases),
    sourceHashes: fileHashes,
    arms,
    results: all,
    paidInferenceAttempts: input?.results.length ?? 0,
    independentDevelopers: 0,
    developerTimeSaved: null,
    productionQualified: false,
    limitations: [
      "The planner receives the current shadow registry and source, never gold labels; each acquired plan is replayed into all arms.",
      "The initial app contains no delivery type. The neutral host scopes new IDs to an extension namespace. A policy pass is not semantic qualification.",
      "Source-scoped reported commitments link to quotations through explicit reference identifiers. No autonomous global shipment identity or verified delivery claim.",
      "This is synthetic English text on one small sequential scenario set with maintainer labels; repeated trials are correlated.",
      "The flexible comparator also learns JSONB metadata without physical migrations. Machine timing and author-maintained code are not independent developer-effort measurements.",
      "No manual review actions are issued during adaptation. Pending cases still count against zero-touch usable coverage.",
      "Hosted service, billing and external developer adoption remain unvalidated.",
    ],
  };
  await writeFile(
    resolve(root, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    "artifacts/adaptation/latest.json",
    JSON.stringify({ root }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ root, mode: report.mode, arms }));
  assert.ok(
    Object.values(arms).every((a) => a.oldQueriesUnchanged),
    "Frozen query regression: report retained",
  );
  if (!input) {
    assert.equal(arms.ontave.quality.f1, 1);
    assert.equal(arms.flexible.quality.f1, 1);
    assert.equal(arms.strict.quality.recall, 0);
  }
} finally {
  for (const store of stores) await store.close().catch(() => {});
  await db.stop();
}
