// Explicit opt-in live evaluation. Frozen three-trial protocol, no automatic retries or corrections.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { hash } from "../dist/index.js";
import { validateExtraction } from "../dist/core.js";
import { scoreExtraction } from "../dist/evaluation.js";
import { mistral } from "../dist/models/mistral.js";
import { openrouter } from "../dist/models/openrouter.js";
import { gemini } from "../dist/models/gemini.js";
process.loadEnvFile(".env");
if (!process.argv.includes("--live"))
  throw Error(
    "Explicit --live required; this sends only fictional fixtures to Gemini",
  );
const provider = process.argv.includes("--mistral")
  ? "mistral"
  : process.argv.includes("--openrouter")
    ? "openrouter"
    : "gemini";
const modelName = process.env[provider.toUpperCase() + "_MODEL"];
const labels = JSON.parse(
  await readFile("fixtures/release-v1/labels.json", "utf8"),
);
const equivalences = process.argv.includes("--description-equivalences")
  ? JSON.parse(
      await readFile(
        "fixtures/release-v1/description-equivalences.json",
        "utf8",
      ),
    )
  : null;
if (equivalences)
  for (const label of labels)
    for (const expected of label.expected) {
      const rule = equivalences.rules.find(
        (r) =>
          r.conceptId === expected.conceptId && r.fieldId === expected.fieldId,
      );
      if (rule)
        expected.equivalentValues = rule.values.filter(
          (v) => v !== expected.value,
        );
    }
const { definitions } = JSON.parse(
  await readFile("fixtures/release-v1/definitions.json", "utf8"),
);
const root = resolve(
  "artifacts/semantic-trials",
  new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
);
await mkdir(root, { recursive: true });
const files = [
  "src/models/gemini.ts",
  "src/models/schema.ts",
  "src/models/prompt.ts",
  "src/models/chat.ts",
  "scripts/run-semantic-trials.mjs",
  ...(equivalences
    ? ["fixtures/release-v1/description-equivalences.json"]
    : []),
  "src/evaluation.ts",
  "src/core.ts",
  "package-lock.json",
  "fixtures/release-v1/labels.json",
  "fixtures/release-v1/definitions.json",
];
const fileHashes = Object.fromEntries(
  await Promise.all(
    files.map(async (f) => [f, hash(await readFile(f, "utf8"))]),
  ),
);
const protocol = {
  version: equivalences
    ? "frozen-raw-assertions-v3-text-equivalence"
    : "frozen-raw-assertions-v2-constrained-sources",
  frozenAt: new Date().toISOString(),
  model: modelName,
  provider,
  trials: 3,
  recordsPerTrial: 60,
  expectedAssertionsPerTrial: 179,
  callLimit: 180,
  automaticRetries: 0,
  concurrency: process.argv.includes("--concurrency-two") ? 2 : 1,
  minimumCallIntervalMs: provider === "gemini" ? 6000 : 1200,
  deadlinePerCallMs: 45000,
  maxOutputTokens: 4096,
  inputGuard:
    provider === "gemini"
      ? "provider tokenizer, 16384 tokens"
      : "15360 bytes of complete encoded request; conservative guard, no certified token preflight",
  thresholds: { rawPrecision: 0.95, rawRecall: 0.9 },
  scoring:
    "One-to-one normalized concept/field/value/verification match and verbatim source containment. Extra claims are false positives; abstentions/refusals retain all expected claims as misses. Invalid complete responses receive zero correct and retain their raw proposal count. Relationship/observation metrics separate. No human corrections change raw scores.",
  sourceVerification:
    "Only host fixture sourcePolicy fictional-bank-receipt authorizes payment_confirmation.amount verification.",
  independentAnnotationReview: false,
  equivalences,
  sourceDateConstraint:
    "Calendar date fields require ISO date shape at the provider boundary; relative source expressions remain unresolved.",
  liveIdentityScope:
    "No established identity candidates supplied. Unavailable IDs are raw proposals, not actual merges; the direct trial writes no canonical data. Unexpected existing IDs count as false merges; abstention is not a correct merge. Linking accuracy requires separate trusted-identity trials.",
  developmentChanges:
    "Explicit source anchoring for text <=1024 bytes, required fields for new concepts, per-concept field dialect, IDs restricted to authorized candidate enums; earlier failed experiments retained. Selected ministral-14b-2512 before any new trial scores. No changes during these three trials.",
  candidateGeneration:
    "Approved fixture definitions supplied explicitly; this tests extraction, not autonomous domain discovery. Labels are never sent to the adapter.",
  fileHashes,
  labelsHash: hash(labels),
  definitionsHash: hash(definitions),
  node: process.version,
};
await writeFile(
  root + "/protocol.json",
  JSON.stringify(protocol, null, 2) + "\n",
  { flag: "wx" },
);
for (const file of files) {
  const destination = resolve(root, "frozen-sources", file);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await writeFile(destination, await readFile(file), { flag: "wx" });
}

