# Application foundation

Ontave 0.2 adds an experimental application layer alongside the existing interaction module. One validated definition can run through a registered renderer or produce an editable React application with a local Node backend. The first reference application is a fictional CRM with leads, linked follow-ups, dashboards, forms, and transactional workflows.

This is a working foundation, with deliberately limited built-in capabilities. It does not yet generate arbitrary production applications, provision cloud infrastructure, install integrations, or migrate databases. Models produce data describing installed capabilities. Hosts install the code that implements them.

## Try both outputs

Use Node.js 24 or 26:

```sh
npm ci
npm run build:website
npx vite preview website --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/applications/`. Add a lead, create a linked follow-up, edit a record, and return to Overview. Expand the definition editor to change fields or labels and run a fresh application. Browser records stay in memory and disappear on refresh or when a definition is run again. This example makes no model request.

Choose **Export editable application**. The ZIP includes the exact framework tarball, React pages, a local Node API, and an ownership manifest. Unzip into an empty directory, then run:

```sh
npm install
npm run dev
```

The UI runs at `http://127.0.0.1:5173`; records persist in `.data/`. Alternatively, run `npm run build` and `npm start` for one local server at `http://127.0.0.1:8787`. The generated README explains customization and the deployment boundary.

The production website build prepares the tarball download. `npm run dev` can preview the workbench UI but does not prepare downloadable packages. `npm install ontave` still refers to the earlier published 0.1 API; do not use it for this preview.

## A definition describes capabilities

See [the complete CRM definition](../examples/application/definition.json). Definitions have an application ID, a revision, entities, pages, and workflows. All properties are explicit; unknown properties fail validation.

| Layer | Built in | Extension point |
| --- | --- | --- |
| Model | One validated generation attempt | `ApplicationModel.generate` through your SDK and budget |
| Fields | Text, textarea, number, boolean, date, select, reference | Extend the versioned contract for additional field semantics |
| Views | Collection table/form, entity-count dashboard | Register `kind@version` React components |
| Workflows | `record.set`, `event.emit` | Install typed synchronous modules on the server |
| Storage | Memory, single-process local file | Implement `ApplicationStore` with database transactions |
| Transport | Fetch client and Web Request handler | Use your host authentication, routes, or another transport |
| Code output | React/TypeScript + local Node API | Register trusted page exporters and module source |

Fields have a stable key, label, kind, required flag, default, options, reference target, and numeric bounds. `default: null` means no default. Selections require two to forty distinct options. `false` and `0` are valid values. References resolve only to authorized records in the same application and workspace. The runtime blocks deleting a referenced record; there is no automatic cascade.

The current limits include 32 entities, 32 fields per entity, 64 pages, and 64 workflows. Each workflow contains at most 12 steps. Values are bounded scalar data; there are no executable expressions, HTML, SQL, secrets, or arbitrary endpoint declarations in the contract. This version is intentionally opinionated about fields; custom views and modules do not implicitly add new field kinds.

## Run a definition

```ts
import {
  ApplicationDefinition,
  createApplicationRuntime,
} from 'ontave/application';
import {createFileApplicationStore} from 'ontave/application/node';
import {createApplicationHandler} from 'ontave/application/http';

const definition = ApplicationDefinition.parse(savedDefinition);
const runtime = createApplicationRuntime({
  definition,
  store: createFileApplicationStore('./.data'),
  authorize: (context, permission) => hostPolicy(context, permission),
});

export const handle = createApplicationHandler(runtime, {
  resolveContext: request => authenticatedWorkspaceFromSession(request),
});
```

The host functions above are application code you supply. `resolveContext` returns `{actorId, workspaceId}` from an authenticated session, or `null`. The framework never accepts actor or workspace claims in a command body. `authorize` is mandatory: allow entity operations and check individual rows for `get`, `update`, and `delete`. Mutation receipts also require read permission for the resulting record. Listing filters rows using the same read policy. This API does not provide field masking; install a separate projection if different callers may see different fields.

