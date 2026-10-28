# Security boundary

The interaction module validates conversational context. The application module validates declarative application data and enforces a host-supplied authorization policy. Neither a model definition nor a conversational response grants authority.

- Models may select registered controls and labels. They cannot provide HTML, JavaScript, endpoints, tool names, permissions or executable handlers.
- The host must load the canonical persisted interaction, check authenticated tenant and actor access, and bind the response to its latest eligible turn. Never validate against a browser-supplied replacement spec.
- Host authorization, idempotency, current-version checks, transactions and audit remain mandatory for every consequential action. `confirm: true` and labels such as “Approve” do not authorize an action.
- Treat labels and user text as untrusted data. Render as escaped text. Do not concatenate them into SQL, executable code or privileged prompts.
- The receipt marker is a representation, not a signature. Never trust its presence in client or imported text as evidence of a server write.
- A response is durable only after the host acknowledges persistence. The renderer should retain the same request identity for uncertain retries and disable stale controls.
- Do not request passwords, financial credentials, government identifiers or unnecessary sensitive data through these controls. Privacy, retention and deletion policies belong to the host.
- Date and time controls capture local context. Scheduling requires an explicit timezone and the host’s availability/conflict validation; a selected time is not a reservation.

Report a suspected vulnerability privately to the application maintainer before publishing details. The package has not been externally audited.

## Application module

- Model output is a strict definition of installed capabilities. Unknown executable properties are rejected. Only the trusted host registers modules, views, source exporters, dependencies, and provider clients.
- Resolve actor and workspace from authenticated server context. Commands cannot select them. Create a new browser client when its authenticated scope changes. Browser demo identity and the generated local developer identity are not public authentication.
- Supply an authorization policy for entity and row operations. Read policies filter rows and guard mutation receipts. Field-level projection, schema visibility, retention, auditing and privacy belong to the host.
- Store transactions must atomically serialize record changes, definition fingerprints, exact request receipts and outbox effects. For uncertain outcomes, retry the identical command. Use record revisions to avoid losing concurrent edits.
- Workflow modules must be synchronous local transformations. Queue external effects, dispatch under host policy, deduplicate downstream by effect ID, and acknowledge only after successful delivery. Modules are trusted executable code; validation is not a sandbox for their implementation.
- The HTTP handler validates Origin for mutations and limits JSON bodies. Configure proxy origins explicitly. Authentication, rate limiting, TLS, sessions, field projection, and deployment remain host responsibilities.
- The generated server binds to loopback, checks Host, and uses a local developer context. Do not expose it publicly without replacing authentication, authorization, workspace resolution and storage.
- The file adapter is single-process, capped at 32 MiB, and has no production retention, encryption, backup or migration service. Definition changes fail against existing stored state until explicitly migrated. Corrupt files are never silently reset.
- Export source and dependencies are host inputs. The writer validates paths and refuses edited generated files and symlink targets. Its directory must be host-owned and not concurrently modified by an untrusted process; preflight checks do not prevent filesystem races. A whole export is not a crash-safe filesystem transaction.

See [the application guide](docs/APPLICATIONS.md) for integration and remaining boundaries.
