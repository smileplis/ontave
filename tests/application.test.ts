import {describe, expect, it} from 'vitest';
import {ApplicationDefinition, ApplicationError, ApplicationValues, createApplicationModuleRegistry, createApplicationRuntime, createMemoryApplicationStore, defineApplicationModule, standardApplicationModules, validateApplicationValues, type ApplicationContext} from '../src/application.js';
import {generateApplication, parseApplicationOutput} from '../src/application-model.js';
import {exampleApplication} from '../examples/application/definition.js';
import {z} from 'zod';
const context = {actorId: 'alice', workspaceId: 'workspace-a'};
const allow = () => true;
const setup = () => createApplicationRuntime({definition: exampleApplication(), store: createMemoryApplicationStore(), authorize: allow});
const create = (requestId: string, values = {name: 'Ada'}) => ({kind: 'create', entity: 'leads', requestId, values} as const);

describe('application contracts', () => {
  it('validates complete applications and rejects unknown executable fields and broken references', () => {
    const definition = exampleApplication();
    expect(ApplicationDefinition.parse(definition)).toEqual(definition);
    expect(ApplicationDefinition.safeParse({...definition, execute: 'publish'}).success).toBe(false);
    expect(ApplicationDefinition.safeParse({...definition, pages: [{...definition.pages[1], entity: 'missing'}]}).success).toBe(false);
    expect(ApplicationDefinition.safeParse({...definition, pages: [{...definition.pages[1], fields: ['secret']}]}).success).toBe(false);
    expect(ApplicationDefinition.safeParse({...definition, entities: [definition.entities[1]]}).success).toBe(false);
    expect(ApplicationDefinition.safeParse({...definition, entities: [definition.entities[0], definition.entities[0]]}).success).toBe(false);
    expect(ApplicationValues.safeParse(JSON.parse('{"__proto__":"bad"}')).success).toBe(false);
    expect(ApplicationValues.safeParse({[Symbol('hidden')]: 1}).success).toBe(false);
  });
  it('normalizes fields, defaults, explicit false and zero, and rejects invalid dates/types', () => {
    const entity = exampleApplication().entities[0];
    expect(validateApplicationValues(entity, {name: ' Ada ', value: 0, active: false})).toEqual({name: 'Ada', value: 0, status: 'new', active: false});
    for (const input of [{name: ''}, {name: 'Ada', value: '4'}, {name: 'Ada', value: -1}, {name: 'Ada', status: 'invented'}, {name: 'Ada', next_contact: '2026-02-29'}, {name: 'Ada', next_contact: '2026-99-99'}, {name: 'Ada', admin: true}]) expect(() => validateApplicationValues(entity, input)).toThrow();
    expect(validateApplicationValues(entity, {name: 'Ada', next_contact: '2028-02-29'}).next_contact).toBe('2028-02-29');
  });
  it('freezes runtime definitions so callers cannot replace the canonical spec', () => {
    const definition = exampleApplication(), runtime = createApplicationRuntime({definition, store: createMemoryApplicationStore(), authorize: allow});
    definition.entities[0].fields[0].required = false;
    expect(runtime.definition.entities[0].fields[0].required).toBe(true);
    expect(Object.isFrozen(runtime.definition.entities[0].fields)).toBe(true);
  });
});

