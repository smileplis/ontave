import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {
  Control, Interaction, InteractionValues, INTERACTIVE_REPLY_MARKER,
  createControlRegistry, decodeInteractiveReply, encodeInteractiveReply,
  formatResponse, interactiveText, validateResponse, type Control as ControlSpec,
} from '../src/index.js';

const choice: ControlSpec = {
  key: 'purpose', label: 'What should visitors do?', kind: 'single_choice', required: true,
  options: [{value: 'book', label: 'Book a consultation'}, {value: 'ask', label: 'Send an enquiry'}], min: null, max: null,
};
const spec = Interaction.parse({version: 1, question: 'What is the main goal?', description: null, controls: [choice], submitLabel: 'Continue'});
const control = (kind: ControlSpec['kind'], extra: Partial<ControlSpec> = {}): ControlSpec => ({...choice, key: kind, label: kind, kind, options: [], ...extra});
const withControls = (...controls: ControlSpec[]) => Interaction.parse({...spec, controls});

describe('bounded interaction contracts', () => {
  it('exports a provider-compatible strict JSON schema without arbitrary properties', () => {
    const schema = z.toJSONSchema(Interaction);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['version', 'question', 'description', 'controls', 'submitLabel']);
    expect(JSON.stringify(schema)).not.toContain('custom');
  });

  it('accepts the registered controls and no arbitrary action or remote UI', () => {
    expect(Interaction.parse(spec)).toEqual(spec);
    expect(Interaction.safeParse({...spec, execute: 'delete_all'}).success).toBe(false);
    expect(Control.safeParse({...choice, kind: 'iframe', url: 'https://example.test'}).success).toBe(false);
    expect(Control.safeParse({...choice, kind: 'javascript'}).success).toBe(false);
    expect(Interaction.safeParse({...spec, version: 2}).success).toBe(false);
  });

  it('rejects ambiguous keys, choices and control bounds before rendering', () => {
    expect(Interaction.safeParse({...spec, controls: [choice, choice]}).success).toBe(false);
    expect(Control.safeParse({...choice, options: [choice.options[0], choice.options[0]]}).success).toBe(false);
    expect(Control.safeParse({...choice, options: [{value: 'a', label: 'Same'}, {value: 'b', label: 'same'}]}).success).toBe(false);
    expect(Control.safeParse({...choice, options: [choice.options[0]]}).success).toBe(false);
    expect(Control.safeParse(control('text', {options: choice.options})).success).toBe(false);
    expect(Control.safeParse(control('text', {min: 1})).success).toBe(false);
    expect(Control.safeParse(control('number', {min: 9, max: 4})).success).toBe(false);
    expect(Control.safeParse(control('number', {max: Infinity})).success).toBe(false);
    expect(Interaction.safeParse({...spec, controls: Array.from({length: 4}, (_, i) => ({...choice, key: `purpose_${i}`}))}).success).toBe(false);
  });

  it('rejects prototype-shaped keys, oversized values and unknown fields', () => {
    expect(Control.safeParse({...choice, key: 'constructor'}).success).toBe(false);
    expect(InteractionValues.safeParse(JSON.parse('{"__proto__":"x"}')).success).toBe(false);
    expect(InteractionValues.safeParse({[Symbol('hidden')]: 'x'}).success).toBe(false);
    expect(InteractionValues.safeParse({a: 1, b: 2, c: 3, d: 4}).success).toBe(false);
    expect(InteractionValues.safeParse({purpose: 'x'.repeat(1201)}).success).toBe(false);
    expect(() => validateResponse(spec, {purpose: 'book', organization_id: 'another-business'})).toThrow('unknown control');
  });
});

