import {Interaction, type Control} from '../src/index.js';

export function control(kind: Control['kind'], extra: Partial<Control> = {}): Control {
  const selection = ['single_choice', 'multi_choice', 'select'].includes(kind);
  return {key: kind, label: kind, kind, required: true, options: selection ? [{value: 'a', label: 'First option'}, {value: 'b', label: 'Second option'}] : [], min: null, max: null, ...extra};
}
export function interaction(...controls: Control[]) {
  return Interaction.parse({version: 1, question: 'What would help?', description: 'A little context helps.', controls: controls.length ? controls : [control('single_choice')], submitLabel: 'Continue'});
}
