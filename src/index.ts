import {z} from 'zod';

export const INTERACTION_VERSION = 1 as const;
export const CONTROL_KINDS = Object.freeze(['single_choice', 'multi_choice', 'select', 'rating', 'text', 'textarea', 'number', 'date', 'time', 'confirm'] as const);
export const ControlKind = z.enum(CONTROL_KINDS);
export type ControlKind = z.infer<typeof ControlKind>;

const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(value => !['constructor', 'prototype'].includes(value), 'Use a non-reserved control key.');
const line = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), 'Use a single readable line.');
const Option = z.strictObject({value: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/), label: line(100)});
const bound = z.number().finite().min(-1e12).max(1e12).nullable();

/** Registered context controls. No action, URL, source code, tool name or authorization field exists. */
export const Control = z.strictObject({
  key: Key,
  label: line(160),
  kind: ControlKind,
  required: z.boolean(),
  options: z.array(Option).max(6),
  min: bound,
  max: bound,
}).superRefine((control, ctx) => {
  const choices = control.kind === 'single_choice' || control.kind === 'multi_choice' || control.kind === 'select';
  if (choices && control.options.length < 2) ctx.addIssue({code: 'custom', path: ['options'], message: 'Offer at least two choices.'});
  if (!choices && control.options.length !== 0) ctx.addIssue({code: 'custom', path: ['options'], message: 'Only selection controls have options.'});
  if (new Set(control.options.map(option => option.value)).size !== control.options.length) ctx.addIssue({code: 'custom', path: ['options'], message: 'Choice values must be unique.'});
  if (new Set(control.options.map(option => option.label.toLowerCase())).size !== control.options.length) ctx.addIssue({code: 'custom', path: ['options'], message: 'Choice labels must be distinct.'});
  if (control.kind !== 'number' && (control.min !== null || control.max !== null)) ctx.addIssue({code: 'custom', path: ['min'], message: 'Only number controls have numerical bounds.'});
  if (control.min !== null && control.max !== null && control.min > control.max) ctx.addIssue({code: 'custom', path: ['max'], message: 'The maximum must not be smaller than the minimum.'});
});
export type Control = z.infer<typeof Control>;

export const Interaction = z.strictObject({
  version: z.literal(INTERACTION_VERSION),
  question: line(240),
  description: z.string().trim().max(240).nullable(),
  controls: z.array(Control).min(1).max(3),
  submitLabel: line(40),
}).superRefine((interaction, ctx) => {
  if (new Set(interaction.controls.map(control => control.key)).size !== interaction.controls.length) ctx.addIssue({code: 'custom', path: ['controls'], message: 'Every control needs a distinct key.'});
});
export type Interaction = z.infer<typeof Interaction>;
export type InteractionSpec = Interaction;

const Value = z.union([z.string().max(1200), z.number().finite(), z.boolean(), z.array(z.string().max(60)).max(6)]);
// Check raw own keys first: object parsers can discard JavaScript's __proto__ key.
const RawValues = z.custom<Record<string, unknown>>(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length <= 3 && keys.every(key => typeof key === 'string' && Key.safeParse(key).success);
}, 'Use a response object with at most three valid control keys.');
export const InteractionValues = RawValues.pipe(z.record(Key, Value));
export type InteractionValues = z.infer<typeof InteractionValues>;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function invalid(label: string, reason: string): never { throw new Error(`${label}: ${reason}`); }

/** Revalidate against the canonical stored spec on the server, not a spec sent by the browser. */
export function validateResponse(rawSpec: Interaction, rawValues: unknown): InteractionValues {
  const spec = Interaction.parse(rawSpec), values = InteractionValues.parse(rawValues);
  if (Object.keys(values).some(key => !spec.controls.some(control => control.key === key))) throw new Error('This answer contains an unknown control.');
  const normalized: InteractionValues = Object.create(null);
  for (const control of spec.controls) {
    let value = values[control.key];
    if (typeof value === 'string') value = value.trim();
    const missing = value === undefined || value === '' || Array.isArray(value) && value.length === 0;
    if (missing) {
      if (control.required) invalid(control.label, 'choose or enter an answer.');
      continue;
    }
    switch (control.kind) {
      case 'single_choice':
      case 'select':
        if (typeof value !== 'string' || !control.options.some(option => option.value === value)) invalid(control.label, 'choose one of the offered options.');
        break;
      case 'multi_choice': {
        if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(item => !control.options.some(option => option.value === item))) invalid(control.label, 'choose distinct offered options.');
        // Spec order is canonical; click order must not change the response identity.
        const selected = new Set(value);
        value = control.options.filter(option => selected.has(option.value)).map(option => option.value);
        break;
      }
      case 'text':
      case 'textarea':
        if (typeof value !== 'string') invalid(control.label, 'enter text.');
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid(control.label, 'enter a finite number.');
        if (control.min !== null && value < control.min) invalid(control.label, `use a number of at least ${control.min}.`);
        if (control.max !== null && value > control.max) invalid(control.label, `use a number no larger than ${control.max}.`);
        break;
      case 'rating':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) invalid(control.label, 'choose a rating from 1 to 5.');
        break;
      case 'date':
        if (typeof value !== 'string' || !validDate(value)) invalid(control.label, 'enter a valid date (YYYY-MM-DD).');
        break;
      case 'time':
        if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid(control.label, 'enter a valid time (HH:mm).');
        break;
      case 'confirm':
        if (typeof value !== 'boolean') invalid(control.label, 'choose yes or no.');
        break;
    }
    normalized[control.key] = value;
  }
  if (Object.keys(normalized).length === 0) throw new Error('Choose or enter at least one answer, or reply in your own words.');
  return normalized;
}

