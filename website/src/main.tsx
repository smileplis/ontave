import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Interaction, type InteractionValues} from 'ontave';
import {InteractionForm} from 'ontave/react';
import 'ontave/styles.css';
import './style.css';

const question = Interaction.parse({
  version: 1, question: 'What would help you get started?', description: null,
  controls: [{key: 'starting_point', label: 'I’d like to…', kind: 'single_choice', required: true,
    options: [{value: 'example', label: 'See an example'}, {value: 'approach', label: 'Understand the approach'}, {value: 'controls', label: 'Try the controls'}], min: null, max: null}],
  submitLabel: 'Continue',
});
const replies: Record<string, {text: string; href: string; label: string}> = {
  example: {text: 'Start with a small question. The playground shows how each kind of answer stays in the conversation.', href: '/playground/', label: 'Open the playground'},
  approach: {text: 'Your agent asks through a typed specification. Your application saves the question, validates the response, and continues the same conversation.', href: '#how-it-works', label: 'See how it works'},
  controls: {text: 'Explore choices, text, numbers, dates, times, and ratings. All ten controls are ready to try in the playground.', href: '/playground/', label: 'Try all ten controls'},
};
function LandingQuestion() {
  const [answer, setAnswer] = useState<InteractionValues>();
  const reply = answer ? replies[String(answer.starting_point)] : null;
  return <>
    <InteractionForm interactionId="landing-question" interaction={question} initialValues={answer} readOnly={!!answer} onSubmit={values => setAnswer(values)}/>
    {reply && <div className="demo-response" role="status"><span className="eyebrow">Your next step</span><p>{reply.text}</p><a className="text-link" href={reply.href}>{reply.label} <span aria-hidden="true">↗</span></a><button className="restart-demo" type="button" onClick={() => setAnswer(undefined)}>Try another answer</button></div>}
  </>;
}
const demo = document.getElementById('landing-demo');
if (demo) createRoot(demo).render(<LandingQuestion/>);

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-code-tab]'));
function selectTab(tab: HTMLButtonElement) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls') ?? '');
    if (panel) panel.hidden = !selected;
  }
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); selectTab(tabs[next]); tabs[next].focus();
  });
}
