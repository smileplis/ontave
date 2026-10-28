import {Interaction, formatResponse, validateResponse} from 'ontave';
import {
  INTERACTION_TOOL_NAME as name, anthropicInteractionTool, geminiInteractionTool,
  openAIChatInteractionTool, openAIInteractionTool, parseAnthropicInteraction,
  parseGeminiInteraction, parseOpenAIChatInteraction, parseOpenAIInteraction,
} from 'ontave/adapters';

// Fictional, completed provider output. No SDK, API key, model call, or network.
const spec = Interaction.parse({
  version: 1, question: 'How useful was this explanation?', description: null,
  controls: [{key: 'usefulness', label: 'Usefulness', kind: 'rating', required: true, options: [], min: null, max: null}],
  submitLabel: 'Continue',
});
const cases = [
  ['OpenAI Responses', openAIInteractionTool(), parseOpenAIInteraction, {type: 'function_call', name, call_id: 'fixture-1', arguments: JSON.stringify(spec)}],
  ['OpenAI Chat', openAIChatInteractionTool(), parseOpenAIChatInteraction, {type: 'function', id: 'fixture-1', function: {name, arguments: JSON.stringify(spec)}}],
  ['Anthropic Messages', anthropicInteractionTool(), parseAnthropicInteraction, {type: 'tool_use', id: 'fixture-1', name, input: spec}],
  ['Gemini', geminiInteractionTool(), parseGeminiInteraction, {name, args: spec}],
];
for (const [provider, definition, parse, call] of cases) {
  const savedSpec = parse(call);
  const values = validateResponse(savedSpec, {usefulness: 4});
  if (!JSON.stringify(definition).includes(name)) throw new Error('Missing tool definition.');
  console.log(`${provider}: ${formatResponse(savedSpec, values)}`);
}
