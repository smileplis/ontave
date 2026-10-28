'use client';

import {useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent} from 'react';
import {validateApplicationValues, type ApplicationClient, type ApplicationCommand, type ApplicationEntity, type ApplicationField, type ApplicationPage, type ApplicationRecord, type ApplicationScalar, type ApplicationValues} from './application.js';
import {isDefiniteApplicationFailure} from './application-http.js';

const message = (error: unknown) => error instanceof Error ? error.message : 'This request could not be completed.';
const initialDraft = (entity: ApplicationEntity): ApplicationValues => Object.fromEntries(entity.fields.filter(field => field.default !== null).map(field => [field.key, field.default]));
export function useApplicationCollection(client: ApplicationClient, entityKey: string, options: {active?: boolean} = {}) {
  const entity = client.definition.entities.find(item => item.key === entityKey);
  if (!entity) throw new Error('Unknown application entity.');
  const [rows, setRows] = useState<ApplicationRecord[]>([]), [references, setReferences] = useState<Record<string, ApplicationRecord[]>>({});
  const [draft, setDraft] = useState<ApplicationValues>(() => initialDraft(entity));
  const [editing, setEditing] = useState<ApplicationRecord | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState<ApplicationCommand | null>(null);
  const lock = useRef(false), generation = useRef(0), uncertainRequest = useRef<ApplicationCommand | null>(null);
  const reload = useCallback(async () => {
    if (lock.current || uncertainRequest.current) return;
    const version = ++generation.current;
    setBusy(true); setError('');
    try {
      const targets = [...new Set(entity.fields.flatMap(field => field.reference ? [field.reference] : []))];
      const [records, ...related] = await Promise.all([client.list(entityKey), ...targets.map(key => client.list(key))]);
      if (generation.current !== version) return;
      setRows(records); setReferences(Object.fromEntries(targets.map((key, index) => [key, related[index]])));
    } catch (cause) { if (generation.current === version) setError(message(cause)); }
    finally { if (generation.current === version) setBusy(false); }
  }, [client, entity, entityKey]);
  useEffect(() => { if (options.active !== false) void reload(); return () => { generation.current++; }; }, [reload, options.active]);
  const blocked = busy || !!uncertain;
  async function mutate(command: ApplicationCommand) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const receipt = await client.execute(command);
      setRows(current => receipt.record ? [...current.filter(row => row.id !== receipt.record!.id), receipt.record] : current.filter(row => command.kind === 'create' || row.id !== command.id));
      uncertainRequest.current = null; setUncertain(null); setEditing(null); setDraft(initialDraft(entity!));
    } catch (cause) {
      setError(message(cause));
      uncertainRequest.current = isDefiniteApplicationFailure(cause) ? null : command;
      setUncertain(uncertainRequest.current);
    } finally { lock.current = false; setBusy(false); }
  }
  return {
    entity, rows, references, draft, editing, error, busy, uncertain, blocked,
    setField(key: string, value: ApplicationScalar) { if (blocked || lock.current) return; setError(''); setDraft(current => ({...current, [key]: value})); },
    edit(row: ApplicationRecord) { if (blocked || lock.current) return; setEditing(row); setDraft({...row.values}); setError(''); },
    cancel() { if (blocked || lock.current) return; setEditing(null); setDraft(initialDraft(entity)); setError(''); },
    async reload() { if (!blocked && !lock.current) await reload(); },
    async save(event?: FormEvent) {
      event?.preventDefault(); if (blocked || lock.current) return;
      try {
        const candidate = {...draft};
        for (const field of entity.fields) if (field.kind === 'number' && typeof candidate[field.key] === 'string' && String(candidate[field.key]).trim() !== '') candidate[field.key] = Number(candidate[field.key]);
        const values = validateApplicationValues(entity, candidate), requestId = crypto.randomUUID();
        await mutate(editing ? {kind: 'update', entity: entityKey, id: editing.id, expectedRevision: editing.revision, values, requestId} : {kind: 'create', entity: entityKey, values, requestId});
      } catch (cause) { setError(message(cause)); }
    },
    async remove(row: ApplicationRecord) { if (!blocked && !lock.current) await mutate({kind: 'delete', entity: entityKey, id: row.id, expectedRevision: row.revision, requestId: crypto.randomUUID()}); },
    async retry() { if (uncertain && !busy) await mutate(uncertain); },
  };
}

