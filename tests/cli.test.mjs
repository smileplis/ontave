import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir(resolve("artifacts"), { recursive: true });
const run = (args) =>
  spawnSync(process.execPath, [resolve("dist/cli.js"), ...args], {
    encoding: "utf8",
  });
test("CLI invalid arguments and missing config return safe JSON without stack traces", () => {
  for (const args of [
    ["--unknown"],
    ["--input"],
    ["ingest"],
    ["unknown-command"],
    ["--yes=false"],
    ["playground", "--port", "NaN"],
    ["playground", "--port", "-1"],
    ["playground", "--port", "65536"],
    ["playground", "--port", "1.5"],
  ]) {
    const r = run(args);
    assert.equal(r.status, 1);
    const e = JSON.parse(r.stderr);
    assert.equal(e.code, "INVALID_INPUT");
    assert.ok(!r.stderr.includes("at file:"));
  }
});
test("CLI version follows the artifact and init preserves an existing file", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(run(["version"]).stdout.trim(), pkg.version);
  const dir = await mkdtemp(resolve("artifacts/cli-")),
    file = resolve(dir, "config.mjs");
  assert.equal(run(["init", "--output", file]).status, 0);
  const original = await readFile(file, "utf8");
  assert.equal(run(["init", "--output", file]).status, 1);
  assert.equal(await readFile(file, "utf8"), original);
});
test("CLI rejects invalid worker actions and malformed input before effects", async () => {
  const dir = await mkdtemp(resolve("artifacts/cli-config-")),
    file = resolve(dir, "config.mjs");
  await writeFile(
    file,
    'export default {context:null,runtime:{close:async()=>{},worker:{runOnce:()=>{throw Error("MUST NOT EXECUTE")}}}};',
  );
  for (const args of [
    ["worker", "invalid-action", "--config", file],
    ["ingest", "--config", file],
    ["ontology", "publish", "--config", file],
  ]) {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stderr).code, "INVALID_INPUT");
    assert.ok(!r.stderr.includes("MUST NOT EXECUTE"));
  }
});
