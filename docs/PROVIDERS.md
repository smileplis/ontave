# Provider adapters

Import definitions and parsers from `ontave/adapters`. These are SDK-independent data adapters. They make no HTTP request, select no model, install no handlers, and perform no tool execution. The host retains its SDK, credentials, budgets, conversation loop, call IDs, refusals, and retry policy.

## OpenAI Responses

```ts
import {openAIInteractionTool, parseOpenAIInteraction, INTERACTION_TOOL_NAME} from 'ontave/adapters';

// Add to your existing Responses request; do not add another model call to draw UI.
const tools = [openAIInteractionTool()];
// Once the request is complete:
for (const item of response.output) {
  if (item.type === 'function_call' && item.name === INTERACTION_TOOL_NAME) {
    const interaction = parseOpenAIInteraction(item);
    // Persist with item.call_id and your canonical turn, then wait for the user.
  }
}
```

For Chat Completions, use `openAIChatInteractionTool()` and `parseOpenAIChatInteraction(toolCall)` on the nested `message.tool_calls` entries. The Responses definition uses flat `name`, `parameters`, and `strict: true`; Chat uses the `function` wrapper. All object properties are explicit and extra properties are rejected. Cross-field rules still require runtime validation.

## Anthropic Messages

```ts
import {anthropicInteractionTool, parseAnthropicInteraction, INTERACTION_TOOL_NAME} from 'ontave/adapters';

const tools = [anthropicInteractionTool()];
for (const block of response.content) {
  if (block.type === 'tool_use' && block.name === INTERACTION_TOOL_NAME) {
    const interaction = parseAnthropicInteraction(block);
    // Persist the spec and block.id; suspend the turn while awaiting a response.
  }
}
```

The definition uses `input_schema`. It does not enable Anthropic strict mode: the provider's supported schema subset and model capabilities vary. The parser validates the input regardless of generation mode.

## Gemini / Google GenAI

```ts
import {geminiInteractionTool, parseGeminiInteraction, INTERACTION_TOOL_NAME} from 'ontave/adapters';

const tools = [geminiInteractionTool()];
for (const call of response.functionCalls ?? []) {
  if (call.name === INTERACTION_TOOL_NAME) {
    const interaction = parseGeminiInteraction(call);
    // Retain the original candidate/content, call ID and thought signatures in the host.
  }
}
```

Use this Tool in the GenAI request's `config.tools`. The function declaration uses `parametersJsonSchema`, not OpenAPI `parameters`. The adapter converts literal version constraints to `enum` and removes string-length/pattern keywords from Google's generation schema. Runtime parsing still enforces all string bounds, kinds, versions, and cross-field rules.

## Capabilities, completion, and continuation

Every definition builder accepts a supported kind list, for example `geminiInteractionTool(['text', 'confirm'])`. Supply only kinds your client registry can render. A restricted generation schema does not replace server validation or client capability checks.

The tool name is `ontave_ask`. Parse one complete call at a time. Parsers reject the wrong tool name, malformed envelopes, incomplete JSON, unknown fields in the spec, unsupported versions/kinds, invalid cross-field constraints, and arguments over 24,000 UTF-8 bytes. They return a normalized interaction specification, not an authorization grant or a provider message.

The host must handle missing calls, refusals, incomplete/streaming output and multiple calls. Do not auto-execute unrelated calls merely because a question was returned. Persist the spec before displaying it, wait for the user's context, and continue the same conversation using the provider's matching function result. Retain original IDs, signed thinking metadata, and messages; the library never reconstructs them. Use normalized values plus `formatResponse` for the conversational result, while retaining the host's tool approval policy.

The offline example uses synthetic completed-call fixtures. No paid-provider or model-accuracy acceptance is implied. Provider-specific schema acceptance should be verified against the model/API combination you deploy.

## API references

Envelope fields were checked against the official [OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling), [Anthropic tool definition guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), and [Gemini FunctionDeclaration and FunctionCall reference](https://ai.google.dev/api/generate-content#FunctionDeclaration) on 27 October 2026.
