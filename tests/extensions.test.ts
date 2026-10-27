import {describe, expect, it} from 'vitest';
import {Control, CONTROL_KINDS, INTERACTIVE_REPLY_MARKER, LEGACY_INTERACTIVE_REPLY_MARKER, createControlRegistry, decodeInteractiveReply, encodeInteractiveReply, formatResponse, interactionCapabilities, interactiveText, validateResponse} from '../src/index.js';
import {control, interaction} from './fixtures.js';

describe('bounded select and rating controls', () => {
  it('validates select values using the saved options and formats their labels', () => {
    const spec = interaction(control('select'));
    expect(validateResponse(spec, {select: 'b'})).toEqual({select: 'b'});
    expect(formatResponse(spec, {select: 'b'})).toContain('select: Second option');
    expect(() => validateResponse(spec, {select: 'Second option'})).toThrow('offered options');
    expect(Control.safeParse(control('select', {options: []})).success).toBe(false);
  });
  it.each([0, 6, 2.5, '3', true, [1]])('rejects invalid rating %j', value => {
    expect(() => validateResponse(interaction(control('rating')), {rating: value})).toThrow();
  });
  it('accepts the rating endpoints and keeps ratings distinct from numeric bounds', () => {
    const spec = interaction(control('rating'));
    expect(validateResponse(spec, {rating: 1})).toEqual({rating: 1});
    expect(formatResponse(spec, {rating: 5})).toContain('rating: 5 / 5');
    expect(Control.safeParse(control('rating', {min: 1, max: 10})).success).toBe(false);
    expect(Control.safeParse(control('rating', {options: control('select').options})).success).toBe(false);
  });
  it('keeps optional ratings optional while requiring at least one answer', () => {
    const spec = interaction(control('rating', {required: false}), control('confirm'));
    expect(validateResponse(spec, {confirm: false})).toEqual({confirm: false});
    expect(() => validateResponse(interaction(control('rating')), {})).toThrow('choose or enter');
  });
  it('advertises immutable capabilities and lets native clients register the new kinds', () => {
    expect(interactionCapabilities.kinds).toContain('select');
    expect(interactionCapabilities.kinds).toContain('rating');
    expect(Object.isFrozen(CONTROL_KINDS)).toBe(true);
    const registry = createControlRegistry([{kind: 'rating', version: 1, adapter: 'native-rating'}]);
    expect(registry.resolve(control('rating'))).toBe('native-rating');
    expect(registry.supports('select')).toBe(false);
  });
});

describe('Ontave reply compatibility', () => {
  it('writes Ontave receipts and reads original Daltn interactive receipts', () => {
    const encoded = encodeInteractiveReply('Choose a response.', interaction());
    expect(encoded.startsWith(INTERACTIVE_REPLY_MARKER)).toBe(true);
    const legacy = encoded.replace(INTERACTIVE_REPLY_MARKER, LEGACY_INTERACTIVE_REPLY_MARKER);
    expect(decodeInteractiveReply(legacy)).toEqual(decodeInteractiveReply(encoded));
    expect(interactiveText(legacy)).toContain('First option');
  });
  it('does not expose corrupt legacy JSON through text fallback', () => {
    expect(interactiveText(LEGACY_INTERACTIVE_REPLY_MARKER + '{private:bad}')).toBe('This interactive response could not be read. Send a new message.');
  });
});
