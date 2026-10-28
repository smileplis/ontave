import {ApplicationDefinition, createApplicationModuleRegistry, type ApplicationModuleRegistry, type ApplicationPage, type ApplicationEntity} from './application.js';

export type ApplicationExportFile = {path: string; content: string; ownership: 'generated' | 'user'};
export type ApplicationExport = {definition: ApplicationDefinition; files: ApplicationExportFile[]};
export type ApplicationPageExporter = (context: {definition: ApplicationDefinition; page: ApplicationPage; entity: ApplicationEntity | null}) => string;
const literal = (value: unknown) => JSON.stringify(value);
const html = (value: string) => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));

const collectionSource: ApplicationPageExporter = ({page, entity}) => {
  if (!entity) throw new Error('Collection export requires an entity.');
  const fields = page.fields.length ? page.fields.map(key => entity.fields.find(field => field.key === key)!) : entity.fields;
  return `import type {ApplicationPageProps} from 'ontave/application/react';
import {useApplicationCollection, ApplicationFieldInput, ApplicationFeedback, displayApplicationValue} from 'ontave/application/react';

// Editable page source. Regeneration refuses to overwrite local changes.
export default function Page({client, active = true}: ApplicationPageProps) {
  const collection = useApplicationCollection(client, ${literal(entity.key)}, {active});
  const fields = Object.fromEntries(collection.entity.fields.map(field => [field.key, field]));
  return <section className="oapp-page" aria-label={${literal(page.title)}} aria-busy={collection.busy}>
    <header className="oapp-page-heading"><div><p className="oapp-kicker">{client.definition.name}</p><h1>{${literal(page.title)}}</h1></div><button disabled={collection.blocked} onClick={() => void collection.reload()}>Reload records</button></header>
    <ApplicationFeedback error={collection.error} uncertain={!!collection.uncertain} retry={() => void collection.retry()}/>
    <div className="oapp-workspace"><div className="oapp-records"><div className="oapp-table-scroll"><table><caption>{${literal(entity.label)}}</caption><thead><tr>
${fields.map(field => `      <th scope="col">{${literal(field.label)}}</th>`).join('\n')}
      <th scope="col">Actions</th></tr></thead><tbody>{collection.rows.map(row => <tr key={row.id}>
${fields.map(field => `      <td>{displayApplicationValue(fields[${literal(field.key)}], row.values[${literal(field.key)}], collection.references[${literal(field.reference ?? '')}])}</td>`).join('\n')}
      <td><div className="oapp-row-actions"><button disabled={collection.blocked} onClick={() => collection.edit(row)}>Edit</button><button disabled={collection.blocked} onClick={() => void collection.remove(row)}>Delete</button></div></td>
    </tr>)}</tbody></table></div>{!collection.rows.length && !collection.busy && <p className="oapp-empty">No records yet. Add the first one.</p>}</div>
    <form className="oapp-form" noValidate onSubmit={event => void collection.save(event)} aria-label={collection.editing ? 'Edit record' : 'Add record'}><h2>{collection.editing ? 'Edit record' : 'Add a record'}</h2>
${entity.fields.map(field => `      <label><span>{${literal(field.label)}}${!field.required ? '<small>Optional</small>' : ''}</span><ApplicationFieldInput field={fields[${literal(field.key)}]} value={collection.draft[${literal(field.key)}]} onChange={value => collection.setField(${literal(field.key)}, value)} disabled={collection.blocked} records={collection.references[${literal(field.reference ?? '')}]}/></label>`).join('\n')}
      <div className="oapp-form-actions"><button type="submit" disabled={collection.blocked}>{collection.busy ? 'Saving…' : collection.editing ? 'Save changes' : 'Add record'}</button>{collection.editing && <button type="button" disabled={collection.blocked} onClick={collection.cancel}>Cancel edit</button>}</div>
    </form></div>
  </section>;
}
`;
};
const dashboardSource: ApplicationPageExporter = () => `import {ApplicationDashboardPage, type ApplicationPageProps} from 'ontave/application/react';

// Replace this component or override this page in src/extensions.tsx.
export default function Page(props: ApplicationPageProps) {
  return <ApplicationDashboardPage {...props}/>;
}
`;
export const standardApplicationPageExporters: Readonly<Record<string, ApplicationPageExporter>> = Object.freeze({'collection@1': collectionSource, 'dashboard@1': dashboardSource});

