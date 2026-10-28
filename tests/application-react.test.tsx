// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import {userEvent} from '@testing-library/user-event';
import {ApplicationView} from '../src/application-react.js';
import {ApplicationRequestError} from '../src/application-http.js';
import {createApplicationRuntime, createMemoryApplicationStore, createRuntimeApplicationClient, type ApplicationClient} from '../src/application.js';
import {exampleApplication} from '../examples/application/definition.js';
afterEach(cleanup);
function setup(workspaceId='example') {
  const runtime=createApplicationRuntime({definition:exampleApplication(),store:createMemoryApplicationStore(),authorize:()=>true});
  return {runtime,client:createRuntimeApplicationClient(runtime,{actorId:'demo',workspaceId})};
}
async function leads(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole('button',{name:'Leads'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Add record'}) as HTMLButtonElement).disabled).toBe(false)); }

describe('application renderer',()=>{
  it('creates records with zero and false, then builds a related follow-up',async()=>{
    const user=userEvent.setup(),{client}=setup();render(<ApplicationView client={client}/>);await leads(user);
    await user.type(screen.getByLabelText('Name'),'Aster Studio');await user.type(screen.getByLabelText('Potential value'),'0');await user.selectOptions(screen.getByLabelText('Active'),'false');
    await user.click(screen.getByRole('button',{name:'Add record'}));
    await screen.findByRole('cell',{name:'Aster Studio'});
    expect((await client.list('leads'))[0].values).toMatchObject({name:'Aster Studio',value:0,active:false});
    await user.click(screen.getByRole('button',{name:'Follow-ups'}));
    await waitFor(()=>expect(screen.getByRole('option',{name:'Aster Studio'})).toBeTruthy());
    await user.type(screen.getByLabelText('Task'),'Send a follow-up');
    const lead=(await client.list('leads'))[0];await user.selectOptions(screen.getByLabelText('Lead'),lead.id);await user.click(screen.getByRole('button',{name:'Add record'}));
    await screen.findByRole('cell',{name:'Send a follow-up'});expect((await client.list('tasks'))[0].values).toMatchObject({lead:lead.id,done:false});
    await user.click(screen.getByRole('button',{name:'Overview'}));
    await waitFor(()=>expect(within(screen.getByRole('region',{name:'Overview'})).getAllByText('1')).toHaveLength(2));
  });
  it('supports edit and delete and focuses rejected validation',async()=>{
    const user=userEvent.setup(),{client}=setup();render(<ApplicationView client={client}/>);await leads(user);
    await user.click(screen.getByRole('button',{name:'Add record'}));const alert=await screen.findByRole('alert');expect(alert.textContent).toContain('Name: enter a value');expect(document.activeElement).toBe(alert);
    await user.type(screen.getByLabelText('Name'),'Ada');await user.click(screen.getByRole('button',{name:'Add record'}));await screen.findByRole('cell',{name:'Ada'});
    await user.click(screen.getByRole('button',{name:'Edit'}));await user.clear(screen.getByLabelText('Name'));await user.type(screen.getByLabelText('Name'),'Grace');await user.click(screen.getByRole('button',{name:'Save changes'}));await screen.findByRole('cell',{name:'Grace'});
    await user.click(screen.getByRole('button',{name:'Delete'}));await within(screen.getByRole('region',{name:'Leads'})).findByText('No records yet. Add the first one.');expect(await client.list('leads')).toEqual([]);
  });
  it('preserves an uncertain request across navigation and retries its exact identity and body',async()=>{
    const user=userEvent.setup(),{client:live}=setup();let lose=true;
    const execute=vi.fn(async(command:Parameters<ApplicationClient['execute']>[0])=>{const receipt=await live.execute(command);if(lose){lose=false;throw new ApplicationRequestError('Acknowledgement lost.',false);}return receipt;});
    const client={...live,execute};render(<ApplicationView client={client}/>);await leads(user);
    await user.type(screen.getByLabelText('Name'),'Ada');await user.click(screen.getByRole('button',{name:'Add record'}));await screen.findByRole('button',{name:'Retry identical request'});
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole('button',{name:'Overview'}));await user.click(screen.getByRole('button',{name:'Leads'}));
    await user.click(screen.getByRole('button',{name:'Retry identical request'}));await screen.findByRole('cell',{name:'Ada'});
    expect(execute).toHaveBeenCalledTimes(2);expect(execute.mock.calls[0]).toEqual(execute.mock.calls[1]);expect(await live.list('leads')).toHaveLength(1);
  });
  it('does not carry a previous client draft into another workspace',async()=>{
    const user=userEvent.setup(),first=setup('first'),second=setup('second');const view=render(<ApplicationView client={first.client}/>);await leads(user);await user.type(screen.getByLabelText('Name'),'Private draft');
    view.rerender(<ApplicationView client={second.client}/>);await leads(user);expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');expect(await second.client.list('leads')).toEqual([]);
  });
  it('clears a previous dashboard read error after reactivation succeeds',async()=>{
    const user=userEvent.setup(),{client:live}=setup();let offline=true;
    const client={...live,list:async(entity:string)=>{if(offline)throw new Error('Temporarily offline');return live.list(entity);}};
    render(<ApplicationView client={client}/>);await screen.findByRole('alert');offline=false;
    await leads(user);await user.click(screen.getByRole('button',{name:'Overview'}));
    await waitFor(()=>expect(within(screen.getByRole('region',{name:'Overview'})).getAllByText('0')).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('uses only installed view components and renders unknown kinds as safe text',()=>{
    const {client}=setup(),definition={...client.definition,pages:[{...client.definition.pages[0],kind:'remote_javascript'}]};render(<ApplicationView client={{...client,definition}}/>);
    expect(screen.getByRole('alert').textContent).toContain('Install a trusted renderer');expect(screen.queryByRole('form')).toBeNull();
  });
});
