// Publish only explicitly selected fictional benchmark evidence, never private study configuration.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  aggregate,
  bootstrapByFamily,
  wilson,
} from "../examples/supplier-quotes/scoring.mjs";
import { digest } from "../examples/supplier-quotes/domain.mjs";
import { quotationCases } from "../examples/supplier-quotes/cases.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    assert.match(a, /^--(?:initial|followup|study|output)=.+/);
    const i = a.indexOf("=");
    return [a.slice(2, i), a.slice(i + 1)];
  }),
);
for (const key of ["initial", "followup", "study", "output"])
  assert.ok(args[key], `Required --${key}=path`);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const load = async (path) => {
  const bytes = await readFile(path);
  return { data: JSON.parse(bytes), sha256: sha(bytes) };
};
const stat = (values) => {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  return a.length
    ? {
        n: a.length,
        median: a[Math.floor(a.length / 2)],
        p95: a[Math.ceil(a.length * 0.95) - 1],
        min: a[0],
        max: a.at(-1),
      }
    : null;
};
function breakdown(rows, select) {
  return Object.fromEntries(
    Object.entries(Object.groupBy(rows, select)).map(([k, rs]) => [
      k,
      aggregate(rs.map((r) => r.raw)),
    ]),
  );
}
function byField(rows) {
  const out = {};
  for (const row of rows)
    for (const [name, c] of Object.entries(row.raw.byField)) {
      out[name] ??= { correct: 0, proposed: 0, expected: 0 };
      for (const k of ["correct", "proposed", "expected"]) out[name][k] += c[k];
    }
  for (const c of Object.values(out)) {
    c.precision = c.proposed ? c.correct / c.proposed : null;
    c.recall = c.expected ? c.correct / c.expected : null;
    c.f1 =
      c.proposed + c.expected ? (2 * c.correct) / (c.proposed + c.expected) : 1;
  }
  return out;
}
async function summarize(path, name) {
  const report = await load(path),
    r = report.data,
    acquisition = await load(r.responsesPath),
    input = acquisition.data;
  assert.equal(r.datasetHash, digest(quotationCases));
  assert.equal(input.protocol.datasetHash, r.datasetHash);
  const heldout = r.results.filter((x) => x.split === "holdout"),
    families = Object.values(Object.groupBy(heldout, (x) => x.family));
  const attempts = input.results.flatMap(
    (x) =>
      x.attempts ??
      (x.error?.code === "NOT_RUN_AFTER_FATAL_ERROR"
        ? []
        : [{ error: x.error, usage: x.usage }]),
  );
  const availability = {
    documentTasks: input.results.length,
    successfulDocuments: input.results.filter((x) => !x.error).length,
    finalFailures: input.results.filter((x) => x.error).length,
    firstAttemptFailures: input.results.filter(
      (x) => x.attempts?.[0]?.error ?? x.error,
    ).length,
    inferenceAttempts: attempts.length,
    retriesUsed:
      attempts.length -
      input.results.filter((x) => x.durationMs !== null).length,
    retriesAllowedPerDocument: input.protocol.automaticRetries,
    unknownUsageAttempts: attempts.filter((a) => !a.usage).length,
    reportedInputTokens: attempts.reduce(
      (n, a) => n + (a.usage?.promptTokenCount ?? 0),
      0,
    ),
    reportedOutputTokens: attempts.reduce(
      (n, a) => n + (a.usage?.candidatesTokenCount ?? 0),
      0,
    ),
    monetaryCost: null,
  };
  const arms = Object.fromEntries(
    ["plain", "ontave"].map((arm) => [
      arm,
      {
        accepted: aggregate(heldout.map((x) => x.arms[arm].accepted)),
        heldoutStates: Object.fromEntries(
          Object.entries(Object.groupBy(heldout, (x) => x.arms[arm].state)).map(
            ([k, v]) => [k, v.length],
          ),
        ),
        unreviewedVisibleRecords: r.results.reduce(
          (n, x) => n + x.arms[arm].unreviewedVisible,
          0,
        ),
        pipelineErrors: r.results.filter((x) => x.arms[arm].error).length,
        reviewLoadTransactions: [
          ...new Set(r.results.map((x) => x.arms[arm].reviewLoadTransactions)),
        ],
        machineMs: {
          workspaceBootstrap: stat(r.results.map((x) => x.arms[arm].setupMs)),
          ...Object.fromEntries(
            ["ingestMs", "processMs", "reviewLoadMs", "acceptMs", "readMs"].map(
              (k) => [k, stat(r.results.map((x) => x.arms[arm].timing[k]))],
            ),
          ),
        },
      },
    ]),
  );
  const predictions = {
    protocol: input.protocol,
    status: input.status,
    halt: input.halt,
    results: input.results,
  };
  const payload = JSON.stringify(predictions, null, 2) + "\n";
  await writeFile(resolve(args.output, `${name}-predictions.json`), payload);
  return {
    protocol: input.protocol.version,
    model: input.protocol.model,
    acquisitionFrozenAt: input.protocol.frozenAt,
    reportSha256: report.sha256,
    acquisitionSha256: acquisition.sha256,
    publicPredictionsSha256: sha(payload),
    availability,
    heldout: {
      ...aggregate(heldout.map((x) => x.raw)),
      distinctFamilies: families.length,
      microF1Cluster95: bootstrapByFamily(
        heldout,
        (rs) => aggregate(rs.map((x) => x.raw)).microF1,
      ),
      allTrialsExactFamilyWilson95: wilson(
        families.filter((rs) => rs.every((x) => x.raw.documentExact)).length,
        families.length,
      ),
      byTrial: breakdown(heldout, (x) => x.trial),
      byFamily: breakdown(heldout, (x) => x.family),
      byField: byField(heldout),
    },
    arms,
    machineSetup: r.setup,
    environment: r.environment,
    acquisitionFiles: input.protocol.fileHashes,
    replayImplementationHashes: r.implementationHashes ?? null,
  };
}
await mkdir(resolve(args.output), { recursive: true });
const initial = await summarize(args.initial, "initial"),
  followup = await summarize(args.followup, "followup"),
  study = await load(args.study),
  s = study.data;
