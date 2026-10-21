Ontave is a server-side TypeScript framework for operational information that does not arrive in the shape your application expects.

It preserves text or JSON as evidence, asks a model for an interpretation, and stages the result for review. New concepts can arrive as proposed additions to your logical model. Your application controls both model activation and fact acceptance.

> Ontave Zero is an alpha. The implemented flow works, but the complete MVP acceptance and semantic-quality gates remain open. Read [release status](/docs/status/) before adoption.

## The basic flow

1. **Preserve.** Commit an immutable evidence record and durable job together.
2. **Interpret.** A workspace-scoped worker extracts source-linked assertions.
3. **Resolve.** Unfamiliar concepts and ambiguous identities remain staged.
4. **Review.** An authorized reviewer accepts the exact bundle they inspected.
5. **Read.** Query current accepted data through a pinned application contract.

## Where it fits

Use Ontave inside a trusted Node.js service with PostgreSQL. Your host supplies authentication, workspace access, a worker process, a model adapter and database operations. The package supplies the evidence, interpretation, review and contract layer.

The alpha does not supply a hosted database, browser runtime, React data hooks, an autonomous agent or physical business-table migrations.

## Start with one source

The [quickstart](/docs/quickstart/) uses a deterministic fictional adapter so you can learn the lifecycle without an API key. Then [select a live adapter](/docs/models/) explicitly.
