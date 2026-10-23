// Explicitly export fictional acquisition evidence. Never reads provider configuration.
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cases } from "../examples/adaptive-quotes/cases.mjs";
import {
  bootstrapByFamily,
  wilson,
} from "../examples/supplier-quotes/scoring.mjs";
import { totalScores } from "../examples/adaptive-quotes/scoring.mjs";
import assert from "node:assert/strict";
const arg = process.argv.slice(2);
assert.ok(
  arg.length === 1 && arg[0].startsWith("--inputs="),
  "Use --inputs=path/to/replay-manifest.json",
);
const inputs = JSON.parse(await readFile(arg[0].slice(9), "utf8"));
const root = "benchmarks/adaptation-2026-10-23";
const sha = (b) => createHash("sha256").update(b).digest("hex");
await mkdir(root, { recursive: true });
const acquisitions = {};
for (const [v, id] of Object.entries(inputs.runs)) {
  assert.match(id, /^[a-zA-Z0-9_.-]+$/);
  const source = "artifacts/adaptation-acquisition/" + id,
    dest = root + "/acquisition-" + v;
  assert.match(v, /^v[123]$/);
  await mkdir(dest, { recursive: true });
  await cp(source + "/frozen", dest + "/frozen", { recursive: true });
  const bytes = await readFile(source + "/responses.json"),
    run = JSON.parse(bytes);
  assert.ok(
    !/AIza[0-9A-Za-z_-]{35}|postgres(?:ql)?:\/\/|\/Users\//.test(
      bytes.toString(),
    ),
    "Private data must not enter public evidence",
  );
  await writeFile(dest + "/predictions.json", bytes);
  acquisitions[v] = {
    predictionsSha256: sha(bytes),
    attempts: run.results.length,
    errors: run.results.filter((r) => r.error).length,
    errorCodes: Object.fromEntries(
      Object.entries(
        Object.groupBy(
          run.results.filter((r) => r.error),
          (r) => r.error.code,
        ),
      ).map(([k, rs]) => [k, rs.length]),
    ),
    reportedTotalTokens: run.results.reduce(
      (n, r) => n + (r.usage?.totalTokenCount ?? 0),
      0,
    ),
    attemptsWithoutUsage: run.results.filter((r) => !r.usage).length,
    costUSD: null,
  };
}
const replays = {};
for (const [name, path] of Object.entries(inputs.outputs)) {
  assert.match(name, /^v[123]-(original|normalized)$/);
  const bytes = await readFile(path + "/report.json"),
    report = JSON.parse(bytes);
  await writeFile(root + "/replay-" + name + ".json", bytes);
  replays[name] = {
    reportSha256: sha(bytes),
    arms: Object.fromEntries(
      Object.entries(report.arms).map(([name, a]) => {
        const routine = report.results.filter((r) => r.scope === "routine"),
          durations = a.latencyMs.toSorted((a, b) => a - b),
          families = Object.values(Object.groupBy(routine, (r) => r.family));
        const { latencyMs, ...rest } = a;
        return [
          name,
          {
            ...rest,
            localProcessingMs: {
              median: durations[Math.floor(durations.length * 0.5)],
              p95: durations[Math.floor(durations.length * 0.95)],
              scope:
                "Cached model-plan replay plus storage, queries and scoring; excludes paid inference and first-time provisioning. Single local machine, not an SLO.",
            },
            routineEvents: {
              exact: routine.filter((r) => r.arms[name].score.exact).length,
              total: routine.length,
            },
            routineRecallFamilyBootstrap95: bootstrapByFamily(
              routine,
              (rs) => totalScores(rs.map((r) => r.arms[name].score)).recall,
            ),
            routineFamiliesAllTrialsExactWilson95: wilson(
              families.filter((rs) => rs.every((r) => r.arms[name].score.exact))
                .length,
              families.length,
            ),
          },
        ];
      }),
    ),
  };
}
const raw = await readFile("artifacts/adaptation-live-comparison.log", "utf8"),
  log = raw.replaceAll(process.cwd(), "<checkout>");
await writeFile(root + "/initial-guard-failure.log", log);
const summary = {
  createdAt: new Date().toISOString(),
  kind: "synthetic-development-shared-plan-comparison",
  acquisitions,
  replays,
  paidInferenceAttempts: Object.values(acquisitions).reduce(
    (n, a) => n + a.attempts,
    0,
  ),
  cases: cases.length,
  trials: 3,
  routineFamilies: 6,
  expectedCommitments: 39,
  frozenQueryChecksPerArm: 99,
  manualAdaptationReviews: 0,
  independentDevelopers: 0,
  developerTimeSaved: null,
  productionQualified: false,
  initialFailure: {
    sanitizedLogSha256: sha(log),
    pathRedactionOnly: true,
    reason:
      "Unknown Q999 was admitted as a new base record and changed a frozen query; existing-parent guard fixed in both arms. Regression tested. Final current-code replays are separate.",
  },
  limitations: [
    "Post-acquisition normalization developed on exposed cases. Original acquisitions and replays retained.",
    "Same model plans in both arms: no extraction uplift claim. Flexible baseline also supports metadata without physical migrations.",
    "Synthetic English maintainer labels, six routine families and correlated repeated trials. No independent holdout or developer effort study.",
    "Family intervals are descriptive small-set sensitivity, not population generalization confidence.",
    "No hosted service, global shipment identity, verified deliveries or production qualification.",
  ],
};
await writeFile(
  root + "/results.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    root,
    attempts: summary.paidInferenceAttempts,
    normalized: replays["v3-normalized"].arms.ontave.quality,
  }),
);
