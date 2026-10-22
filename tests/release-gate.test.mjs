import test from "node:test";
import assert from "node:assert/strict";
import {
  requiredGates,
  reportBlockers,
  sourceDigest,
  previewRequiredGates,
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

test("alpha distribution preserves full-MVP blockers and requires explicit disclosure of every open gate", () => {
  const artifacts = Object.fromEntries(
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
      "public",
      "isolation",
      "audit",
      "semantic",
      "archive",
      "ci",
      "playground",
    ].map((name) => [
      name,
      { path: `artifacts/${name}.json`, sha256: "a".repeat(64) },
    ]),
  );
  const openGates = requiredGates.filter(
    (id) => !previewRequiredGates.includes(id),
  );
  const report = {
    version: "0.1.0-alpha.4",
    sourceDigest: "digest",
    gates: requiredGates.map((id) => ({
      id,
      passed: previewRequiredGates.includes(id),
    })),
    artifacts,
    release: {
      channel: "developer-preview",
      fullMvpQualified: false,
      statusSha256: "b".repeat(64),
      openGates,
    },
  };
  assert.deepEqual(
    reportBlockers(report, report.version, "digest", "developer-preview"),
    [],
  );
  assert.ok(
    reportBlockers(report, report.version, "digest").length >= 4,
    "default/full qualification remains blocked",
  );
  for (const id of previewRequiredGates) {
    const failed = structuredClone(report);
    failed.gates.find((g) => g.id === id).passed = false;
    assert.ok(
      reportBlockers(
        failed,
        report.version,
        "digest",
        "developer-preview",
      ).some((b) => b.includes(id)),
    );
  }
  for (const version of ["0.1.0", "0.1.0-rc.1", "0.1.0-alpha", "invalid"]) {
    const changed = { ...report, version };
    assert.ok(
      reportBlockers(changed, version, "digest", "developer-preview").some(
        (b) => b.includes("alpha version"),
      ),
    );
  }
  const hidden = structuredClone(report);
  hidden.release.openGates = [];
  assert.ok(
    reportBlockers(hidden, report.version, "digest", "developer-preview").some(
      (b) => b.includes("every open"),
    ),
  );
  const misleading = structuredClone(report);
  misleading.release.fullMvpQualified = true;
  assert.ok(
    reportBlockers(
      misleading,
      report.version,
      "digest",
      "developer-preview",
    ).some((b) => b.includes("disclosure")),
  );
  assert.ok(
    reportBlockers(report, report.version, "digest", "typo").some((b) =>
      b.includes("Unknown release"),
    ),
  );
  assert.ok(
    reportBlockers(report, report.version, "changed", "developer-preview").some(
      (b) => b.includes("Source changed"),
    ),
  );
  const unbound = structuredClone(report);
  delete unbound.artifacts.archive;
  assert.ok(
    reportBlockers(unbound, report.version, "digest", "developer-preview").some(
      (b) => b.includes("archive"),
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
