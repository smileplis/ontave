## Trusted server usage

Use the ESM server package from Node.js 24. Keep one runtime/pool per long-lived service scope rather than constructing a new pool for each request.

```ts
import { createOntave, OntaveError } from "ontave";
import { postgres } from "ontave/postgres";
import { gemini } from "ontave/models/gemini";

// This example is a private, single-owner server script.
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
};
const workspaceId = required("ONTAVE_WORKSPACE_ID");
const ownerContext = Symbol("authenticated local owner");
const ontave = createOntave({
  storage: postgres({ connectionString: required("ONTAVE_DATABASE_URL") }),
  model: gemini({
    apiKey: required("GEMINI_API_KEY"),
    model: required("GEMINI_MODEL"),
  }),
  authorize: (context) => {
    if (context !== ownerContext) {
      throw new OntaveError("UNAUTHORIZED", "Unknown context");
    }
    return {
      actorId: "local-owner",
      workspaceId,
      capabilities: ["read", "ingest", "worker", "review", "provision"],
    };
  },
  cursorSecret: required("ONTAVE_CURSOR_SECRET"),
});

try {
  // Requires the dedicated database migrations and a provisioned workspace.
  const receipt = await ontave.ingest(ownerContext, {
    source: "local-example",
    idempotencyKey: "message-001",
    payload: { kind: "text", text: "Asha is the site coordinator." },
  });
  console.log(receipt); // Durable receipt; no fact has been accepted yet.
} finally {
  await ontave.close();
}
```

First [prepare the dedicated database](/docs/database/) with a non-owner runtime role and provision the workspace. Use a stable UUID for `ONTAVE_WORKSPACE_ID` and a private random `ONTAVE_CURSOR_SECRET` of at least 32 characters. The sample requires an explicit Gemini model; the other [model adapters](/docs/models/) are interchangeable at runtime construction. A source that introduces an unknown concept may need a reviewed model extension.

Your authorization callback receives the opaque context passed to each operation. It resolves actor, workspace, capabilities and any trusted source policy. The package does not authenticate your HTTP sessions for you.

## Separate roles in the host

An ingestion route usually needs `ingest`. A query route needs `read`. A review interface needs `review`. Workers need `worker`; workspace creation requires `provision`. Do not give every public request all capabilities for convenience.

## Workers are explicit

Run a separately supervised worker loop or invoke `worker.runOnce(context)` from an authorized task runner. Importing the package does not start background processing. See [workers and recovery](/docs/workers/) for deadlines, leases and shutdown.

## Clean up

Call `ontave.close()` during bounded process shutdown to release its storage resources. The repository's `examples/node/demo.mjs` runs a deterministic fictional flow through the installed package. Clean-consumer tests exercise the packed tarball outside the source tree.
