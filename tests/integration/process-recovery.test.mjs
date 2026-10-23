import test from "node:test";
import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { writeFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createOntave, starter } from "../../dist/index.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function message(child, event) {
  for (;;) {
    const [m] = await once(child, "message", {
      signal: AbortSignal.timeout(5000),
    });
    if (m.event === event) return m;
  }
}

test("real process death, restart and CLI shutdown preserve work and usage uncertainty", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID(),
    children = [];
  const app = createOntave({
    storage: db.storage,
    authorize: () => ({
      actorId: "owner",
      workspaceId: w,
      capabilities: ["provision", "read", "ingest", "worker", "review"],
    }),
    model: fixtureAdapter((task) => personFixture(task.text)),
    limits: { leaseMs: 300 },
  });
  t.after(async () => {
    for (const c of children)
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    await app.close();
    await db.stop();
  });
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Process faults",
    requestKey: "create",
    seed: "people",
  });
  const contract = await app.contracts.register(null, starter);
  const query = {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  };
  const child = (mode) => {
    const c = fork(resolve("tests/helpers/worker-child.mjs"), [], {
      execPath: process.execPath,
      env: {
        ...process.env,
        ONTAVE_TEST_DATABASE: db.connectionString,
        ONTAVE_TEST_WORKSPACE: w,
        ONTAVE_TEST_MODE: mode,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(c);
    return c;
  };
  await t.test(
    "SIGKILL after claim is recovered by a fresh process without canonical side effects",
    async () => {
      const receipt = await app.ingest(null, {
        source: "fault",
        idempotencyKey: "kill",
        payload: { kind: "text", text: "Recovered" },
      });
      const old = child("hang");
      await message(old, "inference-started");
      const exited = once(old, "exit");
      old.kill("SIGKILL");
      await exited;
      assert.equal(
        (await app.jobs.get(null, receipt.job_id)).state,
        "processing",
      );
      assert.equal((await app.entities.find(null, query)).records.length, 0);
      await delay(400);
      const restarted = child("fast"),
        result = (await message(restarted, "result")).result;
      await once(restarted, "exit");
      assert.equal(result.state, "waiting_review");
      const events = await app.jobs.attempts(null, receipt.job_id);
      assert.equal(events.filter((x) => x.event === "started").length, 2);
      assert.equal(events.filter((x) => x.event === "lease_expired").length, 1);
      assert.equal(
        events.find((x) => x.event === "lease_expired").details.usage,
        "unknown",
      );
      const b = await app.reviews.get(null, result.bundleId),
        request = {
          bundleId: b.id,
          digest: b.hash,
          requestKey: "accept-recovered",
          reason: "Checked recovered fictional work",
        };
      assert.deepEqual(
        await app.reviews.accept(null, request),
        await app.reviews.accept(null, request),
      );
      assert.equal((await app.entities.find(null, query)).records.length, 1);
      assert.equal((await app.jobs.get(null, receipt.job_id)).calls, 2);
    },
  );
  await t.test(
    "SIGKILL after the worker result commits leaves one durable review bundle and no duplicate inference",
    async () => {
      const r = await app.ingest(null, {
        source: "fault",
        idempotencyKey: "result-ack-lost",
        payload: { kind: "text", text: "Committed" },
      });
      const c = child("kill-after-result");
      const [, signal] = await once(c, "exit");
      assert.equal(signal, "SIGKILL");
      assert.equal(
        (await app.jobs.get(null, r.job_id)).state,
        "waiting_review",
      );
      await delay(400);
      assert.equal(await app.worker.runOnce(null), null);
      const rows = (
        await db.admin.query(
          "SELECT id,hash FROM ontave.bundles WHERE job_id=$1",
          [r.job_id],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal((await app.jobs.get(null, r.job_id)).calls, 1);
      assert.equal((await app.entities.find(null, query)).records.length, 1);
      const request = {
        bundleId: rows[0].id,
        digest: rows[0].hash,
        requestKey: "accept-committed",
        reason: "Review durable committed result",
      };
      await app.reviews.accept(null, request);
      await app.reviews.accept(null, request);
      assert.equal((await app.entities.find(null, query)).records.length, 2);
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.assertions WHERE evidence_id=$1",
            [r.evidence_id],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  const dir = await mkdtemp(resolve("artifacts/worker-cli-"));
  const config = resolve(dir, "config.mjs");
  await writeFile(
    config,
    `import {createOntave} from ${JSON.stringify(pathToFileURL(resolve("dist/index.js")).href)};import {postgres} from ${JSON.stringify(pathToFileURL(resolve("dist/postgres.js")).href)};import {personFixture} from ${JSON.stringify(pathToFileURL(resolve("dist/testing.js")).href)};export default()=>({context:"test",runtime:createOntave({storage:postgres({connectionString:process.env.ONTAVE_TEST_DATABASE}),authorize:()=>({actorId:"cli",workspaceId:process.env.ONTAVE_TEST_WORKSPACE,capabilities:["worker"]}),limits:{leaseMs:30000},model:{async extract(task){process.send?.({event:"inference-started"});if(process.env.ONTAVE_TEST_MODE==="hang")await new Promise(()=>{});else await new Promise(r=>setTimeout(r,200));return {output:personFixture(task.text),model:"cli-fixture",usage:{totalTokens:0}};}}})});`,
  );
  const cli = (mode) => {
    const c = fork(resolve("dist/cli.js"), ["worker", "--config", config], {
      execPath: process.execPath,
      env: {
        ...process.env,
        ONTAVE_TEST_DATABASE: db.connectionString,
        ONTAVE_TEST_WORKSPACE: w,
        ONTAVE_TEST_MODE: mode,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.push(c);
    return c;
  };
  await t.test(
    "SIGTERM drains one in-flight call and stops new claims",
    async () => {
      const first = await app.ingest(null, {
        source: "fault",
        idempotencyKey: "drain",
        payload: { kind: "text", text: "Drained" },
      });
      const c = cli("fast");
      await message(c, "inference-started");
      const second = await app.ingest(null, {
        source: "fault",
        idempotencyKey: "queued",
        payload: { kind: "text", text: "Queued" },
      });
      const exit = once(c, "exit");
      c.kill("SIGTERM");
      assert.equal((await exit)[0], 0);
      assert.equal(
        (await app.jobs.get(null, first.job_id)).state,
        "waiting_review",
      );
      assert.equal((await app.jobs.get(null, second.job_id)).state, "queued");
      await app.worker.runOnce(null);
    },
  );
  await t.test(
    "unresponsive in-flight CLI call exits within the bounded drain and can be reclaimed",
    async () => {
      const r = await app.ingest(null, {
        source: "fault",
        idempotencyKey: "hung",
        payload: { kind: "text", text: "Hung" },
      });
      const c = cli("hang");
      await message(c, "inference-started");
      const at = Date.now(),
        exit = once(c, "exit");
      c.kill("SIGTERM");
      assert.equal((await exit)[0], 0);
      const elapsed = Date.now() - at;
      assert.ok(
        elapsed >= 9500 && elapsed < 13000,
        `Hung drain took ${elapsed} ms`,
      );
      assert.equal((await app.jobs.get(null, r.job_id)).state, "processing");
      // The drain test uses a long lease so scheduler jitter cannot turn it into
      // a lease-loss test. Advance expiry only after the original process exits.
      // Real elapsed-lease recovery is exercised by the SIGKILL tests above.
      await db.admin.query(
        "UPDATE ontave.jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [r.job_id],
      );
      assert.equal((await app.worker.runOnce(null)).state, "waiting_review");
      assert.equal(
        (await app.jobs.attempts(null, r.job_id)).filter(
          (x) => x.event === "lease_expired",
        ).length,
        1,
      );
      assert.equal((await app.jobs.get(null, r.job_id)).calls, 2);
    },
  );
  await t.test(
    "process death after committed receipts and approvals cannot duplicate effects on retry",
    async () => {
      const effect = async (operation, request) => {
        const c = fork(resolve("tests/helpers/effect-child.mjs"), [], {
          execPath: process.execPath,
          env: {
            ...process.env,
            ONTAVE_TEST_DATABASE: db.connectionString,
            ONTAVE_TEST_WORKSPACE: w,
            ONTAVE_TEST_OPERATION: operation,
            ONTAVE_TEST_REQUEST: JSON.stringify(request),
          },
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        children.push(c);
        const [code, signal] = await once(c, "exit");
        assert.equal(signal, "SIGKILL");
      };
      const input = {
        source: "lost-ack",
        idempotencyKey: "1",
        payload: { kind: "text", text: "LostAck" },
      };
      await effect("ingest", input);
      const receipt = await app.ingest(null, input);
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.evidence WHERE workspace_id=$1 AND source='lost-ack'",
            [w],
          )
        ).rows[0].count,
        "1",
      );
      const work = await app.worker.runOnce(null),
        b = await app.reviews.get(null, work.bundleId),
        request = {
          bundleId: b.id,
          digest: b.hash,
          requestKey: "lost-ack-accept",
          reason: "Fictional checked effect whose acknowledgement was lost",
        };
      await effect("accept", request);
      await app.reviews.accept(null, request);
      assert.equal(
        (await app.jobs.get(null, receipt.job_id)).state,
        "completed",
      );
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.assertions WHERE evidence_id=$1",
            [receipt.evidence_id],
          )
        ).rows[0].count,
        "1",
      );
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.decisions WHERE request_key='lost-ack-accept'",
            [],
          )
        ).rows[0].count,
        "1",
      );
    },
  );

  await t.test(
    "repeated process death consumes the reserved budget and cannot create an infinite retry loop",
    async () => {
      const receipt = await app.ingest(null, {
        source: "fault",
        idempotencyKey: "repeated-kill",
        payload: { kind: "text", text: "Budgeted" },
      });
      for (let i = 0; i < 2; i++) {
        const c = child("hang");
        await message(c, "inference-started");
        const exit = once(c, "exit");
        c.kill("SIGKILL");
        await exit;
        await delay(400);
      }
      const result = await app.worker.runOnce(null);
      assert.equal(result.exhausted, true);
      const job = await app.jobs.get(null, receipt.job_id);
      assert.equal(job.state, "failed");
      assert.equal(job.calls, 2);
      assert.equal(job.attempts, 2);
      assert.equal(job.error.code, "BUDGET_EXHAUSTED");
      const events = await app.jobs.attempts(null, receipt.job_id);
      assert.equal(events.filter((x) => x.event === "started").length, 2);
      assert.equal(events.filter((x) => x.event === "lease_expired").length, 2);
      const row = (
        await db.admin.query(
          "SELECT lease_owner,lease_until FROM ontave.jobs WHERE id=$1",
          [receipt.job_id],
        )
      ).rows[0];
      assert.equal(row.lease_owner, null);
      assert.equal(row.lease_until, null);
      assert.equal(await app.worker.runOnce(null), null);
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*) FROM ontave.assertions WHERE evidence_id=$1",
            [receipt.evidence_id],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
});
