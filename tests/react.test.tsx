// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {userEvent} from '@testing-library/user-event';
import {InteractionForm} from '../src/react.js';
import {type Interaction, type InteractionValues} from '../src/index.js';
import {control, interaction} from './fixtures.js';

afterEach(cleanup);

const cases = [
  {kind: 'single_choice', expected: 'b'}, {kind: 'multi_choice', expected: ['a', 'b']},
  {kind: 'select', expected: 'b'}, {kind: 'rating', expected: 4},
  {kind: 'text', expected: 'A useful answer'}, {kind: 'textarea', expected: 'A useful answer'},
  {kind: 'number', expected: 0}, {kind: 'date', expected: '2028-02-29'},
  {kind: 'time', expected: '09:15'}, {kind: 'confirm', expected: false},
] as const;

describe('accessible typed controls', () => {
  it.each(cases)('submits $kind as validated context only after Continue', async ({kind, expected}) => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    render(<InteractionForm interaction={interaction(control(kind))} onSubmit={onSubmit}/>);
    if (kind === 'single_choice') await user.click(screen.getByRole('radio', {name: 'Second option'}));
    else if (kind === 'multi_choice') {
      await user.click(screen.getByRole('checkbox', {name: 'Second option'}));
      await user.click(screen.getByRole('checkbox', {name: 'First option'}));
    } else if (kind === 'select') await user.selectOptions(screen.getByRole('combobox'), 'b');
    else if (kind === 'rating') await user.click(screen.getByRole('radio', {name: '4 of 5'}));
    else if (kind === 'confirm') await user.click(screen.getByRole('radio', {name: 'No'}));
    else if (kind === 'date' || kind === 'time') fireEvent.change(screen.getByLabelText(kind), {target: {value: expected}});
    else await user.type(screen.getByLabelText(kind), String(expected));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', {name: /Continue/}));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({[kind]: expected});
  });

  it('supports keyboard-only radio selection and submit', async () => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    render(<InteractionForm interaction={interaction()} onSubmit={onSubmit}/>);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', {name: 'First option'}));
    await user.keyboard('[Space]');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', {name: /Continue/}));
    await user.keyboard('[Enter]');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({single_choice: 'a'});
  });

  it('announces and focuses validation errors without calling the host', async () => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    render(<InteractionForm interaction={interaction(control('number', {min: 1, max: 5}))} onSubmit={onSubmit}/>);
    await user.type(screen.getByLabelText('number'), '9');
    await user.click(screen.getByRole('button', {name: /Continue/}));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('no larger than 5');
    expect(document.activeElement).toBe(alert);
    expect(screen.getByRole('form').getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('number'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['single_choice', 'confirm', 'rating'] as const)('allows an optional $kind answer to be cleared', async kind => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    render(<InteractionForm interaction={interaction(control('text'), control(kind, {required: false}))} onSubmit={onSubmit}/>);
    await user.type(screen.getByLabelText('text'), ' Keep this ');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', {name: `Clear ${kind}`}));
    expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true);
    await user.click(screen.getByRole('button', {name: /Continue/}));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({text: 'Keep this'});
  });

  it('allows an optional dropdown to return to its unanswered option', async () => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    render(<InteractionForm interaction={interaction(control('text'), control('select', {required: false}))} onSubmit={onSubmit}/>);
    await user.type(screen.getByLabelText('text'), 'Keep this');
    await user.selectOptions(screen.getByRole('combobox'), 'b');
    await user.selectOptions(screen.getByRole('combobox'), '');
    await user.click(screen.getByRole('button', {name: /Continue/}));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({text: 'Keep this'});
  });
});

