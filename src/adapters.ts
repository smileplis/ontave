import {z} from 'zod';
import {Interaction, ControlKind, CONTROL_KINDS} from './index.js';

export const INTERACTION_TOOL_NAME = 'ontave_ask' as const;
export const MAX_TOOL_ARGUMENT_BYTES = 24000;
const description = 'Ask the user a focused question using up to three bounded context controls. Use empty options for non-selection controls and null numeric bounds unless kind is number. Rating is an integer from 1 to 5. Choices collect context only and never authorize or execute actions.';

/** Fresh JSON schema on each call: providers cannot mutate another adapter's schema. */
export function interactionJSONSchema(kinds: readonly ControlKind[] = CONTROL_KINDS) {
  const supported = z.array(ControlKind).min(1).parse(kinds);
  if (new Set(supported).size !== supported.length) throw new Error('Control kinds must be distinct.');
  const {$schema: _dialect, ...schema} = z.toJSONSchema(Interaction);
  // Singleton enum works across the providers' supported JSON Schema subsets.
  schema.properties!.version = {type: 'number', enum: [1]};
  const controls = schema.properties!.controls as {items: {properties: Record<string, unknown>}};
  controls.items.properties.kind = {type: 'string', enum: supported};
  return schema;
}

/** OpenAI Responses API. Chat Completions uses the nested function wrapper below. */
export function openAIInteractionTool(kinds: readonly ControlKind[] = CONTROL_KINDS) {
  return {type: 'function' as const, name: INTERACTION_TOOL_NAME, description, strict: true, parameters: interactionJSONSchema(kinds)};
}

export function openAIChatInteractionTool(kinds: readonly ControlKind[] = CONTROL_KINDS) {
  const {type, ...definition} = openAIInteractionTool(kinds);
  return {type, function: definition};
}

export function anthropicInteractionTool(kinds: readonly ControlKind[] = CONTROL_KINDS) {
  return {name: INTERACTION_TOOL_NAME, description, input_schema: {...interactionJSONSchema(kinds), type: 'object' as const}};
}

/** Google GenAI Tool, using its JSON Schema field rather than OpenAPI parameters. */
export function geminiInteractionTool(kinds: readonly ControlKind[] = CONTROL_KINDS) {
  return {functionDeclarations: [{name: INTERACTION_TOOL_NAME, description, parametersJsonSchema: geminiSchema(interactionJSONSchema(kinds))}]};
}

// Google's schema subset does not enforce string bounds or patterns. Runtime parsing does.
function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (['minLength', 'maxLength', 'pattern'].includes(key)) return [];
    return [[key === 'const' ? 'enum' : key, key === 'const' ? [child] : geminiSchema(child)]];
  }));
}

const record = z.object({name: z.literal(INTERACTION_TOOL_NAME)});
const openAICall = record.extend({type: z.literal('function_call'), arguments: z.string()});
const openAIChatCall = z.object({type: z.literal('function'), function: record.extend({arguments: z.string()})});
const anthropicCall = record.extend({type: z.literal('tool_use'), input: z.unknown()});
const geminiCall = record.extend({args: z.unknown()});

function parseArguments(value: unknown, json = false): Interaction {
  let serialized: string | undefined;
  try { serialized = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { throw new Error('Tool arguments must be JSON data.'); }
  if (!serialized || serialized.length > MAX_TOOL_ARGUMENT_BYTES || new TextEncoder().encode(serialized).length > MAX_TOOL_ARGUMENT_BYTES) throw new Error('Tool arguments are missing or too large.');
  let parsed: unknown = value;
  if (json) {
    try { parsed = JSON.parse(serialized); }
    catch { throw new Error('Tool arguments must be complete JSON.'); }
  }
  return Interaction.parse(parsed);
}

/** Parse one completed call; the host selects the call and retains its provider ID. */
export function parseOpenAIInteraction(call: unknown): Interaction {
  return parseArguments(openAICall.parse(call).arguments, true);
}
export function parseOpenAIChatInteraction(call: unknown): Interaction {
  return parseArguments(openAIChatCall.parse(call).function.arguments, true);
}
export function parseAnthropicInteraction(call: unknown): Interaction {
  return parseArguments(anthropicCall.parse(call).input);
}
export function parseGeminiInteraction(call: unknown): Interaction {
  return parseArguments(geminiCall.parse(call).args);
}

