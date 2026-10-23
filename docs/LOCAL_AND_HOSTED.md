# Local setup and optional hosting

These APIs are available in **0.1.0-alpha.5**, a developer preview. Install with `npm install ontave` or pin `ontave@0.1.0-alpha.5`. Alpha.4 does not include these exports.

## Start locally

Use Node.js 24 on macOS or Linux. After installing Ontave:

```sh
npx ontave dev --install
```

This explicitly downloads PostgreSQL tooling if necessary, creates a dedicated `.ontave` directory, starts a persistent local database with a restricted runtime role, and opens a local Studio URL. No Docker, database credentials or hand-written migration commands are needed. Subsequent starts reuse the tooling and data. Ctrl+C stops the server and database; it retains data. Do not point `--directory` at an existing source or data folder. Back up the dedicated directory while the database is stopped.

The command works without a model for inspecting stored sources and reviewing existing bundles. To extract your own messages, configure `GEMINI_API_KEY` and an explicit `GEMINI_MODEL` privately in the server environment. The CLI reads environment variables; it does not automatically load a project `.env`. Model inference uses your provider account. There is no silent fixture fallback.

## A few lines in an application

```ts
import { openOntave } from 'ontave/local';
import { gemini } from 'ontave/models/gemini';

const app = await openOntave({
  install: true,
  model: gemini({ apiKey: process.env.GEMINI_API_KEY!, model: process.env.GEMINI_MODEL! }),
});
await app.ingest({ id: 'message-1', text: 'Rahul needs a site visit.' });
await app.process();
console.log((await app.studio()).url);
// On application shutdown: await app.close();
```

`openOntave` handles local provisioning, workspace identity, private credentials and the worker's lifecycle. It starts with the people model; use `seed: 'empty'` for an empty model. `process()` handles one queued job, rather than running a permanent background worker. Start it when work arrives or run it from your application's worker loop. Imports alone have no setup side effects.

`app.find({conceptId: 'person'})` registers the current model as a convenience read contract. Applications that require pinned stable contracts should use `app.runtime.contracts.register` and `app.runtime.entities.find` with an explicitly retained contract, as the quotation milestone does.

## Automatic processing is an explicit policy

```ts
import { additivePolicy } from 'ontave';
// Add to openOntave's options after provisioning your quotation model:
const automation = additivePolicy({
  sources: ['supplier'],
  relationshipTargets: ['quotation'],
});
```

The host chooses which sources and extensions can be adopted. The default profile permits one new namespaced concept, eight text/integer/date fields and one relationship per proposal. Existing meanings and field types cannot change. Extension records must link to an existing allowed parent. New base-model identities are held unless the host explicitly opts in. Retractions and assertions marked verified are held. Evidence, reported-claim semantics and existing contract checks still apply.

This removes manual review for eligible cases. It cannot guarantee semantic correctness; quoted source evidence and structural validation do not prove that the model interpreted it correctly. Uncertainty, conflicting identity, disallowed sources and changes outside the policy stay pending. Review them as exceptions, or leave them unadopted. Do not automatically apply this profile to payments, permissions or irreversible actions.

## Ready-to-use Studio

Studio shows jobs, the current model, source evidence, proposed facts, editable values, supporting quotes and identity decisions. Read the complete paginated source before acceptance. Corrections create a fresh bundle digest; acceptance/rejection binds to the displayed digest. A stale screen cannot accept a changed bundle. Completed jobs cannot be accepted again through the UI.

Studio binds to loopback and uses a private cookie with origin/host checks. It is a single-developer local owner tool. Do not expose its port to the internet or use its local credential as multi-user authentication. Ambiguous ontology changes still use the evaluated publication SDK/CLI; Studio does not invent a passing semantic evaluation.

## Bring your own PostgreSQL

Storage is required for evidence, jobs, revisions and contracts. Manually configuring a database is optional in local mode. For an existing dedicated PostgreSQL 18 installation, use `connectionString` for a restricted runtime role. Only supply `migrationConnectionString` plus `runtimeRole` if you explicitly want local setup to apply internal migrations. Shared applications should use the lower-level `createOntave` API with host authentication, tenant authorization and durable worker operations described in the operator runbook.

Local convenience setup is not a managed production service. Server restart, backup/recovery, worker supervision, provider budgets and application authorization remain deployment responsibilities.

## Optional hosted product

An optional managed service is a reasonable next product: keep the Apache-2.0 framework and local setup free, support bring-your-own database, then charge for hosted storage, compute and operational support. Mastra similarly separates its free framework from its hosted platform; its current plans are a reference for the model, not evidence for Ontave's prices or costs. [Mastra pricing](https://mastra.ai/pricing), [Studio documentation](https://mastra.ai/docs/studio/overview).

Before setting prices, measure per-project storage growth, worker time, backups and support. A small free hosted tier should have visible hard limits and bring-your-own model keys; paid capacity can follow observed costs. Hosted authentication, tenant quotas, metering, exports, durable workers and tested recovery must ship before inviting production customers. No hosted database service, free allowance, billing system or cloud endpoint has been launched by this milestone.