/** Host selects dependencies and trusted generator/module source; these fields never come from a model definition. */
export function exportApplication(input: ApplicationDefinition, options: {
  frameworkDependency: string;
  modules?: ApplicationModuleRegistry;
  moduleSources?: Readonly<Record<string, string>>;
  pageExporters?: Readonly<Record<string, ApplicationPageExporter>>;
  dependencies?: Readonly<Record<string, string>>;
}): ApplicationExport {
  if (!options.frameworkDependency?.trim() || options.frameworkDependency.length > 2000) throw new Error('Choose the exact Ontave package source to install.');
  const definition = ApplicationDefinition.parse(input), modules = options.modules ?? createApplicationModuleRegistry();
  const exporters = options.pageExporters ?? standardApplicationPageExporters;
  for (const workflow of definition.workflows) for (const step of workflow.steps) modules.validate(step);
  const files: ApplicationExportFile[] = [];
  const add = (path: string, content: string, ownership: ApplicationExportFile['ownership'] = 'generated') => files.push({path, content, ownership});
  const custom = [...new Set(definition.workflows.flatMap(workflow => workflow.steps.map(step => `${step.use}@${step.version}`)))].filter(name => !['record.set@1', 'event.emit@1'].includes(name));
  for (const [index, name] of custom.entries()) {
    const source = options.moduleSources?.[name];
    if (!source) throw new Error(`Provide trusted export source for module ${name}.`);
    add(`modules/module_${index}.mjs`, source);
  }
  for (const [index, page] of definition.pages.entries()) {
    const exporter = exporters[`${page.kind}@${page.version}`];
    if (!exporter) throw new Error(`Install a source exporter for view ${page.kind}@${page.version}.`);
    add(`src/pages/page_${index}.tsx`, exporter({definition, page, entity: definition.entities.find(entity => entity.key === page.entity) ?? null}));
  }
  add('application.json', JSON.stringify(definition, null, 2) + '\n');
  add('package.json', JSON.stringify({name: `${definition.id.replaceAll('_', '-')}-application`, version: '0.1.0', private: true, type: 'module', engines: {node: '>=24 <27'}, scripts: {dev: 'node dev.mjs', build: 'tsc --noEmit && vite build', start: 'node server.mjs'}, dependencies: {...options.dependencies, ontave: options.frameworkDependency, react: '19.3.1', 'react-dom': '19.3.1'}, devDependencies: {'@types/react': '19.3.0', '@types/react-dom': '19.3.0', typescript: '5.9.3', vite: '8.3.5'}}, null, 2) + '\n');
  add('tsconfig.json', JSON.stringify({compilerOptions: {target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, resolveJsonModule: true, esModuleInterop: true}, include: ['src']}, null, 2) + '\n');
  add('index.html', `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${html(definition.name)}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`);
  add('src/main.tsx', `import {createRoot} from 'react-dom/client';\nimport App from './App';\nimport 'ontave/application/styles.css';\nimport './style.css';\ncreateRoot(document.getElementById('root')!).render(<App/>);\n`);
  add('src/App.tsx', `import {useState} from 'react';
import {ApplicationDefinition} from 'ontave/application';
import {createHttpApplicationClient} from 'ontave/application/http';
import definitionData from '../application.json';
import {pages as extensions} from './extensions';
${definition.pages.map((_page, index) => `import Page${index} from './pages/page_${index}';`).join('\n')}
const definition = ApplicationDefinition.parse(definitionData);
const client = createHttpApplicationClient(definition);
export default function App() {
  const [selected, setSelected] = useState(${literal(definition.pages[0].key)});
  return <div className="oapp"><aside className="oapp-nav"><strong className="oapp-brand">{definition.name}</strong><nav aria-label="Application pages">
${definition.pages.map(page => `    <button aria-current={selected === ${literal(page.key)} ? 'page' : undefined} onClick={() => setSelected(${literal(page.key)})}>{${literal(page.title)}}</button>`).join('\n')}
    </nav><p>Built with Ontave</p></aside><main className="oapp-main">
${definition.pages.map((page, index) => `    {(() => { const Page = extensions[${literal(page.key)}] ?? Page${index}; return <div hidden={selected !== ${literal(page.key)}}><Page client={client} page={definition.pages[${index}]} active={selected === ${literal(page.key)}}/></div>; })()}`).join('\n')}
  </main></div>;
}
`);
  add('src/extensions.tsx', `import type {ComponentType} from 'react';\nimport type {ApplicationPageProps} from 'ontave/application/react';\n\n// This user-owned file is preserved during regeneration.\n// Map a page key to your own component to replace its generated UI.\nexport const pages: Record<string, ComponentType<ApplicationPageProps>> = {};\n`, 'user');
  add('src/style.css', 'body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#f7f9f4}.oapp{min-height:100vh;border:0;border-radius:0}button,input,select,textarea{font:inherit}\n', 'user');
  add('vite.config.mjs', `import {defineConfig} from 'vite';\nexport default defineConfig({server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api/ontave':{target:'http://127.0.0.1:8787',changeOrigin:true}}}});\n`);
  add('server.mjs', `${custom.map((_name, index) => `import module${index} from './modules/module_${index}.mjs';`).join('\n')}
${serverSource.replace('__CUSTOM_MODULES__', custom.map((_name, index) => `module${index}`).join(','))}`);
  add('dev.mjs', devSource);
  add('.gitignore', 'node_modules/\ndist/\n.data/\n*.tgz\n');
  add('README.md', `# ${definition.name}\n\nGenerated by Ontave from application.json. This is a complete local reference application: editable React pages, a Node.js API, and persistent local records.\n\n## Run\n\nUse Node.js 24 or 26. Run npm install, then npm run dev. The UI opens at http://127.0.0.1:5173 and the API at http://127.0.0.1:8787. For a single server, run npm run build followed by npm start, then open http://127.0.0.1:8787. PORT can select another production port.\n\nThe framework dependency is selected by the host exporter. For a locally packed Ontave tarball, place the selected tarball at the configured file path before npm install. The published ontave@0.1 package is an unrelated earlier API.\n\n## Ownership and modules\n\nEdit src/pages/*.tsx to customize the actual forms and tables. src/extensions.tsx can replace a generated page; it and src/style.css are user-owned and preserved during regeneration. The Node export writer refuses to overwrite modified generated files. Review/merge those changes before regenerating. Code edits are not automatically reverse-imported into application.json.\n\nWorkflow modules run on the server. event.emit queues durable effects; your host must approve/dispatch external work using stable effect IDs, then acknowledge delivery. No email, CRM integration or remote mutation is executed automatically.\n\n## Deployment boundary\n\nThis starter is bound to 127.0.0.1 and uses an explicit local-developer context. It has no public-user login. Before exposing it beyond your machine, install your server authentication, workspace resolution and authorization policy, plus a transactional database adapter. The file adapter is for a single local process, retains request receipts, and has a 32 MiB limit. It does not provide cross-process locking, retention cleanup, schema migration, or production backups.\n\nApplication definitions are pinned. Changing a definition on existing data requires an explicit migration; the runtime refuses to silently reinterpret stored data.\n`);
  return {definition, files};
}