const adapter = { gemini, mistral, openrouter }[provider]({
  apiKey: process.env[provider.toUpperCase() + "_API_KEY"],
  model: modelName,
});
const results = [];
let index = 0,
  lastCallAt = 0,
  nextSlot = 0,
  haltReason;
function rawCount(output) {
  return Array.isArray(output?.entities)
    ? output.entities.reduce(
        (n, e) =>
          n +
          (e?.fields && typeof e.fields === "object"
            ? Object.keys(e.fields).length
            : 0),
        0,
      )
    : 0;
}
const tasks = Array.from({ length: 3 }, (_, trial) =>
  labels.map((label) => ({ trial: trial + 1, label })),
).flat();
const save = async () =>
  writeFile(
    root + "/progress.json",
    JSON.stringify(
      { completed: results.length, total: tasks.length },
      null,
      2,
    ) + "\n",
  );
await Promise.all(
  Array.from({ length: protocol.concurrency }, async () => {
    for (;;) {
      const n = index++;
      if (n >= tasks.length) return;
      const { trial, label } = tasks[n],
        at = performance.now();
      let response, error, metrics;
      try {
        if (haltReason)
          throw Object.assign(new Error(haltReason), {
            code: "NOT_RUN_AFTER_FATAL_PROVIDER_ERROR",
          });
        const slot = Math.max(Date.now(), nextSlot);
        nextSlot = slot + protocol.minimumCallIntervalMs;
        const wait = slot - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastCallAt = Date.now();
        response = await adapter.extract({
          text: label.text,
          kind: "text",
          ontology: definitions[label.domain],
          candidates: [],
          verifiedFields:
            label.sourcePolicy === "fictional-bank-receipt"
              ? ["payment_confirmation.amount"]
              : [],
          signal: AbortSignal.timeout(45000),
        });
        await writeFile(
          root + `/trial-${trial}-${label.id}-raw.json`,
          JSON.stringify(response, null, 2) + "\n",
          { flag: "wx" },
        );
        const extraction = validateExtraction(
          structuredClone(response.output),
          label.text,
          definitions[label.domain],
        );
        metrics = scoreExtraction(
          extraction,
          {
            kind: "extract",
            expected: label.expected,
            relationships: label.relationships,
            observations: label.observations,
          },
          definitions[label.domain],
          label.text,
        );
      } catch (e) {
        error = {
          code: e.code ?? "OPERATION_FAILED",
          message: e.message,
          outcome: e.details?.outcome ?? "unknown",
        };
        if (!haltReason && /HTTP (400|401|402|403|429)/.test(e.message))
          haltReason =
            "Stopped new inference calls after a fatal request, credential, credit or quota failure: " +
            e.message;
      }
      const proposed = rawCount(response?.output),
        fields = metrics?.fields ?? {
          correct: 0,
          proposed,
          expected: label.expected.length,
          falsePositive: proposed,
          missed: label.expected.length,
        };
      const result = {
        trial,
        inputId: label.id,
        domain: label.domain,
        durationMs: performance.now() - at,
        fields,
        relationships: metrics?.relationships ?? null,
        observations: metrics?.observations ?? null,
        unexpectedExistingIds:
          response?.output?.entities?.filter((e) => e.existingId).length ?? 0,
        reviewBurden: {
          proposedEntities: response?.output?.entities?.length ?? 0,
          observations: response?.output?.observations?.length ?? 0,
          correctionsRequired: fields.falsePositive + fields.missed,
          humanSeconds: null,
        },
        model: response?.model ?? protocol.model,
        usage: response?.usage ?? null,
        error: error ?? null,
      };
      await writeFile(
        root + `/trial-${trial}-${label.id}-score.json`,
        JSON.stringify(result, null, 2) + "\n",
        { flag: "wx" },
      );
      results.push(result);
      await save();
    }
  }),
);
const sum = (rs, key) => rs.reduce((n, r) => n + r.fields[key], 0);
const trials = Array.from({ length: 3 }, (_, n) => {
  const rows = results.filter((r) => r.trial === n + 1),
    correct = sum(rows, "correct"),
    proposed = sum(rows, "proposed"),
    expected = sum(rows, "expected"),
    precision = proposed ? correct / proposed : 0,
    recall = correct / expected;
  return {
    trial: n + 1,
    records: rows.length,
    correct,
    proposed,
    expected,
    precision,
    recall,
    falsePositive: sum(rows, "falsePositive"),
    missed: sum(rows, "missed"),
    providerOrValidationFailures: rows.filter(
      (r) => r.error && r.error.code !== "NOT_RUN_AFTER_FATAL_PROVIDER_ERROR",
    ).length,
    notRun: rows.filter(
      (r) => r.error?.code === "NOT_RUN_AFTER_FATAL_PROVIDER_ERROR",
    ).length,
    unexpectedIDProposals: rows.reduce(
      (n, r) => n + r.unexpectedExistingIds,
      0,
    ),
    rawTargetsPassed:
      rows.every(
        (r) => r.error?.code !== "NOT_RUN_AFTER_FATAL_PROVIDER_ERROR",
      ) &&
      precision >= 0.95 &&
      recall >= 0.9,
    domains: ["solar", "rental"].map((domain) => {
      const r = rows.filter((x) => x.domain === domain),
        tp = sum(r, "correct"),
        p = sum(r, "proposed"),
        g = sum(r, "expected");
      return {
        domain,
        correct: tp,
        proposed: p,
        expected: g,
        precision: p ? tp / p : 0,
        recall: tp / g,
      };
    }),
    review: {
      correctionsRequired: rows.reduce(
        (n, r) => n + r.reviewBurden.correctionsRequired,
        0,
      ),
      unresolvedObservations: rows.reduce(
        (n, r) => n + r.reviewBurden.observations,
        0,
      ),
      humanSeconds: null,
    },
    usageRows: rows.filter((r) => r.usage !== null).length,
  };
});
const report = {
  protocol,
  status: haltReason ? "incomplete" : "complete",
  haltReason: haltReason ?? null,
  finishedAt: new Date().toISOString(),
  trials,
  allThreeRawTargetsPassed: trials.every((t) => t.rawTargetsPassed),
  npmReleaseApproved: false,
  remainingGates: [
    "Independent annotation review",
    "End-to-end governed discovery and reviewed publication on both domains",
    "Acceptance coverage audit; live thresholds alone do not certify the MVP",
  ],
  results: results.sort(
    (a, b) => a.trial - b.trial || a.inputId.localeCompare(b.inputId),
  ),
};
await writeFile(root + "/report.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
await writeFile(
  "artifacts/semantic-trials/latest.json",
  JSON.stringify(
    {
      path: root,
      allThreeRawTargetsPassed: report.allThreeRawTargetsPassed,
      trials,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    path: root,
    trials,
    allThreeRawTargetsPassed: report.allThreeRawTargetsPassed,
  }),
);
