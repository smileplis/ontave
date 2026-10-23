// Explicit fictional SDK demonstration against a dedicated, already migrated database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quotationCases } from "./cases.mjs";
import { OntaveQuotationStore } from "./ontave-store.mjs";
if (!process.env.ONTAVE_DATABASE_URL)
  throw Error(
    "Set ONTAVE_DATABASE_URL to the restricted runtime role of a dedicated migrated database; see the example README.",
  );
const workspaceId = randomUUID(),
  context = Symbol("trusted local demonstration");
const source = quotationCases[0];
const store = new OntaveQuotationStore({
  connectionString: process.env.ONTAVE_DATABASE_URL,
  authorize: (credential) => {
    assert.equal(
      credential,
      context,
      "Only the trusted local caller is authorized",
    );
    return {
      actorId: "local-quotation-demo",
      workspaceId,
      capabilities: ["provision", "ingest", "worker", "read", "review"],
    };
  },
  extract: async (text) => {
    assert.equal(text, source.text);
    return structuredClone(source.expected);
  },
});
try {
  await store.setup(context, workspaceId);
  const receipt = await store.ingest(context, {
    id: "fictional-quotation-1",
    text: source.text,
  });
  await store.process(context);
  const proposal = await store.review(context, receipt.jobId);
  assert.equal((await store.read(context)).records.length, 0);
  console.log(
    JSON.stringify(
      {
        kind: "proposal",
        workspaceId,
        source: proposal.evidence,
        proposal: proposal.bundle,
      },
      null,
      2,
    ),
  );
  const { createInterface } = await import("node:readline/promises");
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let answer;
  try {
    answer = await terminal.question(
      "Review the source and proposed fields. Type accept to approve this exact proposal, or Enter to leave it pending: ",
    );
  } finally {
    terminal.close();
  }
  if (answer === "accept")
    await store.accept(context, {
      bundleId: proposal.bundle.id,
      digest: proposal.bundle.digest,
      key: "explicit-local-decision",
      reason:
        "Local developer explicitly approved this fictional source-bound proposal",
    });
  console.log(
    JSON.stringify(
      { kind: "accepted-data", records: (await store.read(context)).records },
      null,
      2,
    ),
  );
} finally {
  await store.close();
}