const serverSource = String.raw`import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname, sep} from 'node:path';
import {ApplicationDefinition, createApplicationRuntime, createApplicationModuleRegistry, standardApplicationModules} from 'ontave/application';
import {createFileApplicationStore} from 'ontave/application/node';
import {createApplicationHandler} from 'ontave/application/http';
const definition = ApplicationDefinition.parse(JSON.parse(await readFile(new URL('./application.json', import.meta.url), 'utf8')));
const runtime = createApplicationRuntime({definition, store: createFileApplicationStore(process.env.ONTAVE_DATA_DIR || fileURLToPath(new URL('./.data', import.meta.url))), authorize: () => true, modules: createApplicationModuleRegistry([...standardApplicationModules,__CUSTOM_MODULES__])});
// Local reference policy. Replace with authenticated host context and authorization before public deployment.
const api = createApplicationHandler(runtime, {resolveContext: () => ({actorId:'local-developer', workspaceId:'local'}), trustedOrigins: process.env.ONTAVE_API_ONLY === '1' ? ['http://127.0.0.1:5173'] : []});
const root = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
let origin = '';
const server = createServer(async (request, response) => {
  const send = (status, text) => { response.writeHead(status, {'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'}); response.end(text); };
  try {
    if (request.headers.host !== new URL(origin).host) return send(403, 'Unexpected host. Open the printed 127.0.0.1 URL.');
    const url = new URL(request.url || '/', origin);
    if (url.pathname === '/api/ontave' || url.pathname.startsWith('/api/ontave/')) {
      const chunks=[]; let length=0;
      for await (const chunk of request) { length += chunk.length; if (length > 512000) return send(413,'Request too large.'); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const headers = new Headers(); for (const [key,value] of Object.entries(request.headers)) if(value !== undefined) headers.set(key,Array.isArray(value)?value.join(','):value);
      const input = new Request(url, {method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:body});
      const result = await api(input); response.writeHead(result.status,Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
    }
    if (process.env.ONTAVE_API_ONLY === '1') return send(404,'API only.');
    if (!['GET','HEAD'].includes(request.method)) return send(405,'Method not allowed.');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root+sep)) return send(404,'Not found.');
    if (!extname(path)) path = resolve(root,'index.html');
    let bytes; try { bytes=await readFile(path); } catch { return send(404,'Not found.'); }
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
    response.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"}); response.end(request.method==='HEAD'?undefined:bytes);
  } catch { send(500,'The request could not be completed.'); }
});
server.listen(Number(process.env.PORT || 8787),'127.0.0.1',()=> { origin='http://127.0.0.1:'+server.address().port; console.log('Ontave application: '+origin); });
`;
const devSource = String.raw`import {spawn} from 'node:child_process';
const children=[];
const launch=(file,env=process.env)=>{const child=spawn(process.execPath,[file],{stdio:'inherit',env});children.push(child);return child;};
launch('server.mjs',{...process.env,PORT:'8787',ONTAVE_API_ONLY:'1'});
launch('node_modules/vite/bin/vite.js');
let closing=false;
function close(code=0){if(closing)return;closing=true;for(const child of children)child.kill('SIGTERM');process.exitCode=code;}
for(const child of children){child.on('error',()=>close(1));child.on('exit',code=>close(code || 0));}
process.on('SIGINT',()=>close());process.on('SIGTERM',()=>close());
`;

