// Explicit opt-in: one fictional live extraction; automated development checks stand in for review.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../dist/index.js";
import { gemini } from "../dist/models/gemini.js";
import { mistral } from "../dist/models/mistral.js";
import { openrouter } from "../dist/models/openrouter.js";
import { groq } from "../dist/models/groq.js";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
process.loadEnvFile(".env");
const provider = process.argv.includes("--mistral")
  ? "mistral"
  : process.argv.includes("--openrouter")
    ? "openrouter"
    : process.argv.includes("--groq")
      ? "groq"
      : "gemini";
const model =
  provider === "mistral"
    ? mistral({
        apiKey: process.env.MISTRAL_API_KEY,
        model: process.env.MISTRAL_MODEL,
      })
    : provider === "openrouter"
      ? openrouter({
          apiKey: process.env.OPENROUTER_API_KEY,
          model: process.env.OPENROUTER_MODEL,
        })
      : provider === "groq"
        ? groq({
            apiKey: process.env.GROQ_API_KEY,
            model: process.env.GROQ_MODEL,
          })
        : gemini({
            apiKey: process.env.GEMINI_API_KEY,
            model: process.env.GEMINI_MODEL,
          });
const db = await disposablePostgres(),
  w = randomUUID();
const app = createOntave({
  storage: db.storage,
  model,
  authorize: () => ({
    actorId: "fictional-smoke-reviewer",
    workspaceId: w,
    capabilities: ["provision", "read", "ingest", "worker", "review"],
  }),
});
try {
  await app.workspaces.create(null, {
    workspaceId: w,
    name: "Fictional live smoke only",
    seed: "people",
    requestKey: "create",
  });
  const contract = await app.contracts.register(null, starter);
  const receipt = await app.ingest(null, {
    source: "fictional-live-smoke",
    idempotencyKey: "1",
    payload: {
      kind: "text",
      text: "Rahul Sharma. Email: rahul.sharma@example.test.",
    },
  });
  const work = await app.worker.runOnce(null);
  if (work.state !== "waiting_review") {
    await writeFile(
      `artifacts/live-flow-${provider}.json`,
      JSON.stringify(
        {
          provider,
          mode: "one-call development smoke; not a semantic trial",
          ok: false,
          work,
          bundle: work.bundleId
            ? await app.reviews.get(null, work.bundleId)
            : null,
          runs: (
            await db.admin.query(
              "SELECT model,output,error,usage FROM ontave.runs WHERE workspace_id=$1",
              [w],
            )
          ).rows,
          job: await app.jobs.get(null, receipt.job_id),
        },
        null,
        2,
      ) + "\n",
    );
    throw Error(
      "Live extraction did not produce a review-ready bundle; see sanitized artifact",
    );
  }
  const bundle = await app.reviews.get(null, work.bundleId),
    extraction = bundle.body.extraction;
  assert.equal(extraction.entities.length, 1);
  assert.equal(extraction.relationships.length, 0);
  assert.equal(extraction.entities[0].fields.name.value, "Rahul Sharma");
  assert.equal(
    extraction.entities[0].fields.email.value,
    "rahul.sharma@example.test",
  );
  const query = {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  };
  assert.equal((await app.entities.find(null, query)).records.length, 0);
  await app.reviews.accept(null, {
    bundleId: bundle.id,
    digest: bundle.hash,
    requestKey: "accept",
    reason:
      "Automated check of fictional development example against exact expected values; not a real-world verification",
  });
  const result = await app.entities.find(null, query);
  assert.equal(result.records[0].fields.name.verification, "reported");
  const runs = (
    await db.admin.query(
      "SELECT model,usage FROM ontave.runs WHERE workspace_id=$1",
      [w],
    )
  ).rows;
  const report = {
    ok: true,
    provider,
    mode: "one-call fictional development smoke; automated source/value checks stand in for review; not a live quality trial",
    receipt,
    work,
    extraction,
    result,
    runs,
    afterAcceptance: (await app.jobs.get(null, receipt.job_id)).state,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    `artifacts/live-flow-${provider}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: true,
      provider,
      staged: true,
      readBeforeAcceptance: 0,
      readAfterAcceptance: result.records.length,
      verification: result.records[0].fields.name.verification,
      usage: runs[0].usage,
    }),
  );
} finally {
  await app.close();
  await db.stop();
}
