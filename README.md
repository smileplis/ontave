# Ontave

Modular foundations for applications built with LLMs. Run a validated application definition or export editable source code. Use interactive conversations as one independent module.

Ontave is a TypeScript framework with separate contracts for models, views, transactional storage, workflows, transport, and code export. The core needs only Zod; React is optional. Models describe installed capabilities as bounded data. The host owns executable code, identity, permissions, deployment, and external actions. Product code stays outside the framework.

**0.2.0-alpha.2 — experimental source preview.** The application foundation now demonstrates a complete local CRM: leads, linked follow-ups, editable forms/tables, dashboards, persistent records, and queued workflows. It does not yet build arbitrary production applications. The Ontave name belongs to this framework, replacing the earlier ontology framework. This API has not been published to npm; existing `ontave@0.1.x` installations contain the previous framework. Read the [migration guide](docs/MIGRATION.md) before changing dependencies. Historical releases and licenses remain available.

## Try it locally

Use Node.js 24:

```sh
git clone https://github.com/smileplis/ontave.git
cd ontave
npm ci
npm run dev
```

Open the localhost URL printed by Vite for the landing page, `/applications/` for a runnable CRM definition, and `/playground/` for all ten interaction controls. Both use fictional fixtures, with no model key or provider request. CRM preview records stay in memory; interaction answers stay in session storage for that browser tab.

To try the complete ZIP export, run `npm run build:website` and `npx vite preview website --host 127.0.0.1 --port 4173`, then open `/applications/`. The ZIP includes the exact framework package: unzip, `npm install`, `npm run dev`. Its Node backend persists local records between restarts.

To use this source preview in another project, run `npm pack` in the clone, then install `ontave-0.2.0-alpha.2.tgz`. The tarball includes compiled modules, declarations, styles, and integration documentation.

## Application quick start

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

The host API uses `createApplicationRuntime` with a mandatory authorization policy and a transactional store, then `createApplicationHandler` with authenticated workspace resolution. The generated starter supplies a local-only reference server. Production authentication, database adapters, migrations, and external dispatch belong to the host; those are not implemented by the browser demo.

`generateApplication` accepts one provider-neutral host callback and validates its output against the schema and installed capabilities. `exportApplication` produces actual React page source and a Node backend. Custom modules, views, and source exporters are registered by the host; a model cannot install code. See the [application guide](docs/APPLICATIONS.md) and [complete CRM definition](examples/application/definition.json).

| Public entry point | Purpose |
| --- | --- |
| `ontave/application` | Definition, records, commands, runtime, workflow and store interfaces |
| `ontave/application/model` | Host model callback and strict output validation |
| `ontave/application/react` | Optional views, native field inputs and collection/retry hooks |
| `ontave/application/http` | Fetch client and authenticated Web Request handler |
| `ontave/application/node` | Local persistent store and export writer that preserves edits |
| `ontave/application/export` | Trusted source generators, ownership manifest and ZIP output |
| `ontave/application/styles.css` | Scoped application styles |

The interaction exports below remain independently usable.

## Core quick start

```ts
import {Interaction, validateResponse, formatResponse} from 'ontave';

const interaction = Interaction.parse({
  version: 1,
  question: 'What should we explore next?',
  description: null,
  controls: [{
    key: 'direction', label: 'Direction', kind: 'single_choice', required: true,
    options: [
      {value: 'examples', label: 'Show examples'},
      {value: 'details', label: 'Explain the details'},
    ],
    min: null, max: null,
  }],
  submitLabel: 'Continue',
});

// Server: load this spec from the authorized canonical conversation turn.
const values = validateResponse(interaction, {direction: 'examples'});
const message = formatResponse(interaction, values);
// Persist and continue the same conversation through your existing executor.
```

## Controls

Every interaction has at most three controls; selections offer two to six distinct options. Labels and responses have bounded lengths. All fields in the specification are explicit; use `options: []` for controls without choices and `min: null, max: null` except for numeric bounds.

| Kind | Response | Behavior |
| --- | --- | --- |
| `single_choice` | string | One offered option, rendered as radio chips |
| `multi_choice` | string array | Distinct offered options, normalized into spec order |
| `select` | string | Native dropdown with the same offered-option validation |
| `rating` | number | Explicit integer from 1 to 5 |
| `text`, `textarea` | string | Trimmed text, up to 1,200 characters |
| `number` | number | Finite number, with optional inclusive bounds |
| `date` | string | Real calendar date in `YYYY-MM-DD` format |
| `time` | string | Local clock time in `HH:mm` format |
| `confirm` | boolean | Explicit yes or no; `false` is a valid answer |

