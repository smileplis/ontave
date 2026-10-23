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
  const quotationChecks = [];
  for (const approve of [false, true]) {
    let stdout = "",
      stderr = "",
      answered = false;
    const quote = spawn(
      process.execPath,
      ["node_modules/ontave/examples/supplier-quotes/run.mjs"],
      { cwd: consumer, env },
    );
    const timeout = setTimeout(() => quote.kill("SIGKILL"), 30000);
    quote.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!answered && stdout.includes("Type accept to approve")) {
        answered = true;
        quote.stdin.end(approve ? "accept\n" : "\n");
      }
    });
    quote.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    let exit;
    try {
      exit = await new Promise((ok, fail) => {
        quote.once("error", fail);
        quote.once("exit", ok);
      });
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(exit, 0, stderr);
    assert.equal(answered, true);
    const start = stdout.lastIndexOf('{\n  "kind": "accepted-data"');
    assert.ok(start >= 0, "Standalone example did not return accepted data");
    const final = JSON.parse(stdout.slice(start));
    assert.equal(final.records.length, approve ? 2 : 0);
    if (approve) {
      const line = final.records.find((r) => r.conceptId === "quote_line");
      assert.equal(line.fields.unit_price.value.amount, "12500");
      assert.equal(line.fields.unit_price.verification, "reported");
    }
    quotationChecks.push({
      approved: approve,
      acceptedRecords: final.records.length,
      automated: true,
    });
  }
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
        quotationChecks,
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
