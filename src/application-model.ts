import {z} from 'zod';
import {ApplicationDefinition, createApplicationModuleRegistry, type ApplicationModuleRegistry} from './application.js';

export interface ApplicationModel {
  generate(request: {intent: string; schema: Record<string, unknown>; modules: ReturnType<ApplicationModuleRegistry['describe']>; views: readonly string[]; instructions: string}): Promise<unknown>;
}
export const MAX_APPLICATION_BYTES = 512000;
export function parseApplicationOutput(output: unknown): ApplicationDefinition {
  const raw = typeof output === 'string' ? output : JSON.stringify(output);
  if (!raw || raw.length > MAX_APPLICATION_BYTES || new TextEncoder().encode(raw).length > MAX_APPLICATION_BYTES) throw new Error('Application output is missing or too large.');
  return ApplicationDefinition.parse(typeof output === 'string' ? JSON.parse(raw) : output);
}
/** One explicit generation attempt through the host's SDK/budget. No provider package or hidden retry is installed. */
export async function generateApplication(model: ApplicationModel, intent: string, options: {modules?: ApplicationModuleRegistry; views?: readonly string[]} = {}): Promise<ApplicationDefinition> {
  const prompt = z.string().trim().min(1).max(12000).parse(intent);
  const modules = options.modules ?? createApplicationModuleRegistry(), views = options.views ?? ['collection', 'dashboard'];
  const {$schema: _dialect, ...schema} = z.toJSONSchema(ApplicationDefinition);
  const output = await model.generate({intent: prompt, schema, modules: modules.describe(), views,
    instructions: 'Return one complete application definition as JSON. Use only advertised workflow modules and views. Include every schema property. No source code, credentials, endpoints or dependencies belong in this definition. Use null defaults for unanswered fields; selection options only for select fields. A collection needs an entity and visible field keys; a dashboard has entity null and fields []. Reference fields name an existing entity. This definition does not approve deployment or external actions.',
  });
  const definition = parseApplicationOutput(output);
  for (const page of definition.pages) if (!views.includes(page.kind)) throw new Error(`The host does not support view ${page.kind}.`);
  for (const workflow of definition.workflows) for (const step of workflow.steps) modules.validate(step);
  return definition;
}