The Web handler exposes `GET /api/ontave/definition`, `GET /api/ontave/records/:entity`, and `POST /api/ontave/commands`. Responses are private and uncached. Mutations require the request's origin to match the API origin or an explicitly configured trusted origin. Non-browser clients without an Origin header must be explicitly enabled by the host. Configure trusted origins for proxies with care; authentication remains mandatory.

On the client:

```tsx
import {ApplicationDefinition} from 'ontave/application';
import {createHttpApplicationClient} from 'ontave/application/http';
import {ApplicationView} from 'ontave/application/react';
import 'ontave/application/styles.css';

const client = createHttpApplicationClient(
  ApplicationDefinition.parse(serverDefinition),
);

export function App() {
  return <ApplicationView client={client}/>;
}
```

Keep a stable client for a single authenticated application/workspace. Create a new client when that scope changes; the renderer resets drafts when client identity changes. Built-in pages retain drafts and uncertain requests across navigation. Forms use native keyboard controls, focus error feedback, validate numbers and real dates, and preserve an exact request for uncertain retries.

`createRuntimeApplicationClient(runtime, context)` is useful for trusted server composition and fictional browser demos. A browser-chosen context is not authenticated authority. Real applications call the host API.

## Commands, revisions, and retries

```ts
await runtime.execute(context, {
  kind: 'create',
  entity: 'leads',
  requestId: crypto.randomUUID(),
  values: {name: 'Aster Studio', value: 0, active: false},
});
```

Updates contain the entire replacement values object, plus `id` and `expectedRevision`; omitted fields use their defaults. Deletes also require `expectedRevision`. A stale revision fails with `CONFLICT`. Read the latest record and resolve the edit before issuing a new command.

An exact request ID and body produce the saved receipt without rerunning workflows. IDs are scoped to application, workspace, and actor. Reusing an ID with different content fails. After a timeout or unreadable acknowledgement, retain the **identical command**, including request ID and expected revision. Generating a new ID could repeat the business operation. The HTTP client and React hooks distinguish definite validation/permission/conflict failures from uncertain network/server outcomes.

The store must atomically commit record changes, definition fingerprint, request receipt, and queued effects. `ApplicationStore.transaction` must serialize conflicting operations within an application/workspace, roll back failures, and not report success before durability is established. Database adapters must enforce these properties across every process; the snapshot helper's in-memory queue alone is insufficient for multiple workers.

The file adapter is a local reference implementation: private files, synchronized temporary writes and atomic replacement, validation on load, and a 32 MiB snapshot limit. Separate instances share a queue in one process. It has no cross-process locking, pagination, receipt retention cleanup, encryption, production backup policy, or database migrations. Corrupt storage fails closed and is never automatically reset.

The runtime pins the complete canonical definition on the first mutation. Changing its revision or content against existing data fails until the host applies an explicit migration. This release has no migration runner; do not edit a live definition and expect stored data to adapt.

## Pair with a model

```ts
import {generateApplication} from 'ontave/application/model';

const definition = await generateApplication({
  generate: async ({intent, schema, modules, views, instructions}) => {
    return hostModel.generateJSON({intent, schema, modules, views, instructions});
  },
}, 'Build a lead tracker with linked follow-up tasks.');
```

`hostModel.generateJSON` represents your own provider integration. Ontave supplies the schema and installed capabilities, makes one explicit host callback, and validates the returned JSON. Return a plain definition object or its JSON string. Markdown fences, unknown views, invalid references, unsupported modules, and malformed values are rejected. Provider-specific schema transformations, timeouts, cancellation, budget, feedback and retries belong to the host. No model provider SDK is bundled, and live model reliability has not been verified by the example.

The existing `ontave/adapters` exports serve interactive questions. They do not automatically implement application generation. A model supporting only text can return JSON for validation; the host should use the provider's structured output facility when available.

## Add trusted modules and views