assert.equal(s.automated, false);
assert.ok(s.finishedAt);
assert.equal(s.setup.length, 2);
assert.equal(s.review.length, 6);
const human = {
  reportSha256: study.sha256,
  sessionKind: s.sessionKind,
  participants: s.participants,
  independentParticipants: s.independentParticipants,
  setupOrder: s.setupOrder,
  implementationLabels: s.implementationLabels,
  candidateArchiveSha256: s.candidateArchiveSha256,
  baselineHashes: s.baselineHashes,
  setup: s.setup,
  review: Object.fromEntries(
    ["plain", "ontave"].map((arm) => {
      const tasks = s.review.filter((x) => x.arm === arm),
        injected = tasks.filter((x) => x.predeclaredInjectedError);
      return [
        arm,
        {
          tasks: tasks.length,
          activeMs: tasks.reduce((n, t) => n + t.activeMs, 0),
          amendActions: tasks.reduce((n, t) => n + t.amendActions, 0),
          decisions: tasks.map((t) => ({
            id: t.documentId,
            decision: t.decision,
            activeMs: t.activeMs,
            amendActions: t.amendActions,
            injectedError: t.predeclaredInjectedError,
            acceptedCorrect: t.acceptedScore.correct,
            acceptedProposed: t.acceptedScore.proposed,
          })),
          injectedErrors: injected.length,
          flawedProposalsKeptOut: injected.filter(
            (x) => x.decision !== "accept",
          ).length,
          accepted: aggregate(tasks.map((t) => t.acceptedScore)),
        },
      ];
    }),
  ),
  limitations: s.limitations,
};
const sourceFiles = [
  "src/runtime.ts",
  "src/cli.ts",
  "examples/next-server/lib/runtime.ts",
  "examples/supplier-quotes/domain.mjs",
  "examples/supplier-quotes/plain-postgres.mjs",
  "examples/supplier-quotes/ontave-store.mjs",
  "examples/supplier-quotes/scoring.mjs",
  "scripts/compare-quotations.mjs",
  "scripts/summarize-quotations.mjs",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (f) => [f, sha(await readFile(f))])),
);
const result = {
  schemaVersion: 1,
  date: "2026-10-23",
  candidateVersion: JSON.parse(await readFile("package.json", "utf8")).version,
  datasetHash: digest(quotationCases),
  initial,
  followup,
  human,
  integration: {
    modelRequiredFor:
      "Workers, inference evaluations and generated proposals only; ingest/read/review can omit it.",
    reviewSnapshot: {
      previousTransactions: 3,
      currentTransactions: 1,
      verification:
        "tests/integration/review-integration.test.mjs; real PostgreSQL, same bundle hash and evidence",
    },
  },
  sourceHashes,
  external: {
    docile: {
      officialScore: null,
      status:
        "Pending organizer-approved dataset access and official evaluator run",
      adapter: "scripts/evaluate-docile.mjs",
    },
  },
  productionQualified: false,
  limitations: [
    "Original synthetic English text, 8 development and 16 held-out families, labels authored by the maintainer before acquisition. Independent labels and new holdouts remain pending.",
    "Both implementations replay identical predictions; no raw extraction uplift is attributable to Ontave.",
    "Follow-up reused exposed cases and allowed two transient retries, but actually used zero retries. It demonstrates neither causal retry improvement nor new holdout generalization.",
    "A perfect empirical bootstrap can degenerate to [1,1]; the distinct-family Wilson interval describes limited binary evidence, not a calibrated production bound.",
    "Unknown observations hold the whole bundle in both implementations, lowering accepted-data coverage. They are not silently discarded.",
    "Human results cover one project maintainer with guided installation on pre-provisioned storage and injected review errors. No population productivity or full deployment setup claim.",
    "Reported token usage excludes failures with unknown usage and token-count preflight requests; monetary cost was not independently reconciled.",
    "The general framework qualification gates remain open; no production SLO, security certification or official DocILE score is claimed.",
  ],
};
await writeFile(
  resolve(args.output, "results.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    output: resolve(args.output, "results.json"),
    initial: initial.heldout,
    followup: followup.heldout,
    availability: followup.availability,
    human: human.review,
  }),
);
