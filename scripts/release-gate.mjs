// Local guard only. It never authenticates, publishes, provisions or modifies a service.
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
export const requiredGates = [
  "deterministic",
  "domains",
  "recovery",
  "consumers",
  "security",
  "acceptance",
  "annotations",
  "semantic",
  "ci",
  "walkthrough",
];
export function reportBlockers(report, version, digest) {
  const blockers = [];
  if (report.version !== version)
    blockers.push("Readiness evidence belongs to another package version.");
  if (report.sourceDigest !== digest)
    blockers.push("Source changed after qualification evidence was recorded.");
  for (const id of requiredGates) {
    const matches = (report.gates ?? []).filter((g) => g.id === id);
    if (matches.length !== 1)
      blockers.push(`Missing or duplicated required gate: ${id}.`);
    else if (matches[0].passed !== true)
      blockers.push(
        matches[0].requirement ?? `Required gate ${id} has not passed.`,
      );
  }
  for (const name of [
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
  ]) {
    const artifact = report.artifacts?.[name];
    if (
      !artifact ||
      !/^artifacts\/[a-zA-Z0-9_./-]+$/.test(artifact.path ?? "") ||
      artifact.path.split("/").includes("..") ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")
    )
      blockers.push(`Missing or invalid evidence binding: ${name}.`);
  }
  return blockers;
}
export async function sourceDigest() {
  const compiled = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      files.push(...(entry.isDirectory() ? await compiled(path) : [path]));
    }
    return files;
  };
  // Bind SQL, documentation, public fixtures and compiled package files as well
  // as source/tests. Ignored credentials, raw trials and research stay excluded.
  const files = [
    ...new Set([
      ...execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean),
      ...(await compiled("dist")),
    ]),
  ].sort();
  const hashes = [];
  for (const file of files)
    hashes.push([
      file,
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    ]);
  return {
    digest: createHash("sha256").update(JSON.stringify(hashes)).digest("hex"),
    files: hashes,
  };
}
export async function releaseGate() {
  const blockers = [];
  let report;
  try {
    report = JSON.parse(
      await readFile("artifacts/release-readiness.json", "utf8"),
    );
  } catch {
    blockers.push(
      "Generate current release-readiness evidence; no qualifying report exists.",
    );
  }
  if (report) {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    blockers.push(
      ...reportBlockers(report, pkg.version, (await sourceDigest()).digest),
    );
    for (const [name, artifact] of Object.entries(report.artifacts ?? {})) {
      if (
        !/^artifacts\/[a-zA-Z0-9_./-]+$/.test(artifact.path ?? "") ||
        artifact.path.split("/").includes("..")
      )
        continue;
      try {
        if (
          createHash("sha256")
            .update(await readFile(artifact.path))
            .digest("hex") !== artifact.sha256
        )
          blockers.push(`Qualification evidence changed: ${name}.`);
      } catch {
        blockers.push(`Qualification evidence unavailable: ${name}.`);
      }
    }
  }
  return { ok: !blockers.length, publicationAttempted: false, blockers };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await releaseGate();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error(
      JSON.stringify({
        ok: false,
        publicationAttempted: false,
        blockers: [
          "Unable to validate local qualification evidence. Run from the source checkout.",
        ],
      }),
    );
    process.exitCode = 1;
  }
}
