# Security boundary

This package validates conversational **context**, not business authorization.

- Models may select registered controls and labels. They cannot provide HTML, JavaScript, endpoints, tool names, permissions or executable handlers.
- The host must load the canonical persisted interaction, check authenticated tenant and actor access, and bind the response to its latest eligible turn. Never validate against a browser-supplied replacement spec.
- Host authorization, idempotency, current-version checks, transactions and audit remain mandatory for every consequential action. `confirm: true` and labels such as “Approve” do not authorize an action.
- Treat labels and user text as untrusted data. Render as escaped text. Do not concatenate them into SQL, executable code or privileged prompts.
- The receipt marker is a representation, not a signature. Never trust its presence in client or imported text as evidence of a server write.
- A response is durable only after the host acknowledges persistence. The renderer should retain the same request identity for uncertain retries and disable stale controls.
- Do not request passwords, financial credentials, government identifiers or unnecessary sensitive data through these controls. Privacy, retention and deletion policies belong to the host.
- Date and time controls capture local context. Scheduling requires an explicit timezone and the host’s availability/conflict validation; a selected time is not a reservation.

Report a suspected vulnerability privately to the application maintainer before publishing details. The package has not been externally audited.