/** Include this asset in a ZIP so the Node writer can safely regenerate an extracted application. */
export async function applicationExportManifest(bundle: ApplicationExport): Promise<{path: string; bytes: Uint8Array}> {
  const encoder = new TextEncoder(), files: Record<string, {sha256: string; ownership: ApplicationExportFile['ownership']}> = Object.create(null);
  for (const file of bundle.files) {
    if (Object.hasOwn(files, file.path)) throw new Error('Duplicate exported source path.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(file.content)));
    files[file.path] = {sha256: [...digest].map(byte => byte.toString(16).padStart(2,'0')).join(''), ownership: file.ownership};
  }
  return {path: '.ontave/export.json', bytes: encoder.encode(JSON.stringify({version:1, applicationId:bundle.definition.id, files}, null, 2) + '\n')};
}

/** Deterministic uncompressed ZIP. No browser-global, Node API or archive dependency is required. */
export function applicationExportArchive(bundle: ApplicationExport, assets: readonly {path: string; bytes: Uint8Array}[] = []): Uint8Array {
  if (bundle.files.length + assets.length > 512) throw new Error('Too many export files.');
  const encoder = new TextEncoder(), locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, total = 0;
  const crc = (bytes: Uint8Array) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const entries = [...bundle.files.map(file => ({path: file.path, bytes: encoder.encode(file.content)})), ...assets];
  if (new Set(entries.map(file => file.path)).size !== entries.length) throw new Error('Duplicate archive path.');
  for (const file of entries) {
    if (!/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(file.path) || file.path.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid export path.');
    const name = encoder.encode(file.path), bytes = file.bytes, checksum = crc(bytes);
    total += bytes.length; if (total > 10 * 1024 * 1024) throw new Error('The export exceeds its 10 MiB archive limit.');
    const local = new Uint8Array(30 + name.length + bytes.length), view = new DataView(local.buffer);
    view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(12,0x21,true);view.setUint32(14,checksum,true);view.setUint32(18,bytes.length,true);view.setUint32(22,bytes.length,true);view.setUint16(26,name.length,true);local.set(name,30);local.set(bytes,30+name.length);
    const entry = new Uint8Array(46+name.length), header = new DataView(entry.buffer);
    header.setUint32(0,0x02014b50,true);header.setUint16(4,20,true);header.setUint16(6,20,true);header.setUint16(8,0x800,true);header.setUint16(14,0x21,true);header.setUint32(16,checksum,true);header.setUint32(20,bytes.length,true);header.setUint32(24,bytes.length,true);header.setUint16(28,name.length,true);header.setUint32(42,offset,true);entry.set(name,46);central.push(entry);locals.push(local);offset+=local.length;
  }
  const size = central.reduce((sum, item)=>sum+item.length,0), end = new Uint8Array(22), header = new DataView(end.buffer);
  header.setUint32(0,0x06054b50,true);header.setUint16(8,entries.length,true);header.setUint16(10,entries.length,true);header.setUint32(12,size,true);header.setUint32(16,offset,true);
  const output = new Uint8Array(offset+size+end.length);let position=0;for(const part of [...locals,...central,end]){output.set(part,position);position+=part.length;}return output;
}
