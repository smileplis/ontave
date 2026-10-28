# Ontave

Interactive conversations for AI agents. Ask a focused question, render a trusted control, validate the answer, and continue the same conversation.

Ontave is a small TypeScript framework with strict contracts, portable saved replies, provider adapters, and an optional React renderer. The core needs only Zod. Models choose bounded data; the host owns the conversation, storage, permissions, and actions.

**0.2.0-alpha.1 — source preview.** The Ontave name now belongs to this interactive conversation framework, replacing the earlier ontology framework. It is a different API and has not been published to npm. Existing `ontave@0.1.x` installations still contain the previous framework. Read the [migration guide](docs/MIGRATION.md) before changing dependencies. Earlier releases and Git history remain available.

## Try it locally

Use Node.js 24:

```sh
git clone https://github.com/smileplis/ontave.git
cd ontave
npm ci
npm run dev
```

Open the localhost URL printed by Vite for the landing page and `/playground/` for all ten controls, saved readback, validation, and a simulated failed send. It uses fictional fixtures in your browser, with no model key, database, or network request to a provider. Demo answers stay in session storage for that browser tab.

To use this source preview in another project, run `npm pack` in the clone, then install the resulting `ontave-0.2.0-alpha.1.tgz`. The tarball includes compiled modules, declarations, styles, and integration documentation.

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
```

CI runs the suite and consumer-package checks on Node.js 24 and 26. Tests cover all ten controls, provider envelope fixtures, malformed output, keyboard use, pending/retry behavior, read-only history, and original chat receipts. These are deterministic checks; live paid-provider acceptance is not claimed.

The website build checks the landing page and playground, page metadata, local links/assets, and production script/CSP boundaries. The public landing page is [ontave.daltn.tech](https://ontave.daltn.tech/).

The package verifier installs the actual tarball in a temporary consumer, exercises its public exports and TypeScript declarations, and checks that core installation works without React. Runtime dependencies exclude model clients, databases, product code, and credentials.

MIT licensed. Derived from [Daltn Interactive Chat](https://github.com/smileplis/daltn-interactive-chat). The earlier Ontave releases retain their Apache 2.0 license. See [migration and provenance](docs/MIGRATION.md).
