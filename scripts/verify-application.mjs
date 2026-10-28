import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApplicationDefinition} from '../dist/application.js';
import {applicationExportArchive, applicationExportManifest, exportApplication} from '../dist/application-export.js';
import {writeApplicationExport} from '../dist/application-node.js';

const root=dirname(dirname(fileURLToPath(import.meta.url))), temporary=await mkdtemp(join(tmpdir(),'ontave-export-consumer-'));
let server;
function run(command,args,cwd=temporary){return execFileSync(command,args,{cwd,encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']});}
async function stop(){if(!server)return;const child=server;server=null;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}
async function start(cwd){
  server=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Exported server did not start.')),15000);
    server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/Ontave application: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    server.stderr.on('data',chunk=>{output+=chunk;});server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Exported server exited ${code}: ${output}`));});
  });
}
try{
  const [packed]=JSON.parse(run('npm',['pack','--json','--pack-destination',temporary],root));
  const definition=ApplicationDefinition.parse(JSON.parse(await readFile(join(root,'examples/application/definition.json'),'utf8')));
  const bundle=exportApplication(definition,{frameworkDependency:'file:./vendor/ontave.tgz'});
  const directory=join(temporary,'generated');await mkdir(directory);
  const tarball=await readFile(join(temporary,packed.filename));
  await writeFile(join(temporary,'application.zip'),applicationExportArchive(bundle,[await applicationExportManifest(bundle),{path:'vendor/ontave.tgz',bytes:tarball}]));
  // A standard ZIP reader must accept every CRC and recover the bundled framework.
  run('python3',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert len(z.read('vendor/ontave.tgz')) > 0; assert 'src/pages/page_1.tsx' in z.namelist(); z.extractall(sys.argv[2])",join(temporary,'application.zip'),directory]);
  await writeApplicationExport(directory,bundle); // Extracted ownership hashes must allow unchanged regeneration.
  run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],directory);
  run('npm',['run','build'],directory);run(process.execPath,['--check','server.mjs'],directory);
  let origin=await start(directory);
  async function command(value,expected=200,requestOrigin=origin){const response=await fetch(origin+'/api/ontave/commands',{method:'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin},body:JSON.stringify(value)});assert.equal(response.status,expected,await response.clone().text());return response.json();}
  assert.equal((await fetch(origin)).status,200);
  const create={kind:'create',entity:'leads',requestId:'lead-1',values:{name:'Aster Studio',value:0,active:false}};
  await command(create,403,'https://untrusted.example');
  const first=await command(create), repeated=await command(create);assert.deepEqual(first,repeated);assert.equal(first.record.values.value,0);assert.equal(first.record.values.active,false);assert.deepEqual(first.effects[0].payload,{});
  await command({...create,values:{name:'Conflicting'}},409);
  const updated=await command({kind:'update',entity:'leads',id:first.record.id,expectedRevision:1,requestId:'lead-edit',values:{...first.record.values,name:'Aster Studio Updated'}});assert.equal(updated.record.revision,2);
  await command({kind:'delete',entity:'leads',id:first.record.id,expectedRevision:1,requestId:'stale-delete'},409);
  const task=await command({kind:'create',entity:'tasks',requestId:'task-1',values:{title:'Follow up',lead:first.record.id}});assert.equal(task.record.values.done,false);
  await command({kind:'delete',entity:'leads',id:first.record.id,expectedRevision:2,requestId:'delete-referenced'},409);
  await stop();origin=await start(directory);
  const rows=await (await fetch(origin+'/api/ontave/records/leads')).json();assert.equal(rows.length,1);assert.equal(rows[0].values.name,'Aster Studio Updated');
  assert.deepEqual(await command(create),first);
  await command({kind:'delete',entity:'tasks',id:task.record.id,expectedRevision:1,requestId:'task-delete'});
  await command({kind:'delete',entity:'leads',id:first.record.id,expectedRevision:2,requestId:'lead-delete'});
  assert.deepEqual(await (await fetch(origin+'/api/ontave/records/leads')).json(),[]);
  console.log('Verified generated app: standard ZIP, bundled package install, editable TSX build, local API, persistent restart, references, revisions, CSRF origin checks and exact durable retries.');
}catch(error){if(error?.stdout)process.stderr.write(error.stdout);if(error?.stderr)process.stderr.write(error.stderr);throw error;}
finally{await stop();await rm(temporary,{recursive:true,force:true});}
