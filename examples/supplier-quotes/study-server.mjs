// Local study controller, not application authentication or a public hosted service.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { digest } from "./domain.mjs";
import { scoreFields, aggregate } from "./scoring.mjs";
const keySchema = z.string().uuid();
const decisionSchema = z
  .object({
    requestKey: keySchema,
    bundleId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["accept", "reject", "hold"]),
  })
  .strict();
const amendSchema = z
  .object({
    requestKey: keySchema,
    bundleId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    output: z.unknown(),
  })
  .strict();
const equal = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
export async function startQuotationStudy({
  root,
  tasks,
  setups,
  candidateArchive,
  nodePath,
  port = 0,
  automated = false,
}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const frozenCandidate = resolve(root, "candidate.tgz");
  await copyFile(candidateArchive, frozenCandidate);
  const candidateArchiveSha256 = createHash("sha256")
    .update(await readFile(frozenCandidate))
    .digest("hex");
  const baselineHashes = {};
  await mkdir(resolve(root, "frozen-baseline"), { mode: 0o700 });
  for (const file of ["plain-postgres.mjs", "domain.mjs"]) {
    const bytes = await readFile(new URL(file, import.meta.url));
    await writeFile(resolve(root, "frozen-baseline", file), bytes);
    baselineHashes[file] = createHash("sha256").update(bytes).digest("hex");
  }
  const secret = randomBytes(32).toString("hex"),
    csrfCookie = "quotation_study=" + secret,
    setupNonce = randomBytes(32).toString("hex");
  const order =
      randomBytes(1)[0] % 2 ? ["ontave", "plain"] : ["plain", "ontave"],
    labels = Object.fromEntries(order.map((arm, i) => [arm, ["A", "B"][i]]));
  const sequence = [];
  for (let n = 0; n < 3; n++)
    for (const arm of order) sequence.push(tasks[arm][n]);
  const state = {
    started: false,
    finished: false,
    phase: "setup",
    setupIndex: 0,
    setupStarted: false,
    paused: false,
    index: 0,
    taskStarted: false,
    events: [],
    decisions: [],
    setupResults: [],
    activeMs: 0,
    lastStarted: null,
  };
  const responses = new Map();
  let origin,
    server,
    mutation = Promise.resolve();
  const clock = () => {
    if (state.lastStarted !== null) {
      state.activeMs += performance.now() - state.lastStarted;
      state.lastStarted = performance.now();
    }
  };
  const resetClock = () => {
    state.activeMs = 0;
    state.lastStarted = state.paused ? null : performance.now();
  };
  const pause = (paused) => {
    clock();
    state.paused = paused;
    state.lastStarted = paused ? null : performance.now();
  };
  const persist = async () => {
    const safe = {
      ...state,
      lastStarted: null,
      implementationLabels: labels,
      sessionDirectory: root,
    };
    await writeFile(
      resolve(root, "progress.json"),
      JSON.stringify(safe, null, 2) + "\n",
      { mode: 0o600 },
    );
  };
  const report = () => ({
    sessionKind: automated
      ? "automated study-harness verification"
      : "single-project-maintainer exploratory walkthrough",
    automated,
    independentParticipants: 0,
    participants: automated || !state.started ? 0 : 1,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt ?? null,
    implementationLabels: labels,
    setupOrder: order,
    candidateArchiveSha256,
    baselineHashes,
    setup: state.setupResults,
    review: state.decisions,
    sourceLabelReviewCompleted: false,
    results: Object.fromEntries(
      order.map((arm) => {
        const rows = state.decisions.filter((d) => d.arm === arm);
        return [
          arm,
          {
            tasks: rows.length,
            activeMs: rows.reduce((n, r) => n + r.activeMs, 0),
            amendActions: rows.reduce((n, r) => n + r.amendActions, 0),
            acceptedAccuracy: aggregate(rows.map((r) => r.acceptedScore)),
          },
        ];
      }),
    ),
    limitations: [
      "One founder/maintainer, no population-level productivity claim.",
      "Setup is guided package installation with pre-provisioned database/schema/workspace and a local candidate archive, not clean production deployment.",
      "Review proposals contain predeclared injected errors; these are not model error-rate observations.",
      "Active time is a pause-aware elapsed-time proxy; cognitive effort is not directly observed.",
      "Order and document contents are counterbalanced only within this small exploratory session.",
    ],
  });
  async function snapshot() {
    if (state.finished)
      return { started: true, finished: true, report: report() };
    if (state.phase === "setup")
      return {
        started: state.started,
        finished: false,
        phase: "setup",
        setupLabel: labels[order[state.setupIndex]],
        setupStarted: state.setupStarted,
        setupCommand: state.setupCommand ?? null,
        paused: state.paused,
      };
    const task = sequence[state.index];
    return {
      started: true,
      finished: false,
      phase: "review",
      index: state.index,
      total: sequence.length,
      armLabel: labels[task.arm],
      taskStarted: state.taskStarted,
      paused: state.paused,
      view: state.taskStarted
        ? await task.store.review(task.context, task.receipt.jobId)
        : null,
    };
  }
  async function prepareSetup(arm) {
    const dir = resolve(root, "setup-" + labels[arm]);
    await mkdir(dir, { mode: 0o700 });
    const candidate = frozenCandidate;
    const pkg = {
      name: "quotation-walkthrough-" + arm,
      private: true,
      type: "module",
      dependencies:
        arm === "ontave"
          ? { ontave: "file:" + candidate }
          : { pg: "8.23.1", zod: "4.6.7", "decimal.js": "10.6.0" },
    };
    await writeFile(
      resolve(dir, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
      { mode: 0o600 },
    );
    await writeFile(resolve(dir, "empty.npmrc"), "");
    await writeFile(resolve(dir, "global.npmrc"), "");
    for (const file of arm === "plain"
      ? ["plain-postgres.mjs", "domain.mjs"]
      : [])
      await copyFile(
        resolve(root, "frozen-baseline", file),
        resolve(dir, file),
      );
    await writeFile(
      resolve(dir, "private-config.json"),
      JSON.stringify(
        {
          ...setups[arm].config,
          arm,
          callback: origin + "/api/setup/complete",
          nonce: setupNonce,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    const common = `import assert from 'node:assert/strict';\nimport {readFile} from 'node:fs/promises';\nconst config=JSON.parse(await readFile(new URL('./private-config.json',import.meta.url),'utf8'));\nconst credential=Symbol('authenticated local owner');\nconst authorize=ctx=>{if(ctx!==credential)throw Error('Unauthorized');return {actorId:'walkthrough',workspaceId:config.workspaceId,capabilities:['read','ingest','review']};};\n`;
    const main =
      arm === "ontave"
        ? `import {createOntave} from 'ontave';\nimport {postgres} from 'ontave/postgres';\nconst app=createOntave({storage:postgres({connectionString:config.connectionString}),authorize});\ntry {const r=await app.ingest(credential,{source:'setup',idempotencyKey:'first-message',payload:{kind:'text',text:'Quotation SETUP-1'}});const view=await app.reviews.forJob(credential,r.job_id);assert.equal(view.evidence.payload,'Quotation SETUP-1');assert.equal(view.job.state,'queued');}finally{await app.close();}\n`
        : `import {PlainQuotationStore} from './plain-postgres.mjs';\nconst app=new PlainQuotationStore({connectionString:config.connectionString,authorize});\ntry {const r=await app.ingest(credential,{source:'setup',id:'first-message',text:'Quotation SETUP-1'});const view=await app.review(credential,r.jobId);assert.equal(view.evidence.text,'Quotation SETUP-1');assert.equal(view.state,'queued');}finally{await app.close();}\n`;
    await writeFile(
      resolve(dir, "app.mjs"),
      common +
        main +
        `const response=await fetch(config.callback,{method:'POST',headers:{'content-type':'application/json','x-setup-proof':config.nonce},body:JSON.stringify({arm:config.arm,ok:true})});assert.equal(response.status,200);console.log('Setup task passed. Return to the study page.');\n`,
      { mode: 0o600 },
    );
    return `cd ${shellQuote(dir)}\nenv PATH=${shellQuote(resolve(nodePath, ".."))}:"$PATH" npm install --userconfig=./empty.npmrc --globalconfig=./global.npmrc --cache=./fresh-cache --no-audit --no-fund\n${shellQuote(nodePath)} app.mjs`;
  }
  const send = (res, status, data) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  server = createServer(async (req, res) => {
    let release;
    try {
      if (req.headers.host !== new URL(origin).host)
        return send(res, 403, { error: "INVALID_HOST" });
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": csrfCookie + "; HttpOnly; SameSite=Strict; Path=/",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
          "x-content-type-options": "nosniff",
        });
        res.end(await readFile(new URL("./study-ui.html", import.meta.url)));
        return;
      }
      const cli =
        req.method === "POST" &&
        req.url === "/api/setup/complete" &&
        equal(req.headers["x-setup-proof"], setupNonce);
      if (
        !cli &&
        !(req.headers.cookie ?? "")
          .split(";")
          .some((c) => c.trim() === csrfCookie)
      )
        return send(res, 403, { error: "SESSION_REQUIRED" });
      if (req.method === "GET" && req.url === "/api/state")
        return send(res, 200, await snapshot());
      if (req.method === "GET" && req.url === "/api/report")
        return send(res, 200, report());
      if (req.method !== "POST") return send(res, 404, { error: "NOT_FOUND" });
      if (
        !cli &&
        (req.headers.origin !== origin ||
          req.headers["x-quotation-study"] !== "1" ||
          req.headers["sec-fetch-site"] === "cross-site")
      )
        return send(res, 403, { error: "SAME_ORIGIN_REQUIRED" });
      let size = 0,
        chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) return send(res, 413, { error: "BODY_TOO_LARGE" });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(res, 400, { error: "INVALID_JSON" });
      }
      const previousMutation = mutation;
      mutation = new Promise((ok) => {
        release = ok;
      });
      await previousMutation;
      if (cli) {
        const input = z
          .object({ arm: z.enum(["plain", "ontave"]), ok: z.literal(true) })
          .strict()
          .parse(body);
        if (state.setupResults.some((r) => r.arm === input.arm))
          return send(res, 200, { ok: true, replayed: true });
        if (
          state.phase !== "setup" ||
          !state.setupStarted ||
          order[state.setupIndex] !== input.arm
        )
          return send(res, 409, { error: "WRONG_SETUP_TASK" });
        clock();
        state.setupResults.push({
          arm: input.arm,
          label: labels[input.arm],
          activeMs: state.activeMs,
          completedAt: new Date().toISOString(),
          scope: "guided local-candidate install on pre-provisioned storage",
          modelKeysNeeded: 0,
        });
        state.setupIndex++;
        state.setupStarted = false;
        if (state.setupIndex === 2) {
          state.phase = "review";
          state.lastStarted = null;
        }
        await persist();
        return send(res, 200, { ok: true });
      }
      keySchema.parse(body.requestKey);
      const previous = responses.get(body.requestKey);
      if (previous) {
        if (previous.hash !== digest({ path: req.url, body }))
          return send(res, 409, { error: "IDEMPOTENCY_CONFLICT" });
        return send(res, 200, previous.result);
      }
      if (req.url === "/api/start") {
        z.object({ requestKey: keySchema }).strict().parse(body);
        if (state.started) throw Error("ALREADY_STARTED");
        state.started = true;
        state.startedAt = new Date().toISOString();
      } else if (!state.started || state.finished)
        throw Error("NO_ACTIVE_STUDY");
      else if (req.url === "/api/pause") {
        const input = z
          .object({ requestKey: keySchema, paused: z.boolean() })
          .strict()
          .parse(body);
        pause(input.paused);
      } else if (req.url === "/api/setup/start") {
        z.object({ requestKey: keySchema }).strict().parse(body);
        if (state.phase !== "setup" || state.setupStarted)
          throw Error("INVALID_PHASE");
        state.setupCommand = await prepareSetup(order[state.setupIndex]);
        state.setupStarted = true;
        state.paused = false;
        resetClock();
      } else if (req.url === "/api/task/start") {
        z.object({ requestKey: keySchema }).strict().parse(body);
        if (state.phase !== "review" || state.taskStarted)
          throw Error("INVALID_PHASE");
        state.taskStarted = true;
        state.paused = false;
        state.amendActions = 0;
        resetClock();
      } else if (req.url === "/api/task/amend") {
        const input = amendSchema.parse(body);
        if (state.phase !== "review" || !state.taskStarted || state.paused)
          throw Error("INVALID_PHASE");
        const task = sequence[state.index];
        await task.store.amend(task.context, {
          bundleId: input.bundleId,
          digest: input.digest,
          output: input.output,
          key: input.requestKey,
          reason: "User saved source-checked corrections in the local study",
        });
        state.amendActions++;
      } else if (req.url === "/api/task/decide") {
        const input = decisionSchema.parse(body);
        if (state.phase !== "review" || !state.taskStarted || state.paused)
          throw Error("INVALID_PHASE");
        const task = sequence[state.index],
          view = await task.store.review(task.context, task.receipt.jobId);
        if (
          input.bundleId !== view.bundle.id ||
          input.digest !== view.bundle.digest
        )
          throw Error("STALE_BUNDLE");
        if (input.decision !== "hold")
          await task.store[input.decision](task.context, {
            bundleId: input.bundleId,
            digest: input.digest,
            key: input.requestKey,
            reason:
              "Explicit user decision after comparing source and proposal in the local study",
          });
        clock();
        const acceptedScore = scoreFields(
          input.decision === "accept" ? view.bundle.output : null,
          task.document.expected,
          task.document.text,
        );
        state.decisions.push({
          arm: task.arm,
          label: labels[task.arm],
          documentId: task.document.id,
          decision: input.decision,
          activeMs: state.activeMs,
          amendActions: state.amendActions,
          acceptedScore,
          predeclaredInjectedError: task.injectedError,
        });
        state.index++;
        state.taskStarted = false;
        state.lastStarted = null;
        if (state.index === sequence.length) {
          state.finished = true;
          state.finishedAt = new Date().toISOString();
          await writeFile(
            resolve(root, "report.json"),
            JSON.stringify(report(), null, 2) + "\n",
            { mode: 0o600 },
          );
        }
      } else return send(res, 404, { error: "NOT_FOUND" });
      state.events.push({
        path: req.url,
        at: new Date().toISOString(),
        index: state.index,
      });
      await persist();
      const result = await snapshot();
      responses.set(body.requestKey, {
        hash: digest({ path: req.url, body }),
        result,
      });
      return send(res, 200, result);
    } catch (error) {
      const code =
        error instanceof z.ZodError
          ? "INVALID_INPUT"
          : /^[A-Z_]+$/.test(error.code ?? error.message)
            ? (error.code ?? error.message)
            : "REQUEST_FAILED";
      return send(res, 400, { error: code });
    } finally {
      release?.();
    }
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  origin = "http://127.0.0.1:" + server.address().port;
  return {
    url: origin,
    root,
    report,
    close: async () => {
      clock();
      await persist();
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    },
  };
}
