// Requires a dedicated migrated PostgreSQL runtime connection. No paid model calls.
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "ontave";
import { postgres } from "ontave/postgres";
import { fixtureAdapter, personFixture } from "ontave/testing";

const workspaceId = process.env.ONTAVE_WORKSPACE_ID ?? randomUUID();
const localCredential = Symbol("local authenticated owner");
const runtime = createOntave({
  storage: postgres({ connectionString: process.env.ONTAVE_DATABASE_URL }),
  authorize: (credential) => {
    if (credential !== localCredential) throw Error("Unauthorized");
    return {
      actorId: "local-owner",
      workspaceId,
      capabilities: ["provision", "read", "ingest", "review", "worker"],
    };
  },
  model: fixtureAdapter(() => personFixture("Rahul")),
});
try {
  await runtime.workspaces.create(localCredential, {
    workspaceId,
    name: "Ontave fictional demo",
    requestKey: "demo-provision",
    seed: "people",
  });
  const contract = await runtime.contracts.register(localCredential, starter);
  const receipt = await runtime.ingest(localCredential, {
    source: "fictional-demo",
    idempotencyKey: "rahul-1",
    payload: { kind: "text", text: "Rahul" },
  });
  const work = await runtime.worker.runOnce(localCredential);
  if (work?.bundleId) {
    const bundle = await runtime.reviews.get(localCredential, work.bundleId);
    await runtime.reviews.accept(localCredential, {
      bundleId: bundle.id,
      digest: bundle.hash,
      requestKey: "demo-accept",
      reason: "Owner checked the fictional source",
    });
  }
  const result = await runtime.entities.find(localCredential, {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  });
  console.log(
    JSON.stringify(
      {
        mode: "deterministic fictional fixture; not live extraction",
        workspaceId,
        receipt,
        result,
      },
      null,
      2,
    ),
  );
} finally {
  await runtime.close();
}
