## Trusted server usage

Use the ESM server package from Node.js 24. Keep one runtime/pool per long-lived service scope rather than constructing a new pool for each request.

```ts
const ontave = createOntave({
  storage: postgres({ connectionString: process.env.ONTAVE_DATABASE_URL }),
  model,
  authorize: resolveAuthenticatedAccess,
  cursorSecret: process.env.ONTAVE_CURSOR_SECRET,
});
```

Your authorization callback receives the opaque context passed to each operation. It resolves actor, workspace, capabilities and any trusted source policy. The package does not authenticate your HTTP sessions for you.

## Separate roles in the host

An ingestion route usually needs `ingest`. A query route needs `read`. A review interface needs `review`. Workers need `worker`; workspace creation requires `provision`. Do not give every public request all capabilities for convenience.

## Workers are explicit

Run a separately supervised worker loop or invoke `worker.runOnce(context)` from an authorized task runner. Importing the package does not start background processing. See [workers and recovery](/docs/workers/) for deadlines, leases and shutdown.

## Clean up

Call `ontave.close()` during bounded process shutdown to release its storage resources. The repository's `examples/node/demo.mjs` runs a deterministic fictional flow through the installed package. Clean-consumer tests exercise the packed tarball outside the source tree.
