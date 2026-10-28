import {describe, expect, it} from 'vitest';
import {createApplicationRuntime, createMemoryApplicationStore} from '../src/application.js';
import {ApplicationRequestError, createApplicationHandler, createHttpApplicationClient} from '../src/application-http.js';
import {exampleApplication} from '../examples/application/definition.js';
const context = {actorId: 'server-resolved', workspaceId: 'trusted-workspace'};
function setup() { const runtime = createApplicationRuntime({definition: exampleApplication(), store: createMemoryApplicationStore(), authorize: () => true}); return {runtime, handler: createApplicationHandler(runtime, {resolveContext: () => context})}; }
const command = {kind: 'create', entity: 'leads', requestId: 'http-first', values: {name: 'Ada'}} as const;
function request(body: unknown, origin = 'https://host.example') { return new Request('https://host.example/api/ontave/commands', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify(body)}); }

describe('host HTTP integration', () => {
  it('uses server context and protects browser writes from cross-origin callers', async () => {
    const {handler, runtime} = setup();
    expect((await handler(request(command, 'https://attacker.example'))).status).toBe(403);
    expect((await handler(request({...command, workspaceId: 'forged'}))).status).toBe(422);
    const response = await handler(request(command)); expect(response.status).toBe(200);
    const receipt = await response.json(); expect(receipt.effects[0].payload).toEqual({});
    expect(await runtime.list(context, 'leads')).toHaveLength(1);
    expect(await runtime.list({...context, workspaceId: 'forged'}, 'leads')).toEqual([]);
  });
  it('denies missing authentication and oversized/malformed bodies', async () => {
    const {runtime, handler} = setup();
    expect((await createApplicationHandler(runtime, {resolveContext: () => null})(request(command))).status).toBe(401);
    expect((await handler(new Request('https://host.example/api/ontave/commands', {method:'POST',headers:{Origin:'https://host.example','Content-Type':'application/json'},body:'{broken'}))).status).toBe(400);
    expect((await handler(request({...command, padding:'x'.repeat(512001)}))).status).toBe(413);
    expect(await runtime.list(context, 'leads')).toEqual([]);
  });
  it('makes exact retries through the HTTP client and rejects unmatched acknowledgements as uncertain', async () => {
    const {handler, runtime} = setup();
    const transport: typeof fetch = async (input, options) => handler(new Request(String(input), {...options, headers: {...options?.headers, Origin:'https://host.example'}}));
    const client = createHttpApplicationClient(exampleApplication(), {baseUrl:'https://host.example/api/ontave',fetch:transport});
    const a = await client.execute(command), b = await client.execute(command); expect(a).toEqual(b); expect(await client.list('leads')).toHaveLength(1);
    const wrong = createHttpApplicationClient(exampleApplication(), {fetch:async () => Response.json({...a, requestId:'someone-else'})});
    await expect(wrong.execute(command)).rejects.toMatchObject({definite:false});
    const network = createHttpApplicationClient(exampleApplication(), {fetch:async () => {throw new Error('lost');}});
    await expect(network.execute(command)).rejects.toBeInstanceOf(ApplicationRequestError);
    expect(await runtime.list(context,'leads')).toHaveLength(1);
  });
});
