import {useState} from 'react';
import {Interaction, formatResponse, validateResponse, type Control, type InteractionValues} from 'ontave';
import {InteractionForm} from 'ontave/react';
import 'ontave/styles.css';
import './style.css';

const choices = [{value: 'examples', label: 'See examples'}, {value: 'details', label: 'Explore the details'}, {value: 'try', label: 'Try it myself'}];
const field = (key: string, label: string, kind: Control['kind'], required = true): Control => ({
  key, label, kind, required,
  options: ['single_choice', 'multi_choice', 'select'].includes(kind) ? choices : [],
  min: kind === 'number' ? 0 : null, max: kind === 'number' ? 100 : null,
});
const examples = [
  {id: 'choices', title: 'Make a choice', question: 'How would you like to explore?', controls: [field('direction', 'Start with', 'single_choice'), field('interests', 'Also interested in', 'multi_choice', false), field('next', 'Then explore', 'select', false)]},
  {id: 'words', title: 'Add some context', question: 'What are you curious about?', controls: [field('topic', 'A topic', 'text'), field('context', 'A little more context', 'textarea', false), field('minutes', 'Minutes available (0–100)', 'number', false)]},
  {id: 'time', title: 'Choose a time', question: 'When would you prefer to continue?', controls: [field('date', 'Preferred date', 'date'), field('time', 'Local time', 'time'), field('reminder', 'Would a reminder be useful?', 'confirm')]},
  {id: 'rating', title: 'Share feedback', question: 'How useful was that explanation?', controls: [field('rating', 'Usefulness', 'rating'), field('note', 'Anything to add?', 'textarea', false)]},
].map(example => ({...example, spec: Interaction.parse({version: 1, question: example.question, description: 'Choose what helps. You can always continue in your own words.', controls: example.controls, submitLabel: 'Continue'})}));
const storageKey = 'ontave.demo.v1';

function loadSaved(): Record<string, InteractionValues> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
    const saved: Record<string, InteractionValues> = {};
    for (const example of examples) {
      try { if (raw?.[example.id]) saved[example.id] = validateResponse(example.spec, raw[example.id]); }
      catch { /* Discard corrupt demo answers; the fixture is the canonical spec. */ }
    }
    return saved;
  } catch { return {}; }
}

export function App() {
  const [exampleId, setExampleId] = useState(examples[0].id), [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(loadSaved), [failNext, setFailNext] = useState(false), [pending, setPending] = useState(false);
  const example = examples.find(item => item.id === exampleId)!;
  const values = saved[example.id];
  const persist = (next: Record<string, InteractionValues>) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage may be unavailable in private contexts. */ }
    setSaved(next);
  };
  async function submit(draft: InteractionValues) {
    setPending(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 350));
      if (failNext) { setFailNext(false); throw new Error('The demo rejected this send. Your answers are still here; try again.'); }
      const normalized = validateResponse(example.spec, draft);
      persist({...saved, [example.id]: normalized});
    } finally { setPending(false); }
  }
  return <main>
    <header className="masthead"><a href="/" className="wordmark">ontave<span>↗</span></a><span className="eyebrow">Framework preview</span></header>
    <section className="intro"><p className="eyebrow">A conversation can ask more.</p><h1>Less back and forth.<br/><em>A better next question.</em></h1><p>Let your agent ask through a familiar control. Keep the answer in the conversation.</p></section>
    <div className="workbench">
      <aside><h2>Explore the controls</h2><label htmlFor="example">Example</label><select id="example" value={exampleId} disabled={pending} onChange={event => setExampleId(event.target.value)}>{examples.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select><p>Ten bounded controls. Your agent picks the question; your application owns what happens next.</p><label className="simulation"><input type="checkbox" checked={failNext} disabled={pending || !!values} onChange={event => setFailNext(event.target.checked)}/>Reject the next send</label><button className="reset" disabled={pending} onClick={() => { const next = {...saved}; delete next[example.id]; persist(next); setRevision(value => value + 1); }}>Start this example again</button></aside>
      <section className="conversation" aria-label="Demo conversation"><p className="speaker">Assistant <span>Just one useful question.</span></p><InteractionForm interactionId={`${example.id}:${revision}`} interaction={example.spec} initialValues={values} readOnly={!!values} pending={pending} onSubmit={submit}/>{values && <div className="saved" role="status"><p className="speaker">You <span>Saved in this tab</span></p><p>{formatResponse(example.spec, values)}</p><p className="next">Thanks. Your application can now continue the same conversation with this context.</p></div>}</section>
    </div>
    <footer className="page-footer"><span>Local demo · fictional fixtures · no model requests</span><a href="/">← Back to Ontave</a><a href="https://github.com/smileplis/ontave">Read the source ↗</a></footer>
  </main>;
}