export function ApplicationFeedback({error, uncertain, retry}: {error: string; uncertain: boolean; retry: () => void}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) ref.current?.focus(); }, [error]);
  if (!error) return null;
  return <div className="oapp-error" role="alert" tabIndex={-1} ref={ref}><p>{error}</p>{uncertain && <><p>The request may already be saved. Retry it before changing your answer.</p><button type="button" onClick={retry}>Retry identical request</button></>}</div>;
}
export function ApplicationFieldInput({field, value, onChange, disabled, records = []}: {field: ApplicationField; value: ApplicationScalar | undefined; onChange: (value: ApplicationScalar) => void; disabled?: boolean; records?: ApplicationRecord[]}) {
  const common = {disabled, required: field.required, 'aria-label': field.label};
  if (field.kind === 'boolean') return <select {...common} value={typeof value === 'boolean' ? String(value) : ''} onChange={event => onChange(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Choose an answer</option><option value="true">Yes</option><option value="false">No</option></select>;
  if (field.kind === 'select' || field.kind === 'reference') return <select {...common} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)}><option value="">Choose an option</option>{field.kind === 'select' ? field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>) : records.map(row => <option key={row.id} value={row.id}>{Object.values(row.values).find(value => typeof value === 'string') ?? row.id}</option>)}</select>;
  if (field.kind === 'textarea') return <textarea {...common} rows={3} maxLength={4000} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)}/>;
  return <input {...common} type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'} step={field.kind === 'number' ? 'any' : undefined} min={field.min ?? undefined} max={field.max ?? undefined} maxLength={field.kind === 'text' ? 4000 : undefined} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value)}/>;
}
export function displayApplicationValue(field: ApplicationField, value: ApplicationScalar | undefined, references: ApplicationRecord[] = []): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field.kind === 'select') return field.options.find(option => option.value === value)?.label ?? String(value);
  if (field.kind === 'reference') { const record = references.find(row => row.id === value); return String(record ? Object.values(record.values).find(value => typeof value === 'string') ?? record.id : value); }
  return typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
}
export type ApplicationPageProps = {client: ApplicationClient; page: ApplicationPage; active?: boolean};
export function ApplicationCollectionPage({client, page, active = true}: ApplicationPageProps) {
  const collection = useApplicationCollection(client, page.entity!, {active}), {entity} = collection;
  const columns = page.fields.length ? page.fields.map(key => entity.fields.find(field => field.key === key)!) : entity.fields;
  return <section className="oapp-page" aria-label={page.title} aria-busy={collection.busy}>
    <header className="oapp-page-heading"><div><p className="oapp-kicker">{client.definition.name}</p><h1>{page.title}</h1></div><button type="button" disabled={collection.blocked} onClick={() => void collection.reload()}>Reload records</button></header>
    <ApplicationFeedback error={collection.error} uncertain={!!collection.uncertain} retry={() => void collection.retry()}/>
    <div className="oapp-workspace"><div className="oapp-records"><div className="oapp-table-scroll"><table><caption>{entity.label}</caption><thead><tr>{columns.map(field => <th key={field.key} scope="col">{field.label}</th>)}<th scope="col">Actions</th></tr></thead><tbody>{collection.rows.map(row => <tr key={row.id}>{columns.map(field => <td key={field.key}>{displayApplicationValue(field, row.values[field.key], collection.references[field.reference ?? ''])}</td>)}<td><div className="oapp-row-actions"><button type="button" disabled={collection.blocked} onClick={() => collection.edit(row)}>Edit</button><button type="button" disabled={collection.blocked} onClick={() => void collection.remove(row)}>Delete</button></div></td></tr>)}</tbody></table></div>{!collection.rows.length && !collection.busy && <p className="oapp-empty">No records yet. Add the first one.</p>}</div>
      <form className="oapp-form" noValidate onSubmit={event => void collection.save(event)} aria-label={collection.editing ? `Edit ${entity.label}` : `Add ${entity.label}`}><h2>{collection.editing ? 'Edit record' : 'Add a record'}</h2>{entity.fields.map(field => <label key={field.key}><span>{field.label}{!field.required && <small>Optional</small>}</span><ApplicationFieldInput field={field} value={collection.draft[field.key]} onChange={value => collection.setField(field.key, value)} disabled={collection.blocked} records={collection.references[field.reference ?? '']}/></label>)}<div className="oapp-form-actions"><button type="submit" disabled={collection.blocked}>{collection.busy ? 'Saving…' : collection.editing ? 'Save changes' : 'Add record'}</button>{collection.editing && <button type="button" disabled={collection.blocked} onClick={collection.cancel}>Cancel edit</button>}</div></form>
    </div>
  </section>;
}
export function ApplicationDashboardPage({client, page, active = true}: ApplicationPageProps) {
  const [counts, setCounts] = useState<Record<string, number>>({}), [error, setError] = useState('');
  useEffect(() => { if (!active) return; let current = true; setError(''); setCounts({}); Promise.all(client.definition.entities.map(async entity => [entity.key, (await client.list(entity.key)).length] as const)).then(items => { if (current) setCounts(Object.fromEntries(items)); }).catch(error => { if (current) setError(message(error)); }); return () => { current = false; }; }, [client, active]);
  return <section className="oapp-page" aria-label={page.title}><header className="oapp-page-heading"><div><p className="oapp-kicker">{client.definition.name}</p><h1>{page.title}</h1><p>{client.definition.description}</p></div></header><ApplicationFeedback error={error} uncertain={false} retry={() => {}}/><div className="oapp-metrics">{client.definition.entities.map(entity => <article key={entity.key}><span>{entity.label}</span><strong>{counts[entity.key] ?? '…'}</strong><p>Accessible records</p></article>)}</div></section>;
}
export const standardApplicationViews: Readonly<Record<string, ComponentType<ApplicationPageProps>>> = Object.freeze({'collection@1': ApplicationCollectionPage, 'dashboard@1': ApplicationDashboardPage});
/** Only host-installed React components are rendered. Model-provided HTML/code is never evaluated. */
const clientKeys = new WeakMap<ApplicationClient, number>();
let nextClientKey = 0;
export function ApplicationView(props: {client: ApplicationClient; views?: Readonly<Record<string, ComponentType<ApplicationPageProps>>>}) {
  if (!clientKeys.has(props.client)) clientKeys.set(props.client, ++nextClientKey);
  return <ApplicationShell key={clientKeys.get(props.client)} {...props}/>;
}
function ApplicationShell({client, views = standardApplicationViews}: {client: ApplicationClient; views?: Readonly<Record<string, ComponentType<ApplicationPageProps>>>}) {
  const [pageKey, setPageKey] = useState(client.definition.pages[0].key);
  const page = client.definition.pages.find(item => item.key === pageKey) ?? client.definition.pages[0];
  return <div className="oapp"><aside className="oapp-nav"><strong className="oapp-brand">{client.definition.name}</strong><nav aria-label="Application pages">{client.definition.pages.map(item => <button key={item.key} type="button" aria-current={item.key === page.key ? 'page' : undefined} onClick={() => setPageKey(item.key)}>{item.title}</button>)}</nav><p>Built with Ontave</p></aside><main className="oapp-main">{client.definition.pages.map(item => {
    const View = views[`${item.kind}@${item.version}`];
    return <div key={item.key} hidden={item.key !== page.key}>{View ? <View client={client} page={item} active={item.key === page.key}/> : <div role="alert">Install a trusted renderer for {item.kind}@{item.version}.</div>}</div>;
  })}</main></div>;
}