describe('transactional application runtime', () => {
  it('creates, reads, updates and deletes validated records with optimistic revisions', async () => {
    const runtime = setup(), receipt = await runtime.execute(context, create('create-1'));
    expect(receipt.record).toMatchObject({revision: 1, values: {name: 'Ada', status: 'new', active: true}});
    const row = receipt.record!;
    expect(await runtime.list(context, 'leads')).toHaveLength(1);
    expect(await runtime.get(context, 'leads', row.id)).toEqual(row);
    await runtime.execute(context, {kind: 'update', entity: 'leads', id: row.id, expectedRevision: 1, requestId: 'update-1', values: {...row.values, name: 'Grace'}});
    await expect(runtime.execute(context, {kind: 'delete', entity: 'leads', id: row.id, expectedRevision: 1, requestId: 'stale-delete'})).rejects.toMatchObject({code: 'CONFLICT'});
    await runtime.execute(context, {kind: 'delete', entity: 'leads', id: row.id, expectedRevision: 2, requestId: 'delete-1'});
    expect(await runtime.list(context, 'leads')).toEqual([]);
  });
  it('commits records, effects and idempotency receipts together and supports exact uncertain retries', async () => {
    const runtime = setup();
    const [first, second] = await Promise.all([runtime.execute(context, create('same')), runtime.execute(context, create('same'))]);
    expect(first).toEqual(second);
    expect(await runtime.list(context, 'leads')).toHaveLength(1);
    const effects = await runtime.pendingEffects(context);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({topic: 'lead.created', payload: {name: 'Ada'}});
    await expect(runtime.execute(context, create('same', {name: 'Different'}))).rejects.toMatchObject({code: 'CONFLICT'});
    await runtime.acknowledgeEffect(context, effects[0].id);
    expect(await runtime.pendingEffects(context)).toEqual([]);
    expect(await runtime.execute(context, create('same'))).toEqual(first);
    expect(await runtime.pendingEffects(context)).toEqual([]);
  });
  it('isolates workspaces and applications, and does not trust context claims in a command', async () => {
    const runtime = setup();
    await runtime.execute(context, create('same'));
    expect(await runtime.list({...context, workspaceId: 'workspace-b'}, 'leads')).toEqual([]);
    await runtime.execute({...context, workspaceId: 'workspace-b'}, create('same', {name: 'Bob'}));
    expect((await runtime.list(context, 'leads'))[0].values.name).toBe('Ada');
    await expect(runtime.execute(context, {...create('forged'), workspaceId: 'workspace-b'})).rejects.toThrow();
  });
  it('requires host authorization and filters records using the host read policy', async () => {
    const store = createMemoryApplicationStore(), definition = exampleApplication();
    const runtime = createApplicationRuntime({definition, store, authorize: (_context, permission) => permission.kind !== 'get' || permission.record?.values.name !== 'Private'});
    await createApplicationRuntime({definition, store, authorize: allow}).execute(context, create('private', {name: 'Private'}));
    expect(await runtime.list(context, 'leads')).toEqual([]);
    await expect(runtime.execute(context, create('private', {name: 'Private'}))).rejects.toMatchObject({code: 'FORBIDDEN'});
    const blocked = createApplicationRuntime({definition, store, authorize: () => false});
    await expect(blocked.execute(context, create('forbidden'))).rejects.toMatchObject({code: 'FORBIDDEN'});
    await expect(blocked.list(context, 'leads')).rejects.toMatchObject({code: 'FORBIDDEN'});
    await expect(blocked.pendingEffects(context)).rejects.toMatchObject({code: 'FORBIDDEN'});
  });
  it('rejects concurrent conflicting revisions rather than losing edits', async () => {
    const runtime = setup(), row = (await runtime.execute(context, create('start'))).record!;
    const outcomes = await Promise.allSettled(['Ada 1', 'Ada 2'].map((name, i) => runtime.execute(context, {kind: 'update', entity: 'leads', id: row.id, expectedRevision: 1, requestId: `edit-${i}`, values: {...row.values, name}})));
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect((await runtime.get(context, 'leads', row.id)).revision).toBe(2);
  });
  it('enforces references and blocks deletion while dependent records exist', async () => {
    const runtime = setup(), lead = (await runtime.execute(context, create('lead'))).record!;
    await expect(runtime.execute(context, {kind: 'create', entity: 'tasks', requestId: 'missing', values: {title: 'Follow up', lead: 'missing'}})).rejects.toThrow('referenced record');
    const task = (await runtime.execute(context, {kind: 'create', entity: 'tasks', requestId: 'task', values: {title: 'Follow up', lead: lead.id}})).record!;
    await expect(runtime.execute(context, {kind: 'delete', entity: 'leads', id: lead.id, expectedRevision: 1, requestId: 'delete-referenced'})).rejects.toMatchObject({code: 'CONFLICT'});
    await runtime.execute(context, {kind: 'delete', entity: 'tasks', id: task.id, expectedRevision: 1, requestId: 'delete-task'});
    await runtime.execute(context, {kind: 'delete', entity: 'leads', id: lead.id, expectedRevision: 1, requestId: 'delete-lead'});
  });
  it('pins the complete definition and rejects silent schema changes', async () => {
    const definition = exampleApplication(), store = createMemoryApplicationStore();
    await createApplicationRuntime({definition, store, authorize: allow}).execute(context, create('first'));
    definition.entities[0].label = 'Changed without a revision';
    const changed = createApplicationRuntime({definition, store, authorize: allow});
    await expect(changed.list(context, 'leads')).rejects.toMatchObject({code: 'CONFLICT'});
  });
  it('rolls back all writes and effects if a registered workflow fails validation', async () => {
    const definition = exampleApplication();
    definition.workflows[0].steps.push({use: 'record.set', version: 1, config: {status: 'fabricated'}});
    const runtime = createApplicationRuntime({definition, store: createMemoryApplicationStore(), authorize: allow});
    await expect(runtime.execute(context, create('atomic'))).rejects.toThrow('offered value');
    expect(await runtime.list(context, 'leads')).toEqual([]);
    expect(await runtime.pendingEffects(context)).toEqual([]);
  });
});

