import {z} from 'zod';

export const APPLICATION_VERSION = 1 as const;
const Key = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).refine(value => !['constructor', 'prototype'].includes(value), 'Reserved key.');
const Identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const ModuleName = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/);
const Line = z.string().trim().min(1).max(160).refine(value => !/[\r\n\x00-\x1f]/.test(value), 'Use a readable line.');
export const ApplicationScalar = z.union([z.string().max(4000), z.number().finite().min(-1e12).max(1e12), z.boolean(), z.null()]);
export type ApplicationScalar = z.infer<typeof ApplicationScalar>;
const RawMap = z.custom<Record<string, unknown>>(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype) && Reflect.ownKeys(value).length <= 64 && Reflect.ownKeys(value).every(key => typeof key === 'string' && Key.safeParse(key).success);
}, 'Use a plain object with valid field keys.');
export const ApplicationValues = RawMap.pipe(z.record(Key, ApplicationScalar));
export type ApplicationValues = z.infer<typeof ApplicationValues>;
const Option = z.strictObject({value: Key, label: Line});
export const ApplicationField = z.strictObject({
  key: Key, label: Line,
  kind: z.enum(['text', 'textarea', 'number', 'boolean', 'date', 'select', 'reference']),
  required: z.boolean(), default: ApplicationScalar,
  options: z.array(Option).max(40), reference: Key.nullable(),
  min: z.number().finite().min(-1e12).max(1e12).nullable(), max: z.number().finite().min(-1e12).max(1e12).nullable(),
}).superRefine((field, ctx) => {
  if (field.kind === 'select' ? field.options.length < 2 : field.options.length !== 0) ctx.addIssue({code: 'custom', message: 'Only select fields have two to forty options.'});
  if (new Set(field.options.map(item => item.value)).size !== field.options.length || new Set(field.options.map(item => item.label.toLowerCase())).size !== field.options.length) ctx.addIssue({code: 'custom', message: 'Select values and labels must be distinct.'});
  if ((field.kind === 'reference') !== (field.reference !== null)) ctx.addIssue({code: 'custom', message: 'Reference fields require a target entity.'});
  if (field.kind !== 'number' && (field.min !== null || field.max !== null)) ctx.addIssue({code: 'custom', message: 'Only numbers have bounds.'});
  if (field.min !== null && field.max !== null && field.min > field.max) ctx.addIssue({code: 'custom', message: 'Invalid numeric bounds.'});
  if (field.default !== null) {
    try { fieldValue(field, field.default); }
    catch (error) { ctx.addIssue({code: 'custom', message: error instanceof Error ? error.message : 'Invalid default.'}); }
    if (field.kind === 'reference') ctx.addIssue({code: 'custom', message: 'Reference defaults must be null.'});
  }
});
export type ApplicationField = z.infer<typeof ApplicationField>;
export const ApplicationEntity = z.strictObject({key: Key, label: Line, fields: z.array(ApplicationField).min(1).max(32)}).superRefine((entity, ctx) => {
  if (new Set(entity.fields.map(field => field.key)).size !== entity.fields.length) ctx.addIssue({code: 'custom', message: 'Entity field keys must be distinct.'});
});
export type ApplicationEntity = z.infer<typeof ApplicationEntity>;
export const ApplicationPage = z.strictObject({key: Key, title: Line, kind: ModuleName, version: z.literal(1), entity: Key.nullable(), fields: z.array(Key).max(32)});
export type ApplicationPage = z.infer<typeof ApplicationPage>;
const Step = z.strictObject({use: ModuleName, version: z.literal(1), config: ApplicationValues});
export type ApplicationStep = z.infer<typeof Step>;
export const ApplicationDefinition = z.strictObject({
  version: z.literal(APPLICATION_VERSION), id: Key, revision: z.number().int().min(1).max(1e9), name: Line,
  description: z.string().trim().max(1000),
  entities: z.array(ApplicationEntity).min(1).max(32),
  pages: z.array(ApplicationPage).min(1).max(64),
  workflows: z.array(z.strictObject({key: Key, entity: Key, on: z.enum(['create', 'update', 'delete']), steps: z.array(Step).min(1).max(12)})).max(64),
}).superRefine((definition, ctx) => {
  for (const list of [definition.entities, definition.pages, definition.workflows]) if (new Set(list.map(item => item.key)).size !== list.length) ctx.addIssue({code: 'custom', message: 'Entity, page and workflow keys must be unique in their own namespace.'});
  const entities = new Map(definition.entities.map(entity => [entity.key, entity]));
  for (const entity of definition.entities) for (const field of entity.fields) if (field.reference && !entities.has(field.reference)) ctx.addIssue({code: 'custom', message: `Unknown reference entity: ${field.reference}.`});
  for (const page of definition.pages) {
    if (page.entity && !entities.has(page.entity)) ctx.addIssue({code: 'custom', message: `Unknown page entity: ${page.entity}.`});
    if (new Set(page.fields).size !== page.fields.length) ctx.addIssue({code: 'custom', message: 'Page fields must be distinct.'});
    if (page.kind === 'collection' && !page.entity) ctx.addIssue({code: 'custom', message: 'Collection pages need an entity.'});
    if (page.kind === 'dashboard' && (page.entity !== null || page.fields.length)) ctx.addIssue({code: 'custom', message: 'Dashboard pages use all accessible entities.'});
    for (const key of page.fields) if (!page.entity || !entities.get(page.entity)?.fields.some(field => field.key === key)) ctx.addIssue({code: 'custom', message: `Unknown page field: ${key}.`});
  }
  for (const workflow of definition.workflows) if (!entities.has(workflow.entity)) ctx.addIssue({code: 'custom', message: `Unknown workflow entity: ${workflow.entity}.`});
});
export type ApplicationDefinition = z.infer<typeof ApplicationDefinition>;

