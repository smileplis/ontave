## Explicitly select a model

```ts
import { gemini } from "ontave/models/gemini";

const model = gemini({
  apiKey: process.env.GEMINI_API_KEY!,
  model: process.env.GEMINI_MODEL!,
});
```

Pass this adapter into `createOntave`. The factory requires a model identifier and key. It does not read environment variables itself or fall back to fictional results.

Gemini supports extraction and additive candidate generation. Before inference, it asks the provider to count the complete request, including instructions and output schema, against a maximum 16,384-token input budget. You may select a lower `maxInputTokens`. A counting failure fails closed. The inference output limit is 4,096 tokens.

## Experimental Groq

```ts
import { groq } from "ontave/models/groq";
const model = groq({
  apiKey: process.env.GROQ_API_KEY!,
  model: process.env.GROQ_MODEL!,
});
```

Groq currently supports extraction using JSON mode, followed by runtime validation. It does not implement proposal generation or provider-certified exact preflight token counting. Its conservative input-byte bound is experimental; it is not the first adapter's completed release-quality result.

## Custom adapter

Implement `ModelAdapter.extract(task)` returning `{ output, model, usage? }`. Output must match the extraction envelope with entities, relationships and observations. Every field/relation/observation needs source support. `propose(task)` is optional.

The task includes approved definitions, authorized identity candidates, source format and an AbortSignal. Honor aborts. The runtime also bounds non-cooperating adapters, validates all output and requires explicit review before effects.

## Failures and usage

Rate limits, network errors, refusal, malformed output and truncation do not become successful empty records. Workers record available usage or explicitly unknown usage. A crash may incur a repeated provider charge. Retain trial failures when measuring model quality.

Deterministic adapters under `ontave/testing` are for regression tests and examples, not production extraction claims.
