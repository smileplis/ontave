# Ontave Next.js server example

This is an actual Next.js 16.4.2 example built with the Ontave tarball. It uses Node.js server routes and a separate worker. `scripts/verify-next.mjs` installs it outside the repository, builds it, checks browser assets with fictional secret canaries, exercises authenticated ingestion/status and verifies that a client cannot import the server runtime.

Build Ontave and create `artifacts/ontave-0.1.0-alpha.0.tgz` first, then install this example's exact dependencies. Configure a dedicated migrated database and a provisioned workspace on the server. `ONTAVE_DEMO_MODE=fixture` explicitly selects the fictional deterministic adapter; otherwise Gemini requires an explicit key/model. No fallback occurs.

`ONTAVE_LOCAL_TOKEN` is an explicit single-owner development credential of at least 32 characters. The example checks it on the server and supplies a server-owned session symbol to `runtime.authorize`. Workspace and read/ingest grants come from server configuration. Replace this development credential with your application's real session system before adopting the example in a shared deployment. Never send database/model credentials to browser components.

The browser can preserve a fictional message. Processing and acceptance happen separately; a 202 response is only a durable receipt. The example's server grants cannot review, provision or publish. The test harness supplies its own isolated worker/reviewer.

`server-only` guards the runtime/session modules, following the [Next.js data-security guide](https://nextjs.org/docs/15/app/guides/data-security). The engine does not support browser or edge-runtime execution. React/Vite applications likewise need a server API.
