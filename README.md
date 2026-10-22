# Ontave

Your schema didn’t see this coming.

Ontave is an Apache 2.0 TypeScript framework for preserved evidence, reviewed assertions and additive ontology evolution. Keep the source, review proposed changes and read accepted data through a typed application contract.

**Development alpha:** unreleased source work is `0.1.0-alpha.2`; the public download remains `alpha.1`. The working lifecycle has deterministic and PostgreSQL coverage. The complete MVP acceptance and frozen live-model quality gates remain open. See [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Get started

[Documentation](https://app.daltn.tech/docs/) · [Quickstart](https://app.daltn.tech/docs/quickstart/) · [API reference](docs/API_REFERENCE.md) · [Release status](https://app.daltn.tech/docs/status/)

Use Node.js 24 and a dedicated PostgreSQL 18 database. The package is ESM and runs in trusted server processes.

```sh
# Install the public alpha tarball, without a registry publication.
npm install https://github.com/smileplis/ontave/releases/download/v0.1.0-alpha.1/ontave-0.1.0-alpha.1.tgz
npx ontave help
```

Or build from source:

```sh
git clone https://github.com/smileplis/ontave.git
cd ontave
npm ci
npm run build
npm pack --pack-destination artifacts
```

There is no public npm registry release yet. Installing a library does not provision a database or run migrations. [Set up the database](https://app.daltn.tech/docs/database/) explicitly, then follow the deterministic quickstart. No provider key is needed for the example or deterministic tests.

## What it does

- Preserves text/JSON evidence with exact source references and idempotent durable jobs.
- Stages interpretations for whole-bundle review, with scoped identity decisions.
- Keeps acceptance separate from verification and exposes value, unknown, missing and conflict field states.
- Proposes additive model changes and checks exact evaluation artifacts before activation/replay.
- Pins application contracts and generates TypeScript declarations and executable validators.
- Queries current accepted data using a bounded structured API, without an inference call.

```ts
const receipt = await ontave.ingest(context, {
  source: "messages",
  idempotencyKey: "message-014",
  payload: { kind: "text", text: "Ramesh needs to inspect the roof." },
});
```

`ontave` above is a configured server runtime. The receipt preserves evidence and a job; processing and review are separate operations. [Walk through the complete setup](https://app.daltn.tech/docs/quickstart/).

## Your infrastructure, explicit boundaries

The host resolves authenticated actor, workspace, capabilities and trusted source policy. PostgreSQL uses a separate restricted runtime role with forced row-level security. Database credentials and model keys belong on the server.

Gemini is an explicit replaceable adapter, with full-request token preflight. The experimental Groq adapter supports extraction only. Model output is validated and cannot approve changes. Accepting “I paid” as a correctly extracted claim does not independently verify payment.

The alpha does not perform physical business-table migrations, destructive ontology changes, automatic established-entity merging or autonomous fact acceptance. It does not supply a hosted database, browser/edge SDK or React data hooks.

## Verify locally

```sh
npm test
npm run test:integration
npm run verify:package
npm run verify:node
npm run verify:next
npm run verify:domains
npm run measure:benefits
npm run measure:load
# Optional PostgreSQL operator client tools are required:
npm run verify:restore
```

Tests use fictional fixtures and disposable databases. Deterministic tests make no paid model calls. Live smoke checks do not establish the declared 95% precision / 90% recall targets; three new development trials met the aggregate field targets, while independent labels and identity/discovery qualification remain open. See the quality report for all earlier failures and the revised scoring policy.

The static documentation/marketing site lives in `website`:

```sh
npm ci --prefix website
npm run build --prefix website
npm run check --prefix website
npm run dev --prefix website
```

## Measured benefits and release qualification

The local deterministic benefit harness avoided 400 repeated extraction calls across 500 deliveries of 100 distinct inputs. Another 1,000 structured reads used no model calls. These are operation counts, not human time-saving or live accuracy claims. See [user benefits](docs/USER_BENEFITS.md) and the [quality report](docs/QUALITY_REPORT.md).

Run `npm run verify:release` before any npm publication. The prepublish guard refuses missing, stale or non-passing qualification evidence. It never authenticates or publishes. Provider failures and unmet semantic thresholds remain blockers.

## References

[Operator runbook](docs/OPERATOR_RUNBOOK.md) · [Build report](docs/BUILD_REPORT.md) · [Annotation rubric](docs/ANNOTATION_RUBRIC.md) · [Architectural source reference](docs/SOURCE_REFERENCE.md)

Copyright 2026 Ontave contributors. See [Apache 2.0](LICENSE) and [NOTICE](NOTICE).