export type ApplicationErrorCode = 'VALIDATION' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'MODULE' | 'STORAGE';
export class ApplicationError extends Error {
  constructor(public readonly code: ApplicationErrorCode, message: string) { super(message); this.name = 'ApplicationError'; }
}
function fail(message: string): never { throw new ApplicationError('VALIDATION', message); }
function fieldValue(field: ApplicationField, raw: ApplicationScalar): ApplicationScalar {
  const value = typeof raw === 'string' ? raw.trim() : raw;
  if (value === null || value === '') {
    if (field.required) fail(`${field.label}: enter a value.`);
    return null;
  }
  if (field.kind === 'text' || field.kind === 'textarea') { if (typeof value !== 'string') fail(`${field.label}: enter text.`); }
  else if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field.label}: enter a finite number.`);
    if (field.min !== null && value < field.min || field.max !== null && value > field.max) fail(`${field.label}: number is outside its bounds.`);
  } else if (field.kind === 'boolean') { if (typeof value !== 'boolean') fail(`${field.label}: choose true or false.`); }
  else if (field.kind === 'select') { if (typeof value !== 'string' || !field.options.some(option => option.value === value)) fail(`${field.label}: choose an offered value.`); }
  else if (field.kind === 'reference') { if (typeof value !== 'string' || !Identifier.safeParse(value).success) fail(`${field.label}: choose a record.`); }
  else if (field.kind === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') || !Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(`${field.label}: enter a real date (YYYY-MM-DD).`);
  }
  return value;
}
export function validateApplicationValues(entity: ApplicationEntity, input: unknown): ApplicationValues {
  const values = ApplicationValues.parse(input), result: ApplicationValues = Object.create(null);
  for (const key of Object.keys(values)) if (!entity.fields.some(field => field.key === key)) fail(`Unknown field: ${key}.`);
  for (const field of entity.fields) {
    const value = Object.hasOwn(values, field.key) ? values[field.key] : field.default;
    const normalized = fieldValue(field, value);
    if (normalized !== null) result[field.key] = normalized;
  }
  return result;
}

export const ApplicationRecord = z.strictObject({id: Identifier, revision: z.number().int().min(1), values: ApplicationValues});
export type ApplicationRecord = z.infer<typeof ApplicationRecord>;
export const ApplicationCommand = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('create'), entity: Key, values: ApplicationValues, requestId: Identifier}),
  z.strictObject({kind: z.literal('update'), entity: Key, id: Identifier, expectedRevision: z.number().int().min(1), values: ApplicationValues, requestId: Identifier}),
  z.strictObject({kind: z.literal('delete'), entity: Key, id: Identifier, expectedRevision: z.number().int().min(1), requestId: Identifier}),
]);
export type ApplicationCommand = z.infer<typeof ApplicationCommand>;
export const ApplicationEffect = z.strictObject({id: Identifier, topic: ModuleName, entity: Key, recordId: Identifier, event: z.enum(['create', 'update', 'delete']), payload: ApplicationValues});
export type ApplicationEffect = z.infer<typeof ApplicationEffect>;
export const ApplicationReceipt = z.strictObject({requestId: Identifier, record: ApplicationRecord.nullable(), effects: z.array(ApplicationEffect).max(100)});
export type ApplicationReceipt = z.infer<typeof ApplicationReceipt>;
export type ApplicationContext = {workspaceId: string; actorId: string};
export type ApplicationPermission = {kind: 'list' | 'get' | 'create' | 'update' | 'delete' | 'effects'; entity: string | null; record?: ApplicationRecord | null};
export type ApplicationModuleContext = {definition: ApplicationDefinition; entity: ApplicationEntity; event: ApplicationCommand['kind']; record: ApplicationRecord; actorId: string; now: string};
export type ApplicationModuleResult = {patch?: ApplicationValues; effects?: {topic: string; payload: ApplicationValues}[]};
const ModuleResult = z.strictObject({patch: ApplicationValues.optional(), effects: z.array(z.strictObject({topic: ModuleName, payload: ApplicationValues})).max(100).optional()});
export type ApplicationModule = {
  name: string; version: 1; description: string; config: z.ZodType;
  run: (context: ApplicationModuleContext, config: unknown) => ApplicationModuleResult;
};
export function defineApplicationModule<S extends z.ZodType>(module: Omit<ApplicationModule, 'config' | 'run'> & {config: S; run: (context: ApplicationModuleContext, config: z.infer<S>) => ApplicationModuleResult}): ApplicationModule {
  return {...module, run: (context, input) => module.run(context, module.config.parse(input))};
}
export const standardApplicationModules: readonly ApplicationModule[] = Object.freeze([
  defineApplicationModule({name: 'record.set', version: 1, description: 'Set validated fields on the record within the current transaction.', config: ApplicationValues, run: (_context, config) => ({patch: config})}),
  defineApplicationModule({name: 'event.emit', version: 1, description: 'Queue a durable event for host-controlled dispatch. Does not call an external service.', config: z.strictObject({topic: ModuleName}), run: (context, config) => ({effects: [{topic: config.topic, payload: {...context.record.values}}]})}),
]);
export function createApplicationModuleRegistry(modules: readonly ApplicationModule[] = standardApplicationModules) {
  const installed = new Map<string, ApplicationModule>();
  for (const module of modules) {
    ModuleName.parse(module.name);
    if (module.version !== 1 || installed.has(`${module.name}@${module.version}`)) throw new ApplicationError('MODULE', 'Invalid or duplicate application module.');
    installed.set(`${module.name}@${module.version}`, {...module});
  }
  const resolve = (step: ApplicationStep) => {
    const module = installed.get(`${step.use}@${step.version}`);
    if (!module) throw new ApplicationError('MODULE', `Install application module ${step.use}@${step.version}.`);
    return module;
  };
  return Object.freeze({
    validate(step: ApplicationStep) { resolve(step).config.parse(step.config); },
    run(step: ApplicationStep, context: ApplicationModuleContext): ApplicationModuleResult {
      const module = resolve(step), output = module.run(context, module.config.parse(step.config));
      if (output instanceof Promise) void output.catch(() => {});
      const plain = output && typeof output === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(output));
      const result = ModuleResult.safeParse(plain ? output : null);
      if (!result.success) throw new ApplicationError('MODULE', `Module ${step.use} must return a synchronous validated patch or queued effects.`);
      return result.data;
    },
    describe() { return [...installed.values()].map(module => ({name: module.name, version: module.version, description: module.description, configSchema: z.toJSONSchema(module.config)})); },
  });
}
export type ApplicationModuleRegistry = ReturnType<typeof createApplicationModuleRegistry>;

export type StoredApplicationRequest = {fingerprint: string; receipt: ApplicationReceipt};
export interface ApplicationTransaction {
  revision(): Promise<number | null>;
  fingerprint(): Promise<string | null>;
  setRevision(revision: number, fingerprint: string): Promise<void>;
  list(entity: string): Promise<ApplicationRecord[]>;
  get(entity: string, id: string): Promise<ApplicationRecord | null>;
  put(entity: string, record: ApplicationRecord): Promise<void>;
  remove(entity: string, id: string): Promise<void>;
  request(key: string): Promise<StoredApplicationRequest | null>;
  saveRequest(key: string, value: StoredApplicationRequest): Promise<void>;
  effects(): Promise<ApplicationEffect[]>;
  putEffect(effect: ApplicationEffect): Promise<void>;
  acknowledgeEffect(id: string): Promise<void>;
}
/** Implementations must serialize conflicting transactions and atomically commit data, receipts and effects. */
export interface ApplicationStore {
  transaction<T>(scope: {applicationId: string; workspaceId: string}, operation: (transaction: ApplicationTransaction) => Promise<T>): Promise<T>;
}
export type ApplicationSnapshot = {revision: number | null; fingerprint: string | null; records: Record<string, ApplicationRecord[]>; requests: Record<string, StoredApplicationRequest>; effects: ApplicationEffect[]};
const clone = <T>(value: T): T => structuredClone(value);
export const emptyApplicationSnapshot = (): ApplicationSnapshot => ({revision: null, fingerprint: null, records: Object.create(null), requests: Object.create(null), effects: []});
/** Adapter helper; database adapters may implement ApplicationStore directly instead of storing snapshots. */
export function createSnapshotApplicationStore(adapter: {load(scope: {applicationId: string; workspaceId: string}): Promise<ApplicationSnapshot | null>; save(scope: {applicationId: string; workspaceId: string}, snapshot: ApplicationSnapshot): Promise<void>}): ApplicationStore {
  const locks = new Map<string, Promise<unknown>>();
  return {async transaction(scope, operation) {
    const key = JSON.stringify([scope.applicationId, scope.workspaceId]);
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const snapshot = clone(await adapter.load(scope) ?? emptyApplicationSnapshot());
      const before = JSON.stringify(snapshot);
      const transaction: ApplicationTransaction = {
        revision: async () => snapshot.revision,
        fingerprint: async () => snapshot.fingerprint,
        setRevision: async (revision, fingerprint) => { snapshot.revision = revision; snapshot.fingerprint = fingerprint; },
        list: async entity => clone(snapshot.records[entity] ?? []),
        get: async (entity, id) => clone(snapshot.records[entity]?.find(row => row.id === id) ?? null),
        put: async (entity, record) => { const rows = snapshot.records[entity] ??= []; const index = rows.findIndex(row => row.id === record.id); if (index < 0) rows.push(clone(record)); else rows[index] = clone(record); },
        remove: async (entity, id) => { snapshot.records[entity] = (snapshot.records[entity] ?? []).filter(row => row.id !== id); },
        request: async key => clone(snapshot.requests[key] ?? null),
        saveRequest: async (key, value) => { snapshot.requests[key] = clone(value); },
        effects: async () => clone(snapshot.effects),
        putEffect: async effect => { if (snapshot.effects.some(item => item.id === effect.id)) throw new ApplicationError('CONFLICT', 'Duplicate effect ID.'); snapshot.effects.push(clone(effect)); },
        acknowledgeEffect: async id => { snapshot.effects = snapshot.effects.filter(item => item.id !== id); },
      };
      const result = await operation(transaction);
      if (JSON.stringify(snapshot) !== before) await adapter.save(scope, clone(snapshot));
      return clone(result);
    });
    locks.set(key, current);
    try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
  }};
}
export function createMemoryApplicationStore(): ApplicationStore {
  const snapshots = new Map<string, ApplicationSnapshot>();
  const key = (scope: {applicationId: string; workspaceId: string}) => JSON.stringify([scope.applicationId, scope.workspaceId]);
  return createSnapshotApplicationStore({load: async scope => snapshots.get(key(scope)) ?? null, save: async (scope, state) => { snapshots.set(key(scope), clone(state)); }});
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
export function createApplicationRuntime(options: {
  definition: ApplicationDefinition; store: ApplicationStore;
  authorize: (context: ApplicationContext, permission: ApplicationPermission) => boolean | Promise<boolean>;
  modules?: ApplicationModuleRegistry; id?: () => string; now?: () => string;
}) {
  if (typeof options.authorize !== 'function') throw new ApplicationError('FORBIDDEN', 'Install a host authorization policy.');
  const definition = freeze(ApplicationDefinition.parse(options.definition)), modules = options.modules ?? createApplicationModuleRegistry();
  for (const workflow of definition.workflows) for (const step of workflow.steps) modules.validate(step);
  const definitionFingerprint = canonical(definition);
  const id = options.id ?? (() => crypto.randomUUID()), now = options.now ?? (() => new Date().toISOString());
  const entity = (key: string) => { const value = definition.entities.find(item => item.key === key); if (!value) throw new ApplicationError('NOT_FOUND', 'Unknown entity.'); return value; };
  async function permit(context: ApplicationContext, permission: ApplicationPermission) {
    if (!context || !z.string().min(1).max(200).safeParse(context.actorId).success || !z.string().min(1).max(200).safeParse(context.workspaceId).success || !await options.authorize({...context}, clone(permission))) throw new ApplicationError('FORBIDDEN', 'Access denied.');
  }
  async function transaction<T>(context: ApplicationContext, operation: (tx: ApplicationTransaction) => Promise<T>) {
    return options.store.transaction({applicationId: definition.id, workspaceId: context.workspaceId}, async tx => {
      const revision = await tx.revision();
      if (revision !== null && (revision !== definition.revision || await tx.fingerprint() !== definitionFingerprint)) throw new ApplicationError('CONFLICT', 'Application definition changed. Apply an explicit data migration before using this revision.');
      return operation(tx);
    });
  }
  async function references(tx: ApplicationTransaction, context: ApplicationContext, schema: ApplicationEntity, values: ApplicationValues) {
    for (const field of schema.fields) if (field.reference && values[field.key] !== undefined) {
      const target = await tx.get(field.reference, String(values[field.key]));
      if (!target || !await options.authorize({...context}, {kind: 'get', entity: field.reference, record: clone(target)})) fail(`${field.label}: referenced record is not available in this workspace.`);
    }
  }
  return Object.freeze({
    definition,
    async list(context: ApplicationContext, key: string) {
      await permit(context, {kind: 'list', entity: key}); const schema = entity(key);
      return transaction(context, async tx => {
        const visible: ApplicationRecord[] = [];
        for (const row of await tx.list(key)) if (await options.authorize({...context}, {kind: 'get', entity: key, record: clone(row)})) visible.push({...ApplicationRecord.parse(row), values: validateApplicationValues(schema, row.values)});
        return visible;
      });
    },
    async get(context: ApplicationContext, key: string, recordId: string) {
      await permit(context, {kind: 'get', entity: key}); const schema = entity(key);
      return transaction(context, async tx => { const row = await tx.get(key, Identifier.parse(recordId)); if (!row) throw new ApplicationError('NOT_FOUND', 'Record not found.'); await permit(context, {kind: 'get', entity: key, record: row}); return {...ApplicationRecord.parse(row), values: validateApplicationValues(schema, row.values)}; });
    },
    async execute(context: ApplicationContext, input: unknown): Promise<ApplicationReceipt> {
      const command = ApplicationCommand.parse(input);
      await permit(context, {kind: command.kind, entity: command.entity}); const schema = entity(command.entity);
      return transaction(context, async tx => {
        const requestKey = JSON.stringify([context.actorId, command.requestId]), fingerprint = canonical({revision: definition.revision, command});
        const saved = await tx.request(requestKey);
        if (saved) { if (saved.fingerprint !== fingerprint) throw new ApplicationError('CONFLICT', 'Request ID was already used with different content.'); if (saved.receipt.record) await permit(context, {kind: 'get', entity: command.entity, record: await tx.get(command.entity, saved.receipt.record.id) ?? saved.receipt.record}); return ApplicationReceipt.parse(saved.receipt); }
        const existing = command.kind === 'create' ? null : await tx.get(command.entity, command.id);
        if (command.kind !== 'create') {
          if (!existing) throw new ApplicationError('NOT_FOUND', 'Record not found.');
          await permit(context, {kind: command.kind, entity: command.entity, record: existing});
          if (existing.revision !== command.expectedRevision) throw new ApplicationError('CONFLICT', 'This record changed. Reload it before editing.');
        }
        let record = command.kind === 'delete' ? existing! : {id: existing?.id ?? Identifier.parse(id()), revision: (existing?.revision ?? 0) + 1, values: validateApplicationValues(schema, command.values)};
        const effects: ApplicationEffect[] = [];
        for (const workflow of definition.workflows.filter(item => item.entity === command.entity && item.on === command.kind)) for (const step of workflow.steps) {
          const result = modules.run(step, {definition, entity: schema, event: command.kind, record: clone(record), actorId: context.actorId, now: now()});
          if (result.patch) {
            if (command.kind === 'delete') fail('Delete workflows cannot patch the deleted record.');
            record = {...record, values: validateApplicationValues(schema, {...record.values, ...ApplicationValues.parse(result.patch)})};
          }
          for (const effect of result.effects ?? []) {
            if (effects.length >= 100) fail('A command can queue at most 100 effects.');
            effects.push(ApplicationEffect.parse({...effect, id: id(), entity: command.entity, recordId: record.id, event: command.kind}));
          }
        }
        if (command.kind === 'delete') {
          for (const source of definition.entities) for (const field of source.fields.filter(field => field.reference === command.entity)) if ((await tx.list(source.key)).some(row => row.values[field.key] === record.id && !(source.key === command.entity && row.id === record.id))) throw new ApplicationError('CONFLICT', 'Other records reference this record. Update or delete them first.');
          await tx.remove(command.entity, record.id);
        } else { await permit(context, {kind: 'get', entity: command.entity, record: clone(record)}); await references(tx, context, schema, record.values); if (!existing && await tx.get(command.entity, record.id)) throw new ApplicationError('CONFLICT', 'Record ID already exists.'); await tx.put(command.entity, record); }
        for (const effect of effects) await tx.putEffect(effect);
        const receipt = ApplicationReceipt.parse({requestId: command.requestId, record: command.kind === 'delete' ? null : record, effects});
        await tx.setRevision(definition.revision, definitionFingerprint); await tx.saveRequest(requestKey, {fingerprint, receipt});
        return receipt;
      });
    },
    async pendingEffects(context: ApplicationContext) { await permit(context, {kind: 'effects', entity: null}); return transaction(context, tx => tx.effects()); },
    async acknowledgeEffect(context: ApplicationContext, effectId: string) { await permit(context, {kind: 'effects', entity: null}); return transaction(context, tx => tx.acknowledgeEffect(Identifier.parse(effectId))); },
  });
}
export type ApplicationRuntime = ReturnType<typeof createApplicationRuntime>;
export interface ApplicationClient {
  readonly definition: ApplicationDefinition;
  list(entity: string): Promise<ApplicationRecord[]>;
  execute(command: ApplicationCommand): Promise<ApplicationReceipt>;
}
/** Suitable for server composition or a fictional local demo; a browser context is not authenticated authority. */
export function createRuntimeApplicationClient(runtime: ApplicationRuntime, context: ApplicationContext): ApplicationClient {
  const trustedContext = {...context};
  return Object.freeze({definition: runtime.definition, list: (entity: string) => runtime.list(trustedContext, entity), execute: (command: ApplicationCommand) => runtime.execute(trustedContext, command)});
}
