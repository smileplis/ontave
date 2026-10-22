// Exercise the installed archive in a clean consumer, including optional-tooling setup.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  packed = JSON.parse(
    await readFile(
      resolve(root, "artifacts/package-verification.json"),
      "utf8",
    ),
  );
const temporaryParent = resolve(
  packed.consumer,
  "long-temporary-path-for-postgresql-startup-without-unix-sockets",
);
await mkdir(temporaryParent, { recursive: true });
assert.ok(Buffer.byteLength(temporaryParent) > 103);
const at = performance.now();
let log = "",
  stderr = "",
  url,
  exited = false;
const child = spawn(
  process.execPath,
  [
    resolve(packed.consumer, "node_modules/ontave/dist/cli.js"),
    "playground",
    "--install",
    "--port",
    "0",
  ],
  {
    cwd: packed.consumer,
    env: {
      ...process.env,
      PATH: resolve(root, "node_modules/node/bin") + ":" + process.env.PATH,
      npm_config_cache: resolve(root, ".cache/npm"),
      TMPDIR: temporaryParent,
    },
  },
);
child.stdout.on("data", (chunk) => {
  log += chunk;
});
child.stderr.on("data", (chunk) => (stderr += chunk));
child.on("exit", () => (exited = true));
const exit = new Promise((resolve) =>
  child.once("exit", (code, signal) => resolve({ code, signal })),
);
try {
  await new Promise((res, rej) => {
    const timeout = setTimeout(
      () => rej(Error("Packed playground startup timed out")),
      120000,
    );
    child.once("error", rej);
    child.once("exit", () => {
      clearTimeout(timeout);
      if (!url)
        rej(
          Error(
            "Packed playground exited before startup: " + stderr.slice(-1000),
          ),
        );
    });
    child.stdout.on("data", () => {
      const match = log.match(/Ontave playground: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        url = match[1];
        clearTimeout(timeout);
        res();
      }
    });
  });
  const startupMs = performance.now() - at,
    workflowAt = performance.now(),
    page = await fetch(url),
    cookie = page.headers.get("set-cookie").split(";")[0];
  assert.equal(page.status, 200);
  const headers = {
    cookie,
    origin: url,
    "content-type": "application/json",
    "x-ontave-playground": "1",
  };
  const call = async (path, input) => {
    const response = await fetch(url + path, {
      method: input ? "POST" : "GET",
      headers,
      body: input ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const state = await response.json();
    assert.equal(response.status, 200, JSON.stringify(state));
    return state;
  };
  const phases = [];
  for (const scenario of ["roof", "payment"]) {
    let state = await call("/api/reset", { scenario });
    assert.equal(state.phase, "ready");
    assert.equal(state.records.length, 0);
    for (const action of ["interpret", "evaluate", "activate", "accept"]) {
      state = await call("/api/action", { action });
      phases.push(state.phase);
      if (action !== "accept") assert.equal(state.records.length, 0);
      assert.equal(state.earlierContract.readable, true);
    }
    assert.equal(state.records.length, 1);
    assert.equal(
      Object.values(state.records[0].fields)[0].verification,
      "reported",
    );
    assert.equal(state.usage.providerCalls, 0);
  }
  const forged = await fetch(url + "/api/action", {
    method: "POST",
    headers: { ...headers, origin: "https://unrelated.example" },
    body: JSON.stringify({ action: "interpret" }),
  });
  assert.equal(forged.status, 403);
  const report = {
    ok: true,
    node: process.version,
    version: packed.version,
    archiveSha256: createHash("sha256")
      .update(await readFile(packed.archive))
      .digest("hex"),
    consumer: packed.consumer,
    optionalToolingInstall: log.includes("Preparing isolated"),
    longTemporaryPathBytes: Buffer.byteLength(temporaryParent),
    startupMs,
    workflowMs: performance.now() - workflowAt,
    timingBoundary:
      "Local automated startup and operations; npm cache may be reused. Not human setup/review time.",
    phases,
    scenarios: 2,
    providerCalls: 0,
    crossSiteMutationDenied: true,
  };
  child.kill("SIGTERM");
  const stopped = await exit;
  assert.equal(stopped.code, 0);
  assert.ok(!stderr.includes("postgresql:"));
  report.cleanShutdown = true;
  await writeFile(
    resolve(root, "artifacts/playground-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (!exited) {
    child.kill("SIGTERM");
    await exit;
  }
  await rm(temporaryParent, { recursive: true, force: true });
}