```ts
import {z} from 'zod';
import {
  defineApplicationModule,
  createApplicationModuleRegistry,
  standardApplicationModules,
} from 'ontave/application';

const qualify = defineApplicationModule({
  name: 'crm.qualify', version: 1,
  description: 'Mark the current lead as qualified.',
  config: z.strictObject({}),
  run: () => ({patch: {status: 'qualified'}}),
});
const modules = createApplicationModuleRegistry([
  ...standardApplicationModules, qualify,
]);
```

Pass the registry to generation, runtime, and export. A definition can choose only installed modules. Module configuration is currently a flat scalar map; richer structured module input requires a future contract revision. Modules must be synchronous, deterministic local transformations returning validated patches and/or queued effects. Throwing or returning an invalid result rolls back the command. Perform external I/O through a host worker after the transaction commits; a transaction rollback cannot undo an external API call.

`event.emit` records an outbox effect with a stable ID and record values. The HTTP handler redacts effect payloads from browser receipts. An authorized host worker calls `runtime.pendingEffects(context)`, dispatches approved work using each effect ID for downstream idempotency, then calls `runtime.acknowledgeEffect(context, id)`. Delivery is at least once; workers must handle retries and concurrent processing. No background dispatcher, lease/claim service, or external connector ships in this release.

For UI modules, pass a registry to `ApplicationView` with keys such as `collection@1` and `crm.board@1`; spread `standardApplicationViews` to keep built-ins. Components receive `{client, page, active}`. Pages stay mounted but hidden during navigation; honor `active` to refresh when shown. Uninstalled views show a readable fallback. Definitions never select remote JavaScript or install components.

## Export and preserve edits

```ts
import {exportApplication} from 'ontave/application/export';
import {writeApplicationExport} from 'ontave/application/node';

const bundle = exportApplication(definition, {
  frameworkDependency: 'file:./vendor/ontave.tgz',
});
await writeApplicationExport('./generated', bundle);
// Supply the selected tarball at generated/vendor/ontave.tgz before npm install.
```

The host selects the package source, dependencies, registered page exporters, and custom module source. Those are executable inputs and must never be copied from model output. Custom workflow modules require corresponding `moduleSources['name@1']` with a default-exported module. Custom views require `pageExporters['kind@1']` returning trusted TSX. Runtime capability registration alone does not imply an export implementation.

Collection exports contain actual table/form source in `src/pages/`. They reuse validation, transport, and retry hooks from Ontave. Edit those pages directly, or override page keys in the user-owned `src/extensions.tsx`. `src/style.css` is user-owned too. Regeneration preserves these files and refuses to overwrite modified generated files. Review/merge conflicts before regenerating; code edits are not reverse-imported into the definition. The writer validates paths, refuses symlink targets and unowned files, and records generated hashes in `.ontave/export.json`. Individual replacements are atomic; a whole-directory crash-safe transaction is not claimed.

For browser downloads, pass `await applicationExportManifest(bundle)` and any vendored binary assets to `applicationExportArchive(bundle, assets)`. This deterministic, uncompressed ZIP has a 10 MiB limit and no archive library dependency. Include the manifest to preserve safe regeneration after extraction. The website also verifies the exact tarball's SHA-256 checksum before bundling it.

The generated server listens on `127.0.0.1` with a local developer identity. Public applications require your host authentication, authorization, workspace selection, deployment operations and transactional database. Keep secrets in the host. This example does not provision production infrastructure.

## Verification and next boundaries

`npm run verify:application` extracts the real ZIP, checks safe regeneration, installs the bundled package, typechecks/builds the React application, and starts its actual backend. It checks linked CRUD, optimistic conflicts, duplicate retries, CSRF origin rejection, and persistence after a process restart. Unit and DOM tests additionally cover authorization, workspace isolation, rollback, custom modules, model validation, focus, navigation, and uncertain retry identity.

The next implementation areas are a production database adapter and migration runner, richer composable views and workflow contracts, authenticated host examples, and live provider evaluations. The interaction layer remains independently usable through its existing exports. Product code and business data remain outside this repository.
