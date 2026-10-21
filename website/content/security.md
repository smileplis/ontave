## Authorize in your host

Each runtime operation receives an opaque context. `authorize(context)` resolves trusted actor, workspace, capabilities and optional source policy. Keep that callback on the server.

Source text, extracted output and browser JSON cannot supply grants. Never trust a request body containing `capabilities: ["review"]`, a workspace ID or a trusted source-policy label.

## Capability boundaries

| Capability  | Operations                                          |
| ----------- | --------------------------------------------------- |
| `ingest`    | Preserve evidence and enqueue work                  |
| `worker`    | Process scoped jobs                                 |
| `read`      | Read scoped evidence, data, contracts and status    |
| `review`    | Inspect/decide bundles, definitions and evaluations |
| `provision` | Explicit workspace creation                         |

Consult the API for individual operations; review-bundle inspection requires `review`, not just general record read access.

## Database defense in depth

Use a separate non-owner runtime role. The adapter rejects superuser, BYPASSRLS and table-owner runtime access. Transactions set the authorized workspace locally on the checked-out connection; forced RLS and composite foreign keys enforce scope.

RLS does not make a shared database credential safe to distribute. A holder who can issue arbitrary SQL with the backend credential is outside the trusted-host boundary. Never expose it to a browser.

## Treat source instructions as data

A message may ask a model to run SQL, reveal keys or approve a change. It remains untrusted evidence. Models do not receive an operation channel that can authorize these actions; runtime schema/source validation and review remain mandatory.

## Keep secrets out of bundles

Do not embed keys in model prompts, logs, public examples, URL parameters, generated client assets or repository history. Use a private stable cursor secret across replicas. The public website is static and receives no provider or database credentials.
