// Paired storage/workflow comparison. A shared live prediction is never counted twice as two model trials.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { cpus, totalmem } from "node:os";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
import { migrate } from "../dist/postgres.js";
import {
  quotationCases,
  datasetMetadata,
} from "../examples/supplier-quotes/cases.mjs";
import { digest, fromAccepted } from "../examples/supplier-quotes/domain.mjs";
import {
  scoreFields,
  aggregate,
  bootstrapByFamily,
  wilson,
} from "../examples/supplier-quotes/scoring.mjs";
import {
  PlainQuotationStore,
  migratePlain,
} from "../examples/supplier-quotes/plain-postgres.mjs";
import { OntaveQuotationStore } from "../examples/supplier-quotes/ontave-store.mjs";
const args = process.argv.slice(2),
  responsesPath = args.find((a) => a.startsWith("--responses="))?.slice(12);
for (const arg of args)
  if (!arg.startsWith("--responses="))
    throw Error(
      "Use --responses=/absolute/path/responses.json or no arguments for fixture verification",
    );
const input = responsesPath
  ? JSON.parse(await readFile(responsesPath, "utf8"))
  : null;
if (input)
  assert.equal(
    input.protocol.datasetHash,
    digest(quotationCases),
    "Dataset changed; do not silently rescore frozen trials against new labels",
  );
const trials =
  input?.results ??
  quotationCases.map((c) => ({
    trial: 1,
    id: c.id,
    family: c.family,
    split: c.split,
    output: c.expected,
    error: null,
    usage: null,
    durationMs: null,
  }));
const root = resolve(
  "artifacts/quotation-comparison",
  new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
);
await mkdir(root, { recursive: true });
const grants = new Map(),
  authorize = (context) => {
    if (!grants.has(context)) throw Error("UNAUTHORIZED");
    return grants.get(context);
  };
function contexts(workspaceId) {
  const result = {};
  for (const [name, capabilities] of Object.entries({
    owner: ["provision", "read", "ingest", "review", "worker"],
    ingester: ["ingest"],
    worker: ["worker"],
    reviewer: ["read", "review"],
    reader: ["read"],
  })) {
    const key = Symbol(name);
    grants.set(key, { actorId: name, workspaceId, capabilities });
    result[name] = key;
  }
  return result;
}
const dbAt = performance.now(),
  db = await disposablePostgres(),
  sharedDatabaseStartupMs = performance.now() - dbAt,
  pools = [];
const connections = {},
  schemaSetupMs = {},
  results = [];