Optional answers may be omitted, but submitting an entirely empty response is rejected. `select` and `rating` extend the original version 1 kind set. Advertise only controls your client supports; unsupported specs render a text fallback. Date/time context does not reserve availability. A label such as “Approve” grants no action permission.

## React

```tsx
import {InteractionForm} from 'ontave/react';
import 'ontave/styles.css';

<InteractionForm
  interactionId={turn.id}
  interaction={turn.interaction}
  initialValues={turn.savedValues}
  readOnly={turn.superseded || turn.savedValues !== undefined}
  pending={sending}
  disabled={!canReply}
  error={sendError}
  onSubmit={values => submitToHost({turnId: turn.id, values})}
/>
```

`onSubmit` receives validated values and may return a promise. The renderer blocks duplicate in-flight submissions, preserves a rejected draft, focuses error feedback, and supports native keyboard controls. Optional radios can be cleared. Use the canonical `interactionId` so two identical questions on different turns do not share a draft. Initial values must come from host-validated saved answers. The host marks acknowledged answers read-only and controls uncertain retries. See the [React and host integration guide](docs/INTEGRATION.md).

React is an optional peer. Core and provider-adapter consumers do not need React or React DOM. Native clients can register trusted adapters with `createControlRegistry`.

## Provider adapters

`ontave/adapters` supplies tool definitions and completed-call parsers without importing a provider SDK or making a model call:

| API | Tool definition | Parser |
| --- | --- | --- |
| OpenAI Responses | `openAIInteractionTool()` | `parseOpenAIInteraction(call)` |
| OpenAI Chat Completions | `openAIChatInteractionTool()` | `parseOpenAIChatInteraction(call)` |
| Anthropic Messages | `anthropicInteractionTool()` | `parseAnthropicInteraction(block)` |
| Google Gemini / GenAI | `geminiInteractionTool()` | `parseGeminiInteraction(functionCall)` |

Pass a supported kind list to any definition builder, such as `openAIInteractionTool(['text', 'select'])`. All parsers revalidate the full canonical contract, including cross-field rules that JSON Schema cannot express. Parse completed calls only, and retain original provider IDs and conversation metadata in the host. [Provider integration and API references](docs/PROVIDERS.md). Run `npm run example:providers` for offline round trips.

## Portable replies

`encodeInteractiveReply(answer, interaction)` creates a versioned envelope capped at 9,000 UTF-8 bytes. Save it atomically with your ordinary assistant answer. `decodeInteractiveReply` validates readback, and `interactiveText` gives history/export clients a readable fallback. Ontave also reads receipts from the original Daltn Interactive Chat foundation. Markers are representations, not signatures.

The host owns authenticated access, canonical-turn lookup, staleness, idempotency, retry identity, persistence, and tool approval. Controls capture conversational context. They cannot install code, dispatch arbitrary tools, or authorize business actions. Read [SECURITY.md](SECURITY.md).

## Verify

```sh
npm test
npm run typecheck
npm run build:website
npm run example:providers
npm run verify:package
npm run verify:application
```

CI runs the suite and consumer-package checks on Node.js 24 and 26. Tests cover interactions, application validation, isolated/authorized CRUD, atomic rollback, references, optimistic revisions, persistent retries, source ownership, and React navigation/error behavior. These are deterministic checks; live model quality and paid-provider acceptance are not claimed.

The website build checks the landing page, interaction playground, application workbench, downloadable package, metadata, local links/assets, and production script/CSP boundaries. The public landing page is [ontave.daltn.tech](https://ontave.daltn.tech/).

The package verifier installs the actual tarball in a temporary consumer, exercises all public ESM exports and declarations, checks installation without React, and renders both modules with React 18. The application verifier extracts a real ZIP, installs and builds its editable code, and checks the backend across a process restart. Runtime dependencies exclude model clients, databases, product code, and credentials.

MIT licensed. Derived from [Daltn Interactive Chat](https://github.com/smileplis/daltn-interactive-chat). The earlier Ontave releases retain their Apache 2.0 license. See [migration and provenance](docs/MIGRATION.md).
