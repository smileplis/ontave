# Ontave

Your schema didn’t see this coming.

Ontave is an Apache 2.0 TypeScript framework for preserved evidence, reviewed assertions and additive ontology evolution. Keep the source, review proposed changes and read accepted data through a typed application contract.

**Developer preview `0.1.0-alpha.2`.** The source-to-reviewed-record lifecycle is available as a runnable local playground and a versioned GitHub package. Full MVP qualification remains open; this is not a production-readiness claim. See [release status](docs/IMPLEMENTATION_STATUS.md).

## Try Ontave

[Browser sandbox](https://app.daltn.tech/playground/) · [Quickstart](https://app.daltn.tech/docs/quickstart/) · [API reference](docs/API_REFERENCE.md)

With **Node.js 24** on macOS or Linux:

```sh
npx --yes --package=https://github.com/smileplis/ontave/releases/download/v0.1.0-alpha.2/ontave-0.1.0-alpha.2.tgz ontave playground --install
```

Open the localhost URL printed in the terminal. The explicit command prepares a temporary PostgreSQL database and restricted role. `--install` downloads optional platform tooling into a temporary directory if needed. No Docker or model key is required. Ctrl+C stops the playground and removes the temporary database.

The local playground uses real SDK/database operations with an explicitly fictional fixture adapter. The hosted browser sandbox replays reference runs from that same SDK harness. Neither demonstrates arbitrary-message model accuracy. Try the roof-inspection and payment-claim scenarios, inspect the source, evaluate the proposal, approve the model, confirm identity links and accept or reject the facts.

## Install in your application

```sh
npm install https://github.com/smileplis/ontave/releases/download/v0.1.0-alpha.2/ontave-0.1.0-alpha.2.tgz
npx ontave help
```

The package is ESM for trusted Node.js 24 servers with a dedicated PostgreSQL 18 database. There is no npm registry publication yet. Core imports perform no setup or provider calls. Follow the [Node.js integration guide](https://app.daltn.tech/docs/node/) for your own data, model and authorization.

Build from source:

```sh
git clone https://github.com/smileplis/ontave.git
cd ontave
npm ci
npm run playground
```

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

Gemini is an explicit replaceable adapter, with full-request token preflight. Experimental Mistral and OpenRouter adapters are explicit alternatives; Groq supports extraction only. Model output is validated and cannot approve changes. Accepting “I paid” as a correctly extracted claim does not independently verify payment.

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

## Developer-preview feedback

[Report a preview issue](https://github.com/smileplis/ontave/issues/new?template=developer-preview.yml). Share setup friction, review effort and the workflow you want to support, with a fictional or redacted reproduction. The playground does not send telemetry or your messages to us.
