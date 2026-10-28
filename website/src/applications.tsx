import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ApplicationDefinition, createApplicationRuntime, createMemoryApplicationStore, createRuntimeApplicationClient} from 'ontave/application';
import {ApplicationView} from 'ontave/application/react';
import {applicationExportArchive, applicationExportManifest, exportApplication} from 'ontave/application/export';
import {exampleApplication} from '../../examples/application/definition.js';
import 'ontave/application/styles.css';
import './applications.css';

const clientFor = (definition: ApplicationDefinition) => createRuntimeApplicationClient(createApplicationRuntime({definition, store: createMemoryApplicationStore(), authorize: () => true}), {actorId:'fictional-demo',workspaceId:'browser-preview'});
function ApplicationBuilder() {
  const [definition, setDefinition] = useState(exampleApplication), [source, setSource] = useState(() => JSON.stringify(exampleApplication(),null,2));
  const [client, setClient] = useState(() => clientFor(definition));
  const [error, setError] = useState(''), [exporting, setExporting] = useState(false);
  function run() {
    try {
      const parsed = ApplicationDefinition.parse(JSON.parse(source));
      for (const page of parsed.pages) if (!['collection','dashboard'].includes(page.kind)) throw new Error(`Install a renderer for ${page.kind} before previewing it.`);
      const next = clientFor(parsed); setClient(next); setDefinition(parsed); setSource(JSON.stringify(parsed,null,2));setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid application definition.'); }
  }
  async function download() {
    if (exporting) return; setExporting(true);setError('');
    try {
      const response = await fetch('/downloads/manifest.json'); if (!response.ok) throw new Error('The framework download is not ready. Build the production website to prepare it.');
      const manifest = await response.json() as {filename?: string; sha256?: string};
      if (!manifest.filename || !/^ontave-[a-zA-Z0-9.-]+\.tgz$/.test(manifest.filename)) throw new Error('Invalid framework download metadata.');
      const packageResponse = await fetch(`/downloads/${manifest.filename}`);if(!packageResponse.ok)throw new Error('The framework package could not be downloaded.');
      const bytes = new Uint8Array(await packageResponse.arrayBuffer());if(bytes.length>5*1024*1024)throw new Error('Unexpected framework package size.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      if(digest!==manifest.sha256)throw new Error('The framework package did not match its checksum.');
      const bundle = exportApplication(definition,{frameworkDependency:'file:./vendor/ontave.tgz'});
      const archive = applicationExportArchive(bundle,[await applicationExportManifest(bundle),{path:'vendor/ontave.tgz',bytes}]);
      const url=URL.createObjectURL(new Blob([new Uint8Array(archive).buffer],{type:'application/zip'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`${definition.id}-source.zip`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch (error) {setError(error instanceof Error?error.message:'The application could not be exported.');}
    finally{setExporting(false);}
  }
  const changed=source!==JSON.stringify(definition,null,2);
  return <div className="builder"><header className="builder-nav"><a href="/" className="builder-wordmark">ontave ↗</a><span>Application foundation · preview</span><a href="https://github.com/smileplis/ontave/blob/main/docs/APPLICATIONS.md">Integration guide ↗</a></header>
    <section className="builder-intro"><p className="builder-eyebrow">From intent to application</p><h1>One definition.<br/><em>Two ways to build.</em></h1><p>Run an application from a validated definition, or export editable source code. The same entities, pages, and workflows connect both paths.</p></section>
    <section className="builder-tools" aria-label="Application definition and export"><div><strong>Fieldwork CRM</strong><p>A fictional leads and follow-ups application. This preview makes no model requests and keeps records in memory.</p></div><button type="button" disabled={exporting||changed} onClick={()=>void download()}>{exporting?'Preparing source…':'Export editable application ↓'}</button></section>
    <details className="builder-definition"><summary>Edit the application definition</summary><p>Change labels, fields, columns, or registered workflows. Running a definition starts a fresh preview with empty records. The exported app has its own persistent local backend.</p><label htmlFor="application-definition">Versioned application definition</label><textarea id="application-definition" spellCheck={false} value={source} onChange={event=>setSource(event.target.value)}/><div><button type="button" onClick={run}>Run this definition</button>{changed&&<span>Run the new definition before exporting.</span>}</div></details>
    {error&&<div className="builder-error" role="alert">{error}</div>}
    <ApplicationView client={client}/>
    <footer className="builder-footer"><p>The exported ZIP includes editable React pages, a local Node API, persistent file storage, and the exact framework package. Unzip, run <code>npm install</code>, then <code>npm run dev</code>.</p><p>The server binds to your own machine. Public deployment requires host authentication, authorization, and a database adapter. No external workflow action runs automatically.</p><a href="/playground/">Explore the interaction module ↗</a></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<ApplicationBuilder/>);
