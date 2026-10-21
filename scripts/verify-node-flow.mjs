// Run the checked-in public-import Node example against the installed tarball in a clean consumer.
import { spawn } from "node:child_process";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
const report = JSON.parse(
  await readFile("artifacts/package-verification.json", "utf8"),
);
const consumer = report.consumer,
  db = await disposablePostgres();
try {
  await copyFile("examples/node/demo.mjs", resolve(consumer, "demo.mjs"));
  const env = {
    ...process.env,
    ONTAVE_DATABASE_URL: db.connectionString,
    ONTAVE_WORKSPACE_ID: randomUUID(),
  };
  let output = "",
    error = "";
  const child = spawn(process.execPath, ["demo.mjs"], { cwd: consumer, env });
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (error += x));
  const code = await new Promise((res, rej) => {
    child.once("error", rej);
    child.once("exit", res);
  });
  assert.equal(code, 0, error);
  const data = JSON.parse(output);
  assert.equal(data.result.records[0].fields.name.value, "Rahul");
  assert.equal(data.result.records[0].fields.name.verification, "reported");
  await writeFile(
    "artifacts/node-flow-verification.json",
    JSON.stringify(
      {
        ok: true,
        consumer,
        node: process.version,
        mode: data.mode,
        tarballVersion: report.version,
        tarballSha256: createHash("sha256")
          .update(await readFile(report.archive))
          .digest("hex"),
        receipt: data.receipt,
        result: data.result,
        liveCalls: 0,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Installed tarball Node example preserved, reviewed and read a fictional record",
  );
} finally {
  await db.storage.close();
  await db.stop();
}