/** Human-readable user context. A selection never becomes a tool name or approval command. */
export function formatResponse(rawSpec: Interaction, rawValues: unknown): string {
  const spec = Interaction.parse(rawSpec), values = validateResponse(spec, rawValues);
  const lines = spec.controls.flatMap(control => {
    const value = values[control.key];
    if (value === undefined) return [];
    const display = control.kind === 'single_choice' || control.kind === 'select' ? control.options.find(option => option.value === value)!.label
      : Array.isArray(value) ? value.map(item => control.options.find(option => option.value === item)!.label).join(', ')
      : control.kind === 'rating' ? `${value} / 5`
      : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
    return [`${control.label}: ${display}`];
  });
  return `Answers to “${spec.question}”\n${lines.join('\n')}`;
}

export const INTERACTIVE_REPLY_MARKER = 'Ontave interactive reply\n';
/** Read compatibility for the original standalone interactive-chat foundation. */
export const LEGACY_INTERACTIVE_REPLY_MARKER = 'Daltn interactive reply\n';
export const INTERACTIVE_REPLY_MAX_BYTES = 9000;
export const InteractiveReply = z.strictObject({
  version: z.literal(INTERACTION_VERSION),
  answer: z.string().trim().min(1).max(4000),
  interaction: Interaction,
});
export type InteractiveReply = z.infer<typeof InteractiveReply>;
const bytes = (value: string) => new TextEncoder().encode(value).length;

/** Representation only. Persistence, tenancy, expiry and approval remain the host's responsibility. */
export function encodeInteractiveReply(answer: string, interaction: Interaction): string {
  const value = INTERACTIVE_REPLY_MARKER + JSON.stringify(InteractiveReply.parse({version: INTERACTION_VERSION, answer, interaction}));
  if (bytes(value) > INTERACTIVE_REPLY_MAX_BYTES) throw new Error('This interactive response is too large to retain.');
  return value;
}

export function decodeInteractiveReply(value: string): InteractiveReply | null {
  const marker = replyMarker(value);
  if (!marker || bytes(value) > INTERACTIVE_REPLY_MAX_BYTES) return null;
  try { return InteractiveReply.parse(JSON.parse(value.slice(marker.length))); } catch { return null; }
}

function replyMarker(value: string): string | undefined {
  return [INTERACTIVE_REPLY_MARKER, LEGACY_INTERACTIVE_REPLY_MARKER].find(marker => value.startsWith(marker));
}

/** Compact fallback for history, exports and clients without an interactive renderer. */
export function interactiveText(value: string | null): string {
  if (value === null) return '';
  const decoded = decodeInteractiveReply(value);
  if (!decoded) return replyMarker(value) ? 'This interactive response could not be read. Send a new message.' : value;
  const choices = decoded.interaction.controls.map(control => `${control.label}${control.options.length ? ` (${control.options.map(option => option.label).join(' / ')})` : ''}`).join('\n');
  return [decoded.answer, decoded.interaction.question, choices].filter((text, index, all) => all.indexOf(text) === index).join('\n\n');
}

export const interactionCapabilities = Object.freeze({
  version: INTERACTION_VERSION,
  kinds: CONTROL_KINDS,
  maximumControls: 3,
  maximumOptions: 6,
  maximumTextLength: 1200,
  authorizesActions: false,
} as const);

/** A host installs trusted adapters; models can select only validated kind/version pairs. */
export function createControlRegistry<T>(entries: readonly {kind: ControlKind; version: 1; adapter: T}[]) {
  const registry = new Map<string, T>();
  for (const entry of entries) {
    const kind = ControlKind.parse(entry.kind);
    if (entry.version !== INTERACTION_VERSION) throw new Error('Unsupported interaction version.');
    const key = `${entry.version}:${kind}`;
    if (registry.has(key)) throw new Error(`Duplicate adapter for ${key}.`);
    registry.set(key, entry.adapter);
  }
  return Object.freeze({
    resolve(rawControl: unknown, version: number = INTERACTION_VERSION): T {
      const control = Control.parse(rawControl);
      const key = `${version}:${control.kind}`;
      if (version !== INTERACTION_VERSION || !registry.has(key)) throw new Error('This control is not supported by this client.');
      return registry.get(key)!;
    },
    supports(kind: string, version: number = INTERACTION_VERSION): boolean { return version === INTERACTION_VERSION && registry.has(`${version}:${kind}`); },
  });
}
