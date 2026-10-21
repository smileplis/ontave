This example uses fictional evidence and a deterministic adapter. It demonstrates the lifecycle, not live extraction quality. Start with the [installed tarball](/docs/installation/) and a dedicated PostgreSQL 18 database that has [explicit migrations](/docs/database/) applied.

## 1. Configure the server runtime

Create `first-record.mjs` in your application. Set `ONTAVE_DATABASE_URL` privately to the restricted runtime connection. Node does not load an env file unless you explicitly request it.

```js
import { randomUUID } from "node:crypto";
import { createOntave, starter } from "ontave";
import { postgres } from "ontave/postgres";
import { fixtureAdapter, personFixture } from "ontave/testing";

const workspaceId = randomUUID();
const owner = Symbol("authenticated local owner");

const ontave = createOntave({
  storage: postgres({
    connectionString: process.env.ONTAVE_DATABASE_URL,
  }),
  model: fixtureAdapter(() => personFixture("Ramesh")),
  authorize(context) {
    if (context !== owner) throw new Error("Unauthorized");
    return {
      actorId: "local-owner",
      workspaceId,
      capabilities: ["provision", "read", "ingest", "review", "worker"],
    };
  },
});
```

The symbol is an in-process teaching credential. In a deployed service, resolve a real authenticated session and its workspace/capabilities in the host. Do not grant privileges from request JSON.

Wrap the following operations in a `try` block, then close the runtime in `finally`.

## 2. Provision and pin an interface

```js
await ontave.workspaces.create(owner, {
  workspaceId,
  name: "First Ontave workspace",
  requestKey: "workspace-1",
  seed: "people",
});

const contract = await ontave.contracts.register(owner, starter);
```

The selected starter contains Person (`name`, optional `email`) and Organization (`name`). It does not preload Installation, RoofInspection or other business concepts. Select `seed: "empty"` for an empty model.

## 3. Preserve the source

```js
const receipt = await ontave.ingest(owner, {
  source: "first-example",
  idempotencyKey: "message-001",
  payload: { kind: "text", text: "Ramesh" },
});

console.log(receipt.evidence_id, receipt.job_id, receipt.state);
```

The receipt commits evidence and a durable job atomically. Repeating the same key with the same envelope returns the earlier receipt. Changing that input conflicts.

## 4. Run one interpretation

```js
const work = await ontave.worker.runOnce(owner);

if (!work || !("bundleId" in work)) {
  throw new Error("Inspect job status before continuing");
}

const bundle = await ontave.reviews.get(owner, work.bundleId);
console.log(bundle);
```

Check `waiting_ontology`, `waiting_identity` and `waiting_review` separately. A waiting state has preserved work; it is not an accepted record. The deterministic adapter in this example yields a reviewable Person.

## 5. Accept the checked fictional bundle

```js
if (work.state !== "waiting_review") {
  throw new Error("Resolve the bundle dependencies first");
}

await ontave.reviews.accept(owner, {
  bundleId: bundle.id,
  digest: bundle.hash,
  requestKey: "accept-message-001",
  reason: "Checked this deterministic interpretation against its source",
});
```

This automated decision is appropriate for the known fictional example. A real review interface must present the proposed content and supporting source to an authorized reviewer. A changed bundle requires a new digest and review.

## 6. Read accepted data

```js
const page = await ontave.entities.find(owner, {
  contractId: contract.id,
  contractHash: contract.hash,
  conceptId: "person",
  where: [{ field: "name", op: "eq", value: "Ramesh" }],
  limit: 25,
});

const name = page.records[0]?.fields.name;
if (name?.state === "value") {
  console.log(name.value); // Ramesh
  console.log(name.verification); // reported
  console.log(name.assertionIds); // inspectable provenance
}
```

The query reads current accepted data with no model call. The name is `reported`: accepting an interpretation does not independently verify the source.

## 7. Close resources

```js
await ontave.close();
```

In a full script, call `close` in `finally` so failures also release the PostgreSQL pool. Run with Node.js 24, explicitly loading your private environment if needed:

```sh
node --env-file=.env first-record.mjs
```

The repository's Node example and clean-consumer verification script exercise the same public imports. Next, explore [evidence](/docs/evidence/), [review](/docs/review/) and [model evolution](/docs/evolution/).
