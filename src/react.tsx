'use client';

import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {Interaction as InteractionSchema, validateResponse, type Interaction, type InteractionValues, type Control} from './index.js';

export type InteractionFormProps = {
  interaction: Interaction;
  /** Stable canonical turn ID. Different turns can contain the same question. */
  interactionId?: string;
  onSubmit: (values: InteractionValues) => void | Promise<void>;
  disabled?: boolean;
  pending?: boolean;
  error?: string;
  initialValues?: InteractionValues;
  readOnly?: boolean;
};

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    const first = error.issues[0] as {message?: unknown} | undefined;
    if (typeof first?.message === 'string') return first.message;
  }
  return error instanceof Error ? error.message : 'Check your answers and try again.';
}

function readable(control: Control, value: InteractionValues[string] | undefined): string {
  if (value === undefined || value === '') return 'Not provided';
  if (control.kind === 'single_choice' || control.kind === 'select') return control.options.find(option => option.value === value)?.label ?? 'Not provided';
  if (control.kind === 'multi_choice' && Array.isArray(value)) return control.options.filter(option => value.includes(option.value)).map(option => option.label).join(', ') || 'Not provided';
  if (control.kind === 'rating') return `${value} / 5`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** A provider-neutral renderer. Selecting context never executes a tool or approves an action. */
export function InteractionForm(props: InteractionFormProps) {
  const parsed = InteractionSchema.safeParse(props.interaction);
  if (!parsed.success) return <section className="dic-interaction" role="status">
    <p className="dic-help">This question cannot be displayed. Reply in chat to continue.</p>
  </section>;
  const interaction = parsed.data;
  // A new canonical turn resets even if its question is identical to the previous turn.
  const key = JSON.stringify([props.interactionId ?? null, interaction, props.initialValues ?? null, !!props.readOnly]);
  return <InteractionFields key={key} {...props} interaction={interaction}/>;
}

function InteractionFields({interaction, onSubmit, disabled = false, pending = false, error = '', initialValues = {}, readOnly = false}: InteractionFormProps) {
  const id = useId(), lock = useRef(false), errorRef = useRef<HTMLParagraphElement>(null);
  const [values, setValues] = useState<InteractionValues>(initialValues);
  const [validation, setValidation] = useState(''), [submitting, setSubmitting] = useState(false);
  const busy = pending || submitting, blocked = disabled || busy || readOnly;
  const message = validation || error;
  useEffect(() => { if (message && !readOnly) errorRef.current?.focus(); }, [message, readOnly]);

  const update = (key: string, value: InteractionValues[string] | undefined) => {
    if (blocked) return;
    setValidation('');
    setValues(current => {
      const next = {...current};
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || lock.current) return;
    try {
      const candidate = {...values};
      for (const control of interaction.controls) {
        if (control.kind === 'number' && typeof candidate[control.key] === 'string' && candidate[control.key] !== '') candidate[control.key] = Number(candidate[control.key]);
      }
      const validated = validateResponse(interaction, candidate);
      lock.current = true;
      setValidation(''); setSubmitting(true);
      await onSubmit(validated);
    } catch (cause) {
      setValidation(errorText(cause));
    } finally {
      lock.current = false; setSubmitting(false);
    }
  }
  const heading = <header className="dic-heading">
    <h3 id={`${id}-question`}>{interaction.question}</h3>
    {interaction.description && <p id={`${id}-description`}>{interaction.description}</p>}
  </header>;
  if (readOnly) return <section className="dic-interaction dic-readonly" aria-labelledby={`${id}-question`}>
    {heading}
    {Object.keys(initialValues).length ? <dl className="dic-summary">{interaction.controls.map(control => <div key={control.key}><dt>{control.label}</dt><dd>{readable(control, initialValues[control.key])}</dd></div>)}</dl> : <p className="dic-help">Continue in the latest message to answer this question.</p>}
  </section>;

  const describedBy = [interaction.description ? `${id}-description` : '', message ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return <form className="dic-interaction" aria-label="Interactive reply" aria-describedby={describedBy} aria-busy={busy} onSubmit={submit} noValidate>
    {heading}
    <div className="dic-controls">{interaction.controls.map(control => {
      const controlId = `${id}-${control.key}`, value = values[control.key];
      const optional = !control.required && <span className="dic-optional">Optional</span>;
      const clear = !control.required && <button type="button" className="dic-clear" aria-label={`Clear ${control.label}`} disabled={blocked || value === undefined} onClick={() => update(control.key, undefined)}>Clear</button>;
      if (control.kind === 'single_choice' || control.kind === 'multi_choice') return <fieldset key={control.key} className="dic-fieldset" disabled={blocked} aria-describedby={control.kind === 'multi_choice' ? `${controlId}-help` : undefined}>
        <legend>{control.label}{optional}</legend>
        <div className="dic-choices">{control.options.map(option => {
          const multiple = control.kind === 'multi_choice', selected = multiple ? Array.isArray(value) && value.includes(option.value) : value === option.value;
          return <label key={option.value} className="dic-choice" data-selected={selected}>
            <input type={multiple ? 'checkbox' : 'radio'} name={controlId} value={option.value} checked={selected} disabled={blocked} required={!multiple && control.required} onChange={event => {
              if (multiple) update(control.key, event.target.checked ? [...(Array.isArray(value) ? value : []), option.value] : (Array.isArray(value) ? value : []).filter(item => item !== option.value));
              else update(control.key, option.value);
            }}/>
            <span className="dic-choice-mark" aria-hidden="true">{selected ? '✓' : ''}</span><span>{option.label}</span>
          </label>;
        })}</div>
        {control.kind === 'multi_choice' ? <p className="dic-help" id={`${controlId}-help`}>{control.required ? 'Choose at least one option.' : 'Choose all that apply.'}</p> : clear}
      </fieldset>;
      if (control.kind === 'confirm' || control.kind === 'rating') {
        const answers = control.kind === 'confirm' ? [true, false] : [1, 2, 3, 4, 5];
        return <fieldset key={control.key} className="dic-fieldset" disabled={blocked}>
          <legend>{control.label}{optional}</legend>
          <div className="dic-choices">{answers.map(answer => {
            const label = typeof answer === 'boolean' ? answer ? 'Yes' : 'No' : `${answer} of 5`;
            return <label key={String(answer)} className="dic-choice" data-selected={value === answer}>
              <input type="radio" name={controlId} value={String(answer)} checked={value === answer} disabled={blocked} required={control.required} onChange={() => update(control.key, answer)}/>
              <span className="dic-choice-mark" aria-hidden="true">{value === answer ? '✓' : ''}</span><span>{label}</span>
            </label>;
          })}</div>
          {clear}
        </fieldset>;
      }
      return <div className="dic-field" key={control.key}>
        <label htmlFor={controlId}>{control.label}{optional}</label>
        {control.kind === 'select' ? <select id={controlId} value={typeof value === 'string' ? value : ''} disabled={blocked} required={control.required} onChange={event => update(control.key, event.target.value)}>
          <option value="">Choose an option</option>
          {control.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : control.kind === 'textarea' ? <textarea id={controlId} value={typeof value === 'string' ? value : ''} rows={3} maxLength={1200} disabled={blocked} required={control.required} onChange={event => update(control.key, event.target.value)}/> : <input id={controlId} type={control.kind === 'text' ? 'text' : control.kind} value={typeof value === 'number' || typeof value === 'string' ? value : ''} step={control.kind === 'number' ? 'any' : undefined} min={control.min ?? undefined} max={control.max ?? undefined} maxLength={control.kind === 'text' ? 1200 : undefined} disabled={blocked} required={control.required} onChange={event => update(control.key, event.target.value)}/>}
      </div>;
    })}</div>
    {message && <p className="dic-error" id={`${id}-error`} role="alert" tabIndex={-1} ref={errorRef}>{message}</p>}
    <footer className="dic-footer"><button type="submit" disabled={blocked}>{busy && <span className="dic-spinner" aria-hidden="true"/>}{busy ? 'Sending…' : interaction.submitLabel}<span aria-hidden="true">{busy ? '' : '→'}</span></button><span className="dic-help">You can also reply in chat.</span></footer>
  </form>;
}
