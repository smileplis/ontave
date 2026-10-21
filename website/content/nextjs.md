## Keep Ontave on the server

The repository includes a Next.js server-route example. Add a server boundary to the module that constructs the runtime:

```ts
import "server-only";
import { createOntave } from "ontave";
import { postgres } from "ontave/postgres";

// Construct from private server configuration and an actual host authorizer.
```

Do not import this module into a client component. The runtime uses Node/PostgreSQL resources and is not an edge or browser SDK.

## Authenticate before ingesting

Resolve a session/token in the host, choose its authorized workspace and create an opaque server context. Pass only the permitted source payload into `ingest`. Ignore or reject client-supplied actor, workspace, source policy and capabilities.

A successful ingestion route can return HTTP 202 with the preserved receipt. It must not present that response as completed inference or accepted data.

## Keep review privileged

A browser can display source excerpts and proposed bundles through your authenticated server routes. Acceptance requires a review-capable context and the exact digest the reviewer saw. Avoid automatic acceptance in a generic ingestion handler.

## Verification boundary

The packed Next.js example is built as a real consumer. Its checks test unauthorized requests, forged privilege fields, preserved receipts and waiting-review status. Browser assets are scanned for fictional credential canaries, and an intentional client import of the server module must fail the build.

These checks do not replace your application's session security, deployment-secret management or authorization tests.