describe('submission and recovery', () => {
  it('blocks concurrent submissions until the host settles', async () => {
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const onSubmit = vi.fn(() => pending), user = userEvent.setup();
    render(<InteractionForm interaction={interaction()} onSubmit={onSubmit}/>);
    await user.click(screen.getByRole('radio', {name: 'First option'}));
    fireEvent.submit(screen.getByRole('form'));
    fireEvent.submit(screen.getByRole('form'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('form').getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', {name: /Sending/}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('radio').every(input => (input as HTMLInputElement).disabled)).toBe(true);
    await act(async () => complete());
    expect(screen.getByRole('form').getAttribute('aria-busy')).toBe('false');
  });

  it('retains the draft after rejection and retries the same values', async () => {
    const user = userEvent.setup(), onSubmit = vi.fn().mockRejectedValueOnce(new Error('Connection lost. Retry.')).mockResolvedValue(undefined);
    render(<InteractionForm interaction={interaction()} onSubmit={onSubmit}/>);
    await user.click(screen.getByRole('radio', {name: 'Second option'}));
    await user.click(screen.getByRole('button', {name: /Continue/}));
    expect(screen.getByRole('alert').textContent).toBe('Connection lost. Retry.');
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect((screen.getByRole('radio', {name: 'Second option'}) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', {name: /Continue/}));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0]).toEqual(onSubmit.mock.calls[1]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['pending', 'disabled'] as const)('honors host %s state and external error feedback', async state => {
    const onSubmit = vi.fn();
    const spec = interaction(control('select'), control('rating'), control('text'));
    const view = render(<InteractionForm interaction={spec} onSubmit={onSubmit} {...{[state]: true}} error="Check the saved turn."/>);
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('text') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByRole('radio').every(input => (input as HTMLInputElement).disabled)).toBe(true);
    fireEvent.submit(screen.getByRole('form'));
    expect(onSubmit).not.toHaveBeenCalled();
    view.rerender(<InteractionForm interaction={spec} onSubmit={onSubmit}/>);
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
  });

  it('preserves drafts across ordinary parent updates and resets for a different canonical turn', async () => {
    const user = userEvent.setup(), onSubmit = vi.fn();
    const view = render(<InteractionForm interactionId="turn-a" interaction={interaction()} onSubmit={onSubmit}/>);
    await user.click(screen.getByRole('radio', {name: 'Second option'}));
    view.rerender(<InteractionForm interactionId="turn-a" interaction={interaction()} onSubmit={onSubmit}/>);
    expect((screen.getByRole('radio', {name: 'Second option'}) as HTMLInputElement).checked).toBe(true);
    view.rerender(<InteractionForm interactionId="turn-b" interaction={interaction()} onSubmit={onSubmit}/>);
    expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true);
  });

  it('restores new saved values and resets when the spec changes', () => {
    const onSubmit = vi.fn();
    const view = render(<InteractionForm interaction={interaction()} initialValues={{single_choice: 'b'}} onSubmit={onSubmit}/>);
    expect((screen.getByRole('radio', {name: 'Second option'}) as HTMLInputElement).checked).toBe(true);
    view.rerender(<InteractionForm interaction={interaction()} initialValues={{single_choice: 'a'}} onSubmit={onSubmit}/>);
    expect((screen.getByRole('radio', {name: 'First option'}) as HTMLInputElement).checked).toBe(true);
    view.rerender(<InteractionForm interaction={interaction(control('text'))} onSubmit={onSubmit}/>);
    expect((screen.getByLabelText('text') as HTMLInputElement).value).toBe('');
  });
});

describe('readback and untrusted data', () => {
  it('renders saved labels, explicit no and zero without editable controls', () => {
    const onSubmit = vi.fn(), values: InteractionValues = {select: 'b', confirm: false, number: 0};
    render(<InteractionForm interaction={interaction(control('select'), control('confirm'), control('number'))} initialValues={values} readOnly onSubmit={onSubmit}/>);
    expect(screen.getByText('Second option')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('explains unanswered superseded questions', () => {
    render(<InteractionForm interaction={interaction()} readOnly onSubmit={vi.fn()}/>);
    expect(screen.getByText('Continue in the latest message to answer this question.')).toBeTruthy();
  });
  it.each([{version: 2}, {controls: [{kind: 'javascript'}]}, {controls: []}])('falls back safely for unsupported or corrupt questions %j', override => {
    const onSubmit = vi.fn();
    render(<InteractionForm interaction={{...interaction(), ...override} as Interaction} onSubmit={onSubmit}/>);
    expect(screen.getByRole('status').textContent).toContain('Reply in chat');
    expect(screen.queryByRole('form')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('renders model labels and host errors as text', () => {
    const label = '<img src=x onerror=alert(1)>';
    const {container} = render(<InteractionForm interaction={interaction(control('text', {label}))} error="<script>alert(1)</script>" onSubmit={vi.fn()}/>);
    expect(screen.getByLabelText(label)).toBeTruthy();
    expect(container.querySelector('img,script')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('<script>');
  });
});
