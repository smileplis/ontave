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
export const previewRequiredGates = [
  "deterministic",
  "domains",
  "recovery",
  "consumers",
  "security",
  "ci",
];
const fullArtifacts = [
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
];
const previewArtifacts = [
  ...fullArtifacts.filter((name) => name !== "website"),
  "ci",
  "playground",
];
const channels = ["qualified", "developer-preview"];
export function reportBlockers(report, version, digest, channel = "qualified") {
  const blockers = [];
  if (!channels.includes(channel))
    return ["Unknown release channel; use qualified or developer-preview."];
  if (report.version !== version)
    blockers.push("Readiness evidence belongs to another package version.");
  if (report.sourceDigest !== digest)
    blockers.push("Source changed after qualification evidence was recorded.");
  for (const id of requiredGates) {
    const matches = (report.gates ?? []).filter((g) => g.id === id);
    if (matches.length !== 1)
      blockers.push(`Missing or duplicated required gate: ${id}.`);
    else if (typeof matches[0].passed !== "boolean")
      blockers.push(`Invalid gate result: ${id}.`);
    else if (
      matches[0].passed !== true &&
      (channel === "qualified" || previewRequiredGates.includes(id))
    )
      blockers.push(
        matches[0].requirement ?? `Required gate ${id} has not passed.`,
      );
  }
  if (channel === "developer-preview") {
    if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version))
      blockers.push(
        "Developer-preview distribution requires an explicit alpha version.",
      );
    if (
      report.release?.channel !== channel ||
      report.release?.fullMvpQualified !== false ||
      !/^[a-f0-9]{64}$/.test(report.release?.statusSha256 ?? "")
    )
      blockers.push(
        "Preview distribution requires a bound, explicit alpha qualification disclosure.",
      );
    const deferred = (report.gates ?? [])
      .filter((g) => g.passed === false)
      .map((g) => g.id);
    if (deferred.some((id) => !(report.release?.openGates ?? []).includes(id)))
      blockers.push(
        "The preview disclosure must list every open qualification gate.",
      );
  }
  for (const name of channel === "qualified"
    ? fullArtifacts
    : previewArtifacts) {
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
export async function releaseGate({ channel = "qualified" } = {}) {
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
      ...reportBlockers(
        report,
        pkg.version,
        (await sourceDigest()).digest,
        channel,
      ),
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
    if (channel === "developer-preview") {
      try {
        const statusBytes = await readFile("docs/RELEASE_STATUS.json");
        const status = JSON.parse(statusBytes);
        if (
          createHash("sha256").update(statusBytes).digest("hex") !==
            report.release?.statusSha256 ||
          status.version !== pkg.version ||
          status.channel !== channel ||
          status.fullMvpQualified !== false ||
          (report.release?.openGates ?? []).some(
            (id) =>
              !status.openGates?.some(
                (g) =>
                  g.id === id &&
                  typeof g.reason === "string" &&
                  g.reason.trim(),
              ),
          )
        )
          blockers.push(
            "Packaged alpha status does not match the reviewed preview disclosure.",
          );
        if (
          execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim() ||
          execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim() !== report.revision
        )
          blockers.push(
            "Preview publishing requires the clean, committed qualification revision.",
          );
        const ci = JSON.parse(await readFile(report.artifacts.ci.path, "utf8"));
        if (ci.headSha !== report.revision || ci.conclusion !== "success")
          blockers.push(
            "Preview CI did not pass on the exact qualification revision.",
          );
        for (const name of ["node", "next", "playground"]) {
          const consumer = JSON.parse(
            await readFile(report.artifacts[name].path, "utf8"),
          );
          if (
            (consumer.tarballSha256 ?? consumer.archiveSha256) !==
            report.artifacts.archive.sha256
          )
            blockers.push(`Preview ${name} consumer used a different archive.`);
        }
      } catch {
        blockers.push(
          "Preview qualification/disclosure evidence is unavailable or invalid.",
        );
      }
    }
  }
  return {
    ok: !blockers.length,
    channel,
    publicationAttempted: false,
    blockers,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && !args[0].startsWith("--channel=")))
      throw new Error("Unsupported release-gate argument");
    const result = await releaseGate({
      channel: args[0]?.slice("--channel=".length) ?? "qualified",
    });
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
