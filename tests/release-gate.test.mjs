import test from "node:test";
import assert from "node:assert/strict";
import {
  requiredGates,
  reportBlockers,
  sourceDigest,
} from "../scripts/release-gate.mjs";
test("qualification digest binds SQL, docs and compiled package output", async () => {
  const result = await sourceDigest(),
    paths = result.files.map(([path]) => path);
  for (const required of [
    "migrations/004_worker_events.sql",
    "README.md",
    "docs/QUALITY_REPORT.md",
    "dist/cli.js",
    "package.json",
    "tests/cli.test.mjs",
  ])
    assert.ok(paths.includes(required), required);
  assert.ok(
    !paths.some(
      (path) =>
        path === ".env" ||
        path.startsWith("research/") ||
        path.startsWith("artifacts/"),
    ),
  );
});
test("publication guard requires every gate and content-bound artifact", () => {
  const report = {
    version: "test",
    sourceDigest: "digest",
    gates: requiredGates.map((id) => ({ id, passed: true })),
    artifacts: Object.fromEntries(
      [
        "unit",
        "integration",
        "domains",
        "restore",
        "load",
        "benefits",
        "package",
        "node",
        "next",
        "website",
        "public",
        "isolation",
        "audit",
        "semantic",
        "archive",
      ].map((id) => [
        id,
        { path: `artifacts/${id}.json`, sha256: "a".repeat(64) },
      ]),
    ),
  };
  assert.deepEqual(reportBlockers(report, "test", "digest"), []);
  assert.ok(
    reportBlockers(
      { ...report, gates: [{ id: "deterministic", passed: true }] },
      "test",
      "digest",
    ).length >= 9,
  );
  assert.ok(reportBlockers(report, "changed", "digest").length);
  assert.ok(reportBlockers(report, "test", "changed").length);
  const failed = structuredClone(report);
  failed.gates.find((g) => g.id === "annotations").passed = false;
  assert.ok(
    reportBlockers(failed, "test", "digest").some((x) =>
      x.includes("annotations"),
    ),
  );
  const unbound = structuredClone(report);
  delete unbound.artifacts.archive;
  assert.ok(
    reportBlockers(unbound, "test", "digest").some((x) =>
      x.includes("archive"),
    ),
  );
  const traversal = structuredClone(report);
  traversal.artifacts.archive.path = "artifacts/../private.txt";
  assert.ok(
    reportBlockers(traversal, "test", "digest").some((x) =>
      x.includes("archive"),
    ),
  );
});
