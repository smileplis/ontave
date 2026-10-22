// Publish only the exact qualified alpha archive. No stable/MVP gate is waived.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { releaseGate } from "./release-gate.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run") || args.length > 1) {
  console.error("Use npm run publish:preview [-- --dry-run]");
  process.exitCode = 1;
} else {
  const gate = await releaseGate({ channel: "developer-preview" });
  if (!gate.ok) {
    console.error(JSON.stringify(gate, null, 2));
    process.exitCode = 1;
  } else {
    const report = JSON.parse(
      await readFile("artifacts/release-readiness.json", "utf8"),
    );
    const publish = spawn(
      "npm",
      [
        "publish",
        `./${report.artifacts.archive.path}`,
        "--registry=https://registry.npmjs.org",
        "--access=public",
        "--tag=latest",
        ...args,
      ],
      { stdio: "inherit" },
    );
    const code = await new Promise((resolve, reject) => {
      publish.once("error", reject);
      publish.once("exit", resolve);
    });
    process.exitCode = code ?? 1;
  }
}
