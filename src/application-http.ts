import {z} from 'zod';
import {ApplicationDefinition, ApplicationError, ApplicationReceipt, ApplicationRecord, type ApplicationClient, type ApplicationCommand, type ApplicationContext, type ApplicationRuntime} from './application.js';

export class ApplicationRequestError extends Error {
  constructor(message: string, public readonly definite: boolean, public readonly code?: string, public readonly status?: number) { super(message); this.name = 'ApplicationRequestError'; }
}
export function isDefiniteApplicationFailure(error: unknown): boolean {
  return error instanceof ApplicationRequestError ? error.definite : error instanceof ApplicationError ? error.code !== 'STORAGE' : error instanceof z.ZodError;
}
export function createHttpApplicationClient(definition: ApplicationDefinition, options: {baseUrl?: string; fetch?: typeof fetch} = {}): ApplicationClient {
  const spec = ApplicationDefinition.parse(definition), base = (options.baseUrl ?? '/api/ontave').replace(/\/$/, ''), transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function send(path: string, body?: unknown) {
    let response: Response;
    try { response = await transport(base + path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? undefined : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)}); }
    catch { throw new ApplicationRequestError('The result is uncertain. Retry the same request before editing.', false); }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ApplicationRequestError('The server returned an unreadable response. Retry the same request.', false); }
    if (!response.ok) {
      const parsed = z.object({error: z.object({message: z.string(), code: z.string()})}).safeParse(payload);
      throw new ApplicationRequestError(parsed.success ? parsed.data.error.message : 'The request could not be completed.', response.status >= 400 && response.status < 500, parsed.success ? parsed.data.error.code : undefined, response.status);
    }
    return payload;
  }
  return Object.freeze({definition: spec,
    async list(entity: string) { return z.array(ApplicationRecord).parse(await send(`/records/${encodeURIComponent(entity)}`)); },
    async execute(command: ApplicationCommand) {
      const payload = await send('/commands', command);
      const receipt = ApplicationReceipt.safeParse(payload);
      if (!receipt.success || receipt.data.requestId !== command.requestId) throw new ApplicationRequestError('The server acknowledgement could not be matched. Retry the same request.', false);
      return receipt.data;
    },
  });
}
const MAX_BODY_BYTES = 512000;
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApplicationRequestError('Send application/json.', true, 'VALIDATION', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationRequestError('Missing request body.', true, 'VALIDATION', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.length;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ApplicationRequestError('Request body is too large.', true, 'VALIDATION', 413); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch (error) {
    if (error instanceof ApplicationRequestError) throw error;
    throw new ApplicationRequestError('Send one complete JSON object.', true, 'VALIDATION', 400);
  }
}
/** The host resolves authenticated context; identity and workspace claims in the body are never consulted. */
export function createApplicationHandler(runtime: ApplicationRuntime, options: {
  resolveContext: (request: Request) => ApplicationContext | null | Promise<ApplicationContext | null>;
  basePath?: string; trustedOrigins?: readonly string[]; allowNonBrowserRequests?: boolean;
}) {
  const base = (options.basePath ?? '/api/ontave').replace(/\/$/, '');
  const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url), context = await options.resolveContext(request);
      if (!context) return json({error: {code: 'FORBIDDEN', message: 'Authentication required.'}}, 401);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (!(origin === url.origin || origin && options.trustedOrigins?.includes(origin) || !origin && options.allowNonBrowserRequests)) return json({error: {code: 'FORBIDDEN', message: 'Request origin is not permitted.'}}, 403);
      }
      if (request.method === 'GET' && url.pathname === `${base}/definition`) return json(runtime.definition);
      if (request.method === 'GET' && url.pathname.startsWith(`${base}/records/`)) {
        const entity = decodeURIComponent(url.pathname.slice(`${base}/records/`.length));
        return json(await runtime.list({...context}, entity));
      }
      if (request.method === 'POST' && url.pathname === `${base}/commands`) {
        const receipt = await runtime.execute({...context}, await body(request));
        // Outbox payloads belong to host dispatch, not the browser response.
        return json({...receipt, effects: receipt.effects.map(effect => ({...effect, payload: {}}))});
      }
      return json({error: {code: 'NOT_FOUND', message: 'Unknown application API route or method.'}}, 404);
    } catch (error) {
      if (error instanceof ApplicationRequestError) return json({error: {code: error.code ?? 'VALIDATION', message: error.message}}, error.status ?? 400);
      if (error instanceof z.ZodError) return json({error: {code: 'VALIDATION', message: error.issues[0]?.message ?? 'Invalid application data.'}}, 422);
      if (error instanceof ApplicationError) return json({error: {code: error.code, message: error.message}}, ({VALIDATION: 422, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, MODULE: 422, STORAGE: 503} as const)[error.code]);
      return json({error: {code: 'STORAGE', message: 'The request outcome is uncertain. Retry the identical request.'}}, 500);
    }
  };
}