describe('host-installed modules and model portability', () => {
  it('installs typed modules while rejecting unknown modules and invalid config', async () => {
    const custom = defineApplicationModule({name: 'custom.rename', version: 1, description: 'A trusted example module.', config: z.strictObject({name: z.string().min(1)}), run: (_context, config) => ({patch: {name: config.name}})});
    const modules = createApplicationModuleRegistry([...standardApplicationModules, custom]);
    const definition = exampleApplication(); definition.workflows[0].steps.push({use: 'custom.rename', version: 1, config: {name: 'Renamed'}});
    const runtime = createApplicationRuntime({definition, store: createMemoryApplicationStore(), authorize: allow, modules});
    expect((await runtime.execute(context, create('module'))).record?.values.name).toBe('Renamed');
    expect(() => createApplicationRuntime({definition, store: createMemoryApplicationStore(), authorize: allow})).toThrow('Install application module');
    expect(() => createApplicationModuleRegistry([custom, custom])).toThrow('duplicate');
  });
  it('uses one host model attempt and validates definitions before accepting them', async () => {
    let calls = 0;
    const generated = await generateApplication({generate: async request => { calls++; expect(request.modules.some(module => module.name === 'event.emit')).toBe(true); expect(request.views).toContain('collection'); return JSON.stringify(exampleApplication()); }}, 'Build a lead tracker and linked follow-up tasks.');
    expect(generated.entities).toHaveLength(2); expect(calls).toBe(1);
    expect(() => parseApplicationOutput('```json\n{}\n```')).toThrow();
    await expect(generateApplication({generate: async () => ({...exampleApplication(), pages: [{...exampleApplication().pages[0], kind: 'remote_code'}]})}, 'Build an app')).rejects.toThrow('does not support view');
    await expect(generateApplication({generate: async () => { throw new Error('Provider failed'); }}, 'Build an app')).rejects.toThrow('Provider failed');
  });
  it('rejects malformed module results instead of acknowledging a silently skipped workflow', async () => {
    const invalid = {...standardApplicationModules[0], name: 'custom.invalid', run: () => Promise.resolve({patch: {name: 'Never committed'}})};
    const modules = createApplicationModuleRegistry([invalid as unknown as typeof standardApplicationModules[number]]);
    const definition = exampleApplication(); definition.workflows = [{key:'invalid', entity:'leads', on:'create', steps:[{use:'custom.invalid',version:1,config:{}}]}];
    const runtime = createApplicationRuntime({definition, store:createMemoryApplicationStore(), authorize:allow, modules});
    await expect(runtime.execute(context,create('invalid'))).rejects.toMatchObject({code:'MODULE'});
    expect(await runtime.list(context,'leads')).toEqual([]);
  });
});