try {
  for (const arm of ["plain", "ontave"]) {
    const name = "quotation_" + arm + "_" + randomUUID().replaceAll("-", ""),
      at = performance.now();
    await db.admin.query(`CREATE DATABASE "${name}"`);
    const adminUrl = new URL(db.admin.options.connectionString),
      runtimeUrl = new URL(db.connectionString);
    adminUrl.pathname = "/" + name;
    runtimeUrl.pathname = "/" + name;
    const admin = new Pool({ connectionString: adminUrl.href });
    pools.push(admin);
    if (arm === "plain") await migratePlain(admin, "ontave_runtime");
    else await migrate(admin, "ontave_runtime");
    connections[arm] = runtimeUrl.href;
    schemaSetupMs[arm] = performance.now() - at;
  }
  for (const trial of trials) {
    const c = quotationCases.find((c) => c.id === trial.id);
    assert.ok(c);
    const raw = scoreFields(trial.output, c.expected, c.text),
      arms = {};
    if (trial.error) {
      raw.documentExact = false;
      raw.f1 = 0;
    }
    // Counterbalance the local arm execution order across documents/trials.
    const order =
      (results.length + trial.trial) % 2
        ? ["plain", "ontave"]
        : ["ontave", "plain"];
    for (const arm of order) {
      const workspaceId = randomUUID(),
        ctx = contexts(workspaceId),
        setupAt = performance.now();
      let adapterInvocations = 0;
      const options = {
        connectionString: connections[arm],
        authorize,
        extract: async (text) => {
          assert.equal(text, c.text);
          adapterInvocations++;
          if (trial.error) throw Error("FROZEN_PROVIDER_FAILURE");
          return structuredClone(trial.output);
        },
      };
      const store =
        arm === "plain"
          ? new PlainQuotationStore(options)
          : new OntaveQuotationStore(options);
      const row = {
        state: null,
        error: null,
        setupMs: null,
        timing: {},
        adapterInvocations: 0,
        sourceAssertions: 0,
        unreviewedVisible: 0,
        accepted: null,
      };
      try {
        if (store.setup) await store.setup(ctx.owner, workspaceId);
        row.setupMs = performance.now() - setupAt;
        // Warm the connection in both arms. Ontave's schema bootstrap already uses its pool.
        assert.equal((await store.read(ctx.reader)).records.length, 0);
        let at = performance.now();
        const receipt = await store.ingest(ctx.ingester, {
          source: "frozen-supplier-quotation",
          id: c.id,
          text: c.text,
        });
        row.timing.ingestMs = performance.now() - at;
        assert.equal((await store.read(ctx.reader)).records.length, 0);
        at = performance.now();
        const processing = await store.process(ctx.worker);
        row.timing.processMs = performance.now() - at;
        if (processing?.error)
          row.error = {
            code: processing.error.code ?? processing.error,
            message: processing.error.message ?? null,
          };
        row.unreviewedVisible = (await store.read(ctx.reader)).records.length;
        assert.equal(row.unreviewedVisible, 0);
        const before = store.transactions ?? null;
        at = performance.now();
        let review = await store.review(ctx.reviewer, receipt.jobId);
        row.timing.reviewLoadMs = performance.now() - at;
        row.reviewLoadTransactions =
          before === null ? 1 : store.transactions - before;
        row.state = review.state;
        if (review.state === "waiting_review") {
          at = performance.now();
          await store.accept(ctx.reviewer, {
            bundleId: review.bundle.id,
            digest: review.bundle.digest,
            key: "scripted-accept",
            reason:
              "Scripted benchmark acceptance of the unchanged proposal; no human validation or fact verification",
          });
          row.timing.acceptMs = performance.now() - at;
          review = await store.review(ctx.reviewer, receipt.jobId);
          row.state = review.state;
        }
        at = performance.now();
        const accepted = await store.read(ctx.reader);
        row.timing.readMs = performance.now() - at;
        const neutral = fromAccepted(accepted.records);
        for (let n = 0; n < accepted.records.length; n++) {
          const entity = accepted.records[n],
            proof = await store.explain(ctx.reader, entity.id);
          for (const [field, value] of Object.entries(
            neutral.records[n].fields,
          )) {
            const assertion = proof.find(
              (p) =>
                p.id === value.assertionIds?.[0] &&
                p.evidence_id === receipt.evidenceId,
            );
            value.quote =
              assertion?.quote ??
              (assertion?.span
                ? Buffer.from(c.text)
                    .subarray(assertion.span.startByte, assertion.span.endByte)
                    .toString("utf8")
                : "");
            if (assertion) row.sourceAssertions++;
            assert.equal(
              value.verification,
              "reported",
              "Acceptance must not promote a supplier assertion to verified",
            );
          }
        }
        row.accepted = scoreFields(neutral, c.expected, c.text);
        row.acceptedRecords = accepted.records.length;
      } catch (error) {
        row.error = { code: error.code ?? error.message };
        row.accepted ??= scoreFields(null, c.expected, c.text);
      } finally {
        if (row.error && row.accepted) {
          row.accepted.documentExact = false;
          row.accepted.f1 = 0;
        }
        row.adapterInvocations = adapterInvocations;
        row.bootstrapFixtureCalls = store.bootstrapCalls ?? 0;
        await store.close();
      }
      arms[arm] = row;
    }
    const result = {
      trial: trial.trial,
      id: c.id,
      family: c.family,
      split: c.split,
      raw,
      providerError: trial.error,
      usage: trial.usage,
      providerDurationMs: trial.durationMs,
      arms,
    };
    results.push(result);
    await writeFile(
      resolve(root, `trial-${trial.trial}-${c.id}.json`),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(
      JSON.stringify({
        trial: trial.trial,
        id: c.id,
        rawF1: raw.f1,
        plain: arms.plain.state,
        ontave: arms.ontave.state,
        errors: [arms.plain.error, arms.ontave.error],
      }),
    );
  }
  const heldout = results.filter((r) => r.split === "holdout"),
    raw = aggregate(heldout.map((r) => r.raw));
  const arms = Object.fromEntries(
    ["plain", "ontave"].map((arm) => [
      arm,
      {
        accepted: aggregate(heldout.map((r) => r.arms[arm].accepted)),
        pipelineErrors: results
          .filter((r) => r.arms[arm].error)
          .map((r) => ({ id: r.id, trial: r.trial, ...r.arms[arm].error })),
        heldForModelOrReview: results.filter(
          (r) => r.arms[arm].state !== "completed",
        ).length,
        unreviewedVisibleRecords: results.reduce(
          (n, r) => n + r.arms[arm].unreviewedVisible,
          0,
        ),
        sourceAssertions: results.reduce(
          (n, r) => n + r.arms[arm].sourceAssertions,
          0,
        ),
        setupMs: results.map((r) => r.arms[arm].setupMs),
        timings: results.map((r) => r.arms[arm].timing),
        reviewLoadTransactions: results.map(
          (r) => r.arms[arm].reviewLoadTransactions,
        ),
        adapterReplayCalls: results.reduce(
          (n, r) => n + r.arms[arm].adapterInvocations,
          0,
        ),
        bootstrapFixtureCalls: results.reduce(
          (n, r) => n + r.arms[arm].bootstrapFixtureCalls,
          0,
        ),
      },
    ]),
  );
  const implementationFiles = [
    "src/runtime.ts",
    "dist/runtime.js",
    "examples/supplier-quotes/domain.mjs",
    "examples/supplier-quotes/plain-postgres.mjs",
    "examples/supplier-quotes/ontave-store.mjs",
    "examples/supplier-quotes/scoring.mjs",
    "scripts/compare-quotations.mjs",
  ];
  const implementationHashes = Object.fromEntries(
    await Promise.all(
      implementationFiles.map(async (f) => [
        f,
        createHash("sha256")
          .update(await readFile(f))
          .digest("hex"),
      ]),
    ),
  );
  const report = {
    version: "quotation-comparison-v1.4",
    createdAt: new Date().toISOString(),
    implementationHashes,
    mode: input
      ? "live-prediction-paired-replay"
      : "deterministic-fixture-verification",
    acquisitionStatus: input?.status ?? "not-live",
    responsesPath: responsesPath ?? null,
    dataset: datasetMetadata,
    datasetHash: digest(quotationCases),
    protocol: input?.protocol ?? null,
    documents: quotationCases.length,
    observations: results.length,
    rawExtraction: input
      ? {
          ...raw,
          microF1CI: bootstrapByFamily(
            heldout,
            (rs) => aggregate(rs.map((r) => r.raw)).microF1,
          ),
          exactDocumentCI: bootstrapByFamily(
            heldout,
            (rs) => aggregate(rs.map((r) => r.raw)).documentExact,
          ),
          frameworkUpliftClaimed: false,
        }
      : null,
    availability: input
      ? {
          documents: trials.length,
          successful: trials.filter((r) => !r.error).length,
          firstAttemptFailures: trials.filter(
            (r) => r.attempts?.[0]?.error ?? r.error,
          ).length,
          finalFailures: trials.filter((r) => r.error).length,
          inferenceAttempts: trials.reduce(
            (n, r) =>
              n +
              (r.attempts?.length ??
                (r.error?.code === "NOT_RUN_AFTER_FATAL_ERROR" ? 0 : 1)),
            0,
          ),
          unknownUsageAttempts: trials.reduce(
            (n, r) =>
              n +
              (r.attempts?.filter((a) => !a.usage).length ??
                (!r.usage ? 1 : 0)),
            0,
          ),
          note: "Retries and failures remain visible; shared by both arms.",
        }
      : null,
    fixtureCorrectness: input ? null : raw,
    arms,
    setup: {
      sharedDatabaseStartupMs,
      schemaSetupMs,
      scope:
        "Local automated dependency-ready schema creation and application bootstrap, shared warmed PostgreSQL; migration order plain then Ontave. Not human setup time or production provisioning.",
    },
    review: {
      mode: "Scripted acceptance of unchanged valid proposals, no oracle repairs",
      humanSeconds: null,
      independentParticipants: 0,
      fieldDifferencesNeedingAttention: heldout.reduce(
        (n, r) => n + r.raw.falsePositive + r.raw.missed,
        0,
      ),
      note: "Field differences are FP+FN, not clicks, edits or human time.",
    },
    stats: {
      unreviewedWrites: 0,
      unreviewedWriteWilsonUpper: wilson(0, results.length),
      note: "Repeated documents are correlated; binary interval is descriptive and not a production risk bound.",
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      memoryBytes: totalmem(),
      postgres: "18.4",
    },
    externalBenchmarks: {
      docile: {
        status: "pending-dataset-access-and-official-evaluator",
        officialScore: null,
      },
    },
    productionQualified: false,
    limitations: [
      "Original synthetic English text documents with maintainer-authored labels; independent source-label review pending.",
      "No OCR/PDF, production traffic, arbitrary domain, real supplier integration, bank confirmation or human time-saving claim.",
      "The same predictions are replayed into both arms; raw extraction is one shared measurement.",
      "Storage correctness, prompt injection and operational safety need separate adversarial checks.",
      "Human review and setup measurements are separate from this automated replay. Both connection pools are warmed before per-operation timings; schema bootstrap and database startup are separate.",
    ],
    results,
  };
  await writeFile(
    resolve(root, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  // A saved report is not a passing correctness check when an implementation failed.
  assert.deepEqual(
    arms.plain.accepted,
    arms.ontave.accepted,
    "Accepted-data scores diverged between paired implementations",
  );
  for (const row of results) {
    if (!row.providerError)
      for (const arm of ["plain", "ontave"])
        assert.equal(row.arms[arm].error, null, `${arm} failed on ${row.id}`);
    for (const arm of ["plain", "ontave"])
      assert.equal(row.arms[arm].unreviewedVisible, 0);
  }
  if (!input) assert.equal(raw.microF1, 1, "Authored fixture scoring failed");
  await mkdir("artifacts/quotation-comparison", { recursive: true });
  await writeFile(
    "artifacts/quotation-comparison/latest.json",
    JSON.stringify({ root, mode: report.mode }, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      root,
      mode: report.mode,
      rawExtraction: report.rawExtraction,
      errors: {
        plain: arms.plain.pipelineErrors,
        ontave: arms.ontave.pipelineErrors,
      },
      accepted: { plain: arms.plain.accepted, ontave: arms.ontave.accepted },
    }),
  );
} finally {
  for (const pool of pools) await pool.end();
  await db.stop();
}
