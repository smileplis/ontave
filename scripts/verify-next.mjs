// Clean packed Next.js consumer; only fictional canary credentials, no live provider calls.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  cp,
  readdir,
  mkdir,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { realpath } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import net from "node:net";
import assert from "node:assert/strict";
import { createOntave } from "../dist/index.js";
import { fixtureAdapter, personFixture } from "../dist/testing.js";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
).version;
const dir = await mkdtemp(resolve(await realpath(tmpdir()), "ontave-next-"));
await cp(resolve(root, "examples/next-server"), dir, {
  recursive: true,
  filter: (p) => !p.includes("node_modules") && !p.includes(".next"),
});
const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf8"));
pkg.dependencies.ontave =
  "file:" + resolve(root, `artifacts/ontave-${version}.tgz`);
await writeFile(resolve(dir, "package.json"), JSON.stringify(pkg, null, 2));
let output = "";
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  npm_config_cache: resolve(root, ".cache/npm"),
  PATH: resolve(root, "node_modules/node/bin") + ":" + process.env.PATH,
  ONTAVE_DEMO_MODE: "fixture",
  ONTAVE_DATABASE_URL:
    "postgresql://ontave-db-secret-canary:fictional@127.0.0.1:1/unused",
  GEMINI_API_KEY: "ontave-provider-secret-canary-do-not-bundle",
  GEMINI_MODEL: "not-called",
  ONTAVE_LOCAL_TOKEN: "ontave-local-credential-canary-123456789",
  ONTAVE_CURSOR_SECRET: "ontave-cursor-secret-canary-123456789",
};
async function run(bin, args, options = {}) {
  let log = "";
  const child = spawn(bin, args, { cwd: dir, env, ...options });
  child.stdout.on("data", (x) => (log += x));
  child.stderr.on("data", (x) => (log += x));
  const code = await new Promise((res, rej) => {
    child.on("error", rej);
    child.on("exit", res);
  });
  if (code !== 0) throw new Error(log.slice(-8000));
  return log;
}
await run("npm", [
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  ...(process.argv.includes("--offline") ? ["--offline"] : []),
]);
await writeFile(
  resolve(root, "artifacts/next-consumer-lock.json"),
  await readFile(resolve(dir, "package-lock.json")),
);
await writeFile(
  resolve(root, "artifacts/next-build.log"),
  await run(process.execPath, [
    "node_modules/next/dist/bin/next",
    "build",
    "--webpack",
  ]),
);
async function files(p) {
  const out = [];
  for (const entry of await readdir(p, { withFileTypes: true })) {
    const q = resolve(p, entry.name);
    out.push(...(entry.isDirectory() ? await files(q) : [q]));
  }
  return out;
}
const assets = await files(resolve(dir, ".next/static"));
const patterns = [
  env.GEMINI_API_KEY,
  env.ONTAVE_LOCAL_TOKEN,
  env.ONTAVE_CURSOR_SECRET,
  "ONTAVE_DATABASE_URL",
  "ontave-db-secret-canary",
  "GEMINI_API_KEY",
  "generativelanguage.googleapis.com",
  "pg-connection-string",
  "node-postgres",
];
for (const asset of assets) {
  const content = await readFile(asset, "utf8");
  for (const needle of patterns)
    assert.ok(
      !content.includes(needle),
      "Server value/dependency found in browser output",
    );
}
const db = await disposablePostgres();
let server;
const workspaceId = randomUUID();
const app = createOntave({
  storage: db.storage,
  model: fixtureAdapter((task) => personFixture(task.text)),
  authorize: () => ({
    actorId: "test-owner",
    workspaceId,
    capabilities: ["read", "ingest", "review", "worker", "provision"],
  }),
});
try {
  await app.workspaces.create(null, {
    workspaceId,
    name: "Next consumer",
    seed: "people",
    requestKey: "create",
  });
  const port = await new Promise((res, rej) => {
    const s = net.createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      String(port),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: dir,
      env: {
        ...env,
        ONTAVE_WORKSPACE_ID: workspaceId,
        ONTAVE_DATABASE_URL: db.connectionString,
      },
    },
  );
  server.stdout.on("data", (x) => (output += x));
  server.stderr.on("data", (x) => (output += x));
  const url = "http://127.0.0.1:" + port;
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Next server did not start");
  const body = {
    source: "consumer",
    idempotencyKey: "1",
    payload: { kind: "text", text: "Asha" },
  };
  const post = (data, authorized = true) =>
    fetch(url + "/api/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorized
          ? { authorization: "Bearer " + env.ONTAVE_LOCAL_TOKEN }
          : {}),
      },
      body: JSON.stringify(data),
    });
  assert.equal((await post(body, false)).status, 401);
  assert.equal(
    (
      await post({
        ...body,
        workspaceId: randomUUID(),
        capabilities: ["review"],
      })
    ).status,
    400,
  );
  const response = await post(body);
  assert.equal(response.status, 202);
  const receipt = await response.json();
  const headers = { authorization: "Bearer " + env.ONTAVE_LOCAL_TOKEN };
  assert.equal(
    (
      await (
        await fetch(url + "/api/jobs/" + receipt.job_id, { headers })
      ).json()
    ).state,
    "queued",
  );
  const work = await app.worker.runOnce(null);
  assert.equal(work.state, "waiting_review");
  assert.equal(
    (
      await (
        await fetch(url + "/api/jobs/" + receipt.job_id, { headers })
      ).json()
    ).state,
    "waiting_review",
  );
  await writeFile(
    resolve(root, "artifacts/next-verification.json"),
    JSON.stringify(
      {
        consumer: dir,
        node: process.version,
        next: pkg.dependencies.next,
        react: pkg.dependencies.react,
        tarballInstalled: true,
        tarballSha256: createHash("sha256")
          .update(
            await readFile(resolve(root, `artifacts/ontave-${version}.tgz`)),
          )
          .digest("hex"),
        build: true,
        clientAssetsChecked: assets.length,
        secretCanariesAbsent: true,
        unauthorizedDenied: true,
        forgedPrivilegesDenied: true,
        ingest202: true,
        independentWorkerStatus: true,
        liveModelCalls: 0,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Next packed consumer built, browser assets checked, authenticated routes and independent worker verified",
  );
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((res) => {
      server.once("exit", res);
      setTimeout(() => {
        server.kill("SIGKILL");
        res();
      }, 3000).unref();
    });
  }
  await app.close();
  await db.stop();
}

const demoPath = resolve(dir, "app/demo.tsx");
const originalDemo = await readFile(demoPath, "utf8");
try {
  await writeFile(
    demoPath,
    "'use client';\nimport {getRuntime} from '../lib/runtime';\nexport default function Demo(){return <button onClick={()=>getRuntime()}>Invalid server import</button>;}\n",
  );
  let rejected = false;
  try {
    await run(process.execPath, [
      "node_modules/next/dist/bin/next",
      "build",
      "--webpack",
    ]);
  } catch (error) {
    rejected = String(error.message).includes("server-only");
    await writeFile(
      resolve(root, "artifacts/next-negative-import.log"),
      String(error.message),
    );
  }
  assert.ok(rejected, "Next must reject a client import of the server runtime");
  const saved = JSON.parse(
    await readFile(resolve(root, "artifacts/next-verification.json"), "utf8"),
  );
  saved.clientImportOfServerRuntimeRejected = true;
  await writeFile(
    resolve(root, "artifacts/next-verification.json"),
    JSON.stringify(saved, null, 2) + "\n",
  );
  console.log("Next rejects importing server runtime into a client component");
} finally {
  await writeFile(demoPath, originalDemo);
}
