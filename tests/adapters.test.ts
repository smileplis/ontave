import {describe, expect, it} from 'vitest';
import {CONTROL_KINDS} from '../src/index.js';
import {INTERACTION_TOOL_NAME as name, MAX_TOOL_ARGUMENT_BYTES, anthropicInteractionTool, geminiInteractionTool, interactionJSONSchema, openAIChatInteractionTool, openAIInteractionTool, parseAnthropicInteraction, parseGeminiInteraction, parseOpenAIChatInteraction, parseOpenAIInteraction} from '../src/adapters.js';
import {control, interaction} from './fixtures.js';

const spec = interaction();
const cases = [
  {provider: 'OpenAI Responses', parse: parseOpenAIInteraction, call: (input: unknown) => ({type: 'function_call', name, call_id: 'call-1', arguments: JSON.stringify(input)})},
  {provider: 'OpenAI Chat', parse: parseOpenAIChatInteraction, call: (input: unknown) => ({type: 'function', id: 'call-1', function: {name, arguments: JSON.stringify(input)}})},
  {provider: 'Anthropic', parse: parseAnthropicInteraction, call: (input: unknown) => ({type: 'tool_use', id: 'call-1', name, input})},
  {provider: 'Gemini', parse: parseGeminiInteraction, call: (args: unknown) => ({name, id: 'call-1', args})},
];

describe('provider tool definitions', () => {
  it('uses each API envelope with the same bounded interaction schema', () => {
    const openAI = openAIInteractionTool();
    expect(openAI).toMatchObject({type: 'function', name, strict: true, parameters: {additionalProperties: false}});
    expect(openAIChatInteractionTool()).toEqual({type: 'function', function: {name, description: openAI.description, strict: true, parameters: openAI.parameters}});
    expect(anthropicInteractionTool().input_schema).toEqual(openAI.parameters);
    const google = geminiInteractionTool().functionDeclarations[0];
    expect(google.name).toBe(name);
    expect(google.parametersJsonSchema).toMatchObject({type: 'object', additionalProperties: false, properties: {version: {enum: [1]}}});
    expect(JSON.stringify(google)).not.toContain('minLength');
    expect(JSON.stringify(openAI)).not.toContain('$schema');
  });
  it('can advertise only host-installed controls without changing global capabilities', () => {
    const schema = interactionJSONSchema(['text', 'select']);
    expect(schema).toMatchObject({properties: {controls: {items: {properties: {kind: {enum: ['text', 'select']}}}}}});
    expect(openAIInteractionTool(['rating']).parameters).toMatchObject({properties: {controls: {items: {properties: {kind: {enum: ['rating']}}}}}});
    expect(anthropicInteractionTool(['text']).input_schema).toMatchObject({properties: {controls: {items: {properties: {kind: {enum: ['text']}}}}}});
    expect(CONTROL_KINDS).toHaveLength(10);
    expect(() => interactionJSONSchema([])).toThrow();
    expect(() => interactionJSONSchema(['text', 'text'])).toThrow('distinct');
  });
  it('returns isolated definitions so provider mutations do not affect later requests', () => {
    const first = openAIInteractionTool();
    first.parameters.additionalProperties = true;
    expect(openAIInteractionTool().parameters.additionalProperties).toBe(false);
  });
});

for (const {provider, parse, call} of cases) describe(provider, () => {
  it('parses a completed call with provider metadata and retains only the validated spec', () => {
    expect(parse(call(spec))).toEqual(spec);
    expect(parse(call(interaction(control('rating'))))).toEqual(interaction(control('rating')));
  });
  it('rejects arbitrary executable fields and invalid cross-field contracts', () => {
    expect(() => parse(call({...spec, execute: 'publish'}))).toThrow();
    expect(() => parse(call({...spec, controls: [control('select', {options: []})]}))).toThrow();
    expect(() => parse(call({...spec, version: 99}))).toThrow();
  });
  it('rejects malformed envelopes and oversized arguments', () => {
    expect(() => parse({name: 'send_email'})).toThrow();
    expect(() => parse(call({...spec, question: '界'.repeat(MAX_TOOL_ARGUMENT_BYTES / 2)}))).toThrow('too large');
    expect(() => parse(null)).toThrow();
  });
});

it('rejects incomplete JSON and object-provider inputs encoded as strings', () => {
  expect(() => parseOpenAIInteraction({type: 'function_call', name, arguments: '{"version":'})).toThrow('complete JSON');
  expect(() => parseAnthropicInteraction({type: 'tool_use', name, input: JSON.stringify(spec)})).toThrow();
  expect(() => parseGeminiInteraction({name, args: JSON.stringify(spec)})).toThrow();
  const circular: Record<string, unknown> = {}; circular.self = circular;
  expect(() => parseGeminiInteraction({name, args: circular})).toThrow('JSON data');
});
