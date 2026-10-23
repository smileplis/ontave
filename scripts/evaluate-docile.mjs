// Invoke the official evaluator on an explicitly supplied, authorized local dataset.
// No download, signup, OCR, extraction, label generation or invented leaderboard score.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
const args = process.argv.slice(2),
  allowed = ["dataset", "predictions", "manifest", "task", "split", "arm"];
const options = {};
for (const arg of args) {
  const match = /^--([a-z]+)=(.+)$/.exec(arg);
  if (!match || !allowed.includes(match[1]) || match[1] in options)
    throw Error(
      "Use --dataset= --predictions= --manifest= --task=KILE|LIR --split=val --arm=plain|ontave",
    );
  options[match[1]] = match[2];
}
if (!args.length) {
  console.log(
    JSON.stringify(
      {
        status: "pending-dataset-access",
        officialScore: null,
        reason:
          "DocILE requires organizer-approved dataset access and official evaluator predictions with page/bounding-box coordinates.",
        instructions: "https://docile.rossum.ai/",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (
  !["KILE", "LIR"].includes(options.task) ||
  options.split !== "val" ||
  !["plain", "ontave"].includes(options.arm)
)
  throw Error(
    "Explicit KILE/LIR, val split and plain/ontave arm required; official held-out test uses organizer submission",
  );
for (const key of ["dataset", "predictions", "manifest"])
  if (!options[key] || !isAbsolute(options[key]))
    throw Error("Provide explicit absolute local paths");
await stat(options.dataset);
if ((await stat(options.predictions)).size > 268435456)
  throw Error("Predictions exceed the 256 MiB wrapper profile");
const bytes = await readFile(options.predictions),
  predictions = JSON.parse(bytes);
if (
  !predictions ||
  typeof predictions !== "object" ||
  Array.isArray(predictions) ||
  !Object.keys(predictions).length
)
  throw Error(
    "Predictions must map document IDs to evaluation arrays (empty arrays permit abstention)",
  );
for (const rows of Object.values(predictions)) {
  if (!Array.isArray(rows)) throw Error("Each document maps to an array");
  for (const p of rows) {
    if (
      !Number.isInteger(p.page) ||
      p.page < 0 ||
      !Array.isArray(p.bbox) ||
      p.bbox.length !== 4 ||
      p.bbox.some((n) => !Number.isFinite(n) || n < 0 || n > 1) ||
      p.bbox[0] >= p.bbox[2] ||
      p.bbox[1] >= p.bbox[3] ||
      typeof p.fieldtype !== "string" ||
      !p.fieldtype
    )
      throw Error("Invalid official-format page/bbox/fieldtype");
    if (options.task === "LIR" && !Number.isInteger(p.line_item_id))
      throw Error("LIR requires line-item grouping");
  }
}
const root = resolve(
  "artifacts/docile",
  new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
);
await mkdir(root, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let evaluatorVersion;
try {
  evaluatorVersion = execFileSync(
    "python3",
    [
      "-c",
      "from importlib.metadata import version; print(version('docile-benchmark'))",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
} catch {
  throw Error(
    "Install docile-benchmark in an isolated Python environment; use its official installation instructions",
  );
}
const output = resolve(root, "official-evaluation.json"),
  command = [
    "--task",
    options.task,
    "--dataset-path",
    options.dataset,
    "--split",
    options.split,
    "--predictions",
    options.predictions,
    "--evaluate-fieldtypes",
    "--evaluate-also-text",
    "--store-evaluation-result",
    output,
  ];
const metadata = {
  createdAt: new Date().toISOString(),
  arm: options.arm,
  task: options.task,
  split: options.split,
  evaluator: "docile_evaluate",
  evaluatorVersion,
  predictionsSha256: hash(bytes),
  datasetManifestSha256: hash(await readFile(options.manifest)),
  datasetPath: options.dataset,
  officialResultPath: output,
  extractionPerformed: false,
  frameworkAccuracyClaim: false,
};
await writeFile(
  resolve(root, "invocation.json"),
  JSON.stringify(metadata, null, 2) + "\n",
  { flag: "wx" },
);
let log = "";
const child = spawn("docile_evaluate", command, {
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    if (log.length < 8388608) log += chunk;
  });
const code = await new Promise((ok, fail) => {
  child.once("error", () =>
    fail(Error("Official docile_evaluate command unavailable")),
  );
  child.once("exit", ok);
});
await writeFile(resolve(root, "evaluator.log"), log);
if (code !== 0)
  throw Error("Official evaluator failed; retained diagnostics in " + root);
JSON.parse(await readFile(output, "utf8"));
console.log(
  JSON.stringify(
    { status: "completed-with-official-evaluator", ...metadata },
    null,
    2,
  ),
);