describe('canonical response validation', () => {
  it('validates choices against the saved spec rather than accepting a browser label', () => {
    expect(validateResponse(spec, {purpose: 'book'})).toEqual({purpose: 'book'});
    expect(() => validateResponse(spec, {purpose: 'Book a consultation'})).toThrow('offered options');
    expect(() => validateResponse(spec, {purpose: 'publish'})).toThrow('offered options');
    expect(() => validateResponse(spec, {purpose: true})).toThrow('offered options');
    expect(() => validateResponse(spec, {})).toThrow('choose or enter');
  });

  it('canonicalizes multiple selections and rejects duplicated or fabricated values', () => {
    const multi = withControls({...choice, kind: 'multi_choice'});
    expect(validateResponse(multi, {purpose: ['ask', 'book']})).toEqual({purpose: ['book', 'ask']});
    expect(formatResponse(multi, {purpose: ['ask', 'book']})).toBe(formatResponse(multi, {purpose: ['book', 'ask']}));
    expect(() => validateResponse(multi, {purpose: ['book', 'book']})).toThrow('distinct');
    expect(() => validateResponse(multi, {purpose: ['book', 'delete']})).toThrow('distinct');
    expect(() => validateResponse(multi, {purpose: []})).toThrow('choose or enter');
  });

  it('normalizes text while preserving an explicit zero and negative answers', () => {
    const mixed = withControls(control('textarea'), control('number', {min: 0, max: 50}), control('confirm'));
    expect(validateResponse(mixed, {textarea: '  Cakes and consultations  ', number: 0, confirm: false})).toEqual({textarea: 'Cakes and consultations', number: 0, confirm: false});
    expect(() => validateResponse(mixed, {textarea: 'x', number: '0', confirm: false})).toThrow('finite number');
    expect(() => validateResponse(mixed, {textarea: 'x', number: 51, confirm: false})).toThrow('no larger');
    expect(() => validateResponse(mixed, {textarea: 'x', number: -1, confirm: false})).toThrow('at least');
    expect(() => validateResponse(mixed, {textarea: 'x', number: 1, confirm: 'yes'})).toThrow('yes or no');
  });

  it('allows optional unanswered controls but does not submit an empty response', () => {
    const optional = withControls(choice, control('text', {required: false}));
    expect(validateResponse(optional, {purpose: 'ask', text: '  '})).toEqual({purpose: 'ask'});
    expect(() => validateResponse(withControls(control('text', {required: false})), {text: ' '})).toThrow('at least one');
    expect(() => validateResponse(withControls(control('text')), {text: 9})).toThrow('enter text');
  });

  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-11', '0000-01-01', '2026-10-27T00:00:00Z'])('rejects invalid or ambiguous date %s', date => {
    expect(() => validateResponse(withControls(control('date')), {date})).toThrow('valid date');
  });

  it('accepts real leap days without relying on lenient Date rollover', () => {
    expect(validateResponse(withControls(control('date')), {date: '2024-02-29'})).toEqual({date: '2024-02-29'});
    expect(validateResponse(withControls(control('date')), {date: '2000-02-29'})).toEqual({date: '2000-02-29'});
  });

  it.each(['24:00', '12:60', '9:15', '09:15Z'])('rejects invalid or timezone-ambiguous time %s', time => {
    expect(() => validateResponse(withControls(control('time')), {time})).toThrow('valid time');
  });

  it('accepts explicit local clock time as context, without claiming a reservation', () => {
    expect(validateResponse(withControls(control('time')), {time: '09:15'})).toEqual({time: '09:15'});
    expect(formatResponse(withControls(control('time')), {time: '09:15'})).toContain('time: 09:15');
  });

  it('maps values to reviewed labels and never returns a bare approval command', () => {
    const approvalLike = withControls({...choice, options: [{value: 'yes', label: 'Approve'}, {value: 'no', label: 'Decline'}]});
    expect(formatResponse(approvalLike, {purpose: 'yes'})).toBe('Answers to “What is the main goal?”\nWhat should visitors do?: Approve');
    expect(formatResponse(approvalLike, {purpose: 'yes'})).not.toBe('Approve');
  });
});

describe('durable portable representation', () => {
  it('round-trips a typed reply and retains a compact text fallback for other clients', () => {
    const encoded = encodeInteractiveReply('Let’s choose a goal.', spec);
    expect(decodeInteractiveReply(encoded)).toEqual({version: 1, answer: 'Let’s choose a goal.', interaction: spec});
    expect(interactiveText(encoded)).toContain('Book a consultation / Send an enquiry');
    expect(interactiveText('An ordinary reply')).toBe('An ordinary reply');
    expect(interactiveText(null)).toBe('');
  });

  it('fails closed on malformed, future or oversized receipts without exposing raw JSON', () => {
    expect(decodeInteractiveReply(INTERACTIVE_REPLY_MARKER + '{bad')).toBeNull();
    expect(decodeInteractiveReply(INTERACTIVE_REPLY_MARKER + JSON.stringify({version: 2, answer: 'Future', interaction: spec}))).toBeNull();
    expect(interactiveText(INTERACTIVE_REPLY_MARKER + '{bad')).not.toContain('{bad');
    expect(() => encodeInteractiveReply('界'.repeat(3000), spec)).toThrow('too large');
    expect(decodeInteractiveReply(INTERACTIVE_REPLY_MARKER + 'x'.repeat(9001))).toBeNull();
  });

  it('provides an explicit trusted-adapter registry with no dynamic fallback', () => {
    const renderer = (value: unknown) => value;
    const registry = createControlRegistry([{kind: 'single_choice', version: 1, adapter: renderer}]);
    expect(registry.resolve(choice)).toBe(renderer);
    expect(registry.supports('single_choice')).toBe(true);
    expect(registry.supports('html')).toBe(false);
    expect(() => registry.resolve(control('text'))).toThrow('not supported');
    expect(() => registry.resolve(choice, 2)).toThrow('not supported');
    expect(() => createControlRegistry([{kind: 'single_choice', version: 1, adapter: renderer}, {kind: 'single_choice', version: 1, adapter: renderer}])).toThrow('Duplicate');
  });
});
