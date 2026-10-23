// Explicit bounded live acquisition. Labels are never passed to the extractor.
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { quotationCases,datasetMetadata } from '../examples/supplier-quotes/cases.mjs';
import { quotationDefinition,digest,validateOutput } from '../examples/supplier-quotes/domain.mjs';
import { quotationExtractor } from '../examples/supplier-quotes/provider.mjs';
const args=process.argv.slice(2);
if(!args.includes('--live'))throw Error('Explicit --live required; only fictional quotation text is sent to Gemini');
for(const arg of args)if(!['--live'].includes(arg)&&!arg.startsWith('--env=')&&!arg.startsWith('--trials='))throw Error('Unknown acquisition argument');
const env=args.find(a=>a.startsWith('--env='))?.slice(6);if(env)process.loadEnvFile(env);
const trials=Number(args.find(a=>a.startsWith('--trials='))?.slice(9)??3);
assert.ok(Number.isInteger(trials)&&trials>=1&&trials<=3);
for(const c of quotationCases)validateOutput(c.expected,c.text);
const root=resolve('artifacts/quotation-trials',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
await mkdir(root,{recursive:true});
const files=['examples/supplier-quotes/domain.mjs','examples/supplier-quotes/cases.mjs','examples/supplier-quotes/provider.mjs','examples/supplier-quotes/scoring.mjs','scripts/collect-quotation-trials.mjs'];
const fileHashes={};
for(const file of files){const bytes=await readFile(file);fileHashes[file]=createHash('sha256').update(bytes).digest('hex');const destination=resolve(root,'frozen',file);await mkdir(resolve(destination,'..'),{recursive:true});await writeFile(destination,bytes,{flag:'wx'});}
const protocol={version:'quotation-comparison-v1.2',frozenAt:new Date().toISOString(),dataset:datasetMetadata,datasetHash:digest(quotationCases),definitionHash:digest(quotationDefinition),fileHashes,
  developmentChanges:'Two acquisitions halted after their first provider HTTP 400. Replaced optional-property-heavy provider schema with a generic claim map; the host retains the same closed domain validation, fields, instructions, labels and scoring. Failed acquisitions and diagnostics retained.',
  model:process.env.GEMINI_MODEL,trials,documentsPerTrial:quotationCases.length,maximumInferenceCalls:trials*quotationCases.length,maximumOutputTokensPerCall:4096,maximumInputTokensPerCall:16384,
  automaticRetries:0,minimumCallIntervalMs:6000,temperature:0,pairedDesign:'One acquired prediction is replayed into both arms. Raw extraction accuracy is shared, not a claimed framework uplift.',
  scoring:'One-to-one type/quotation/SKU/field/normalized-value match with verbatim source containment; extra fields are false positives, missing or failed documents retain all expected fields as misses. Empty documents evaluated separately. Raw and accepted-data results separate.',
  humanEffort:'Pending real participant sessions; machine timings, scripted decisions and code counts are separate.',
  externalBenchmark:'DocILE is a reference method. Dataset access and official evaluator run remain pending. No official DocILE score.',
  statistics:'95% family-cluster bootstrap; repeated trials stay in document-family cluster. Wilson intervals for binary document outcomes.',
  thresholds:{heldoutRawPrecision:0.95,heldoutRawRecall:0.90,unsafeWrites:0,wrongWorkspaceReads:0,duplicateEffects:0,staleApprovals:0},node:process.version};
await writeFile(resolve(root,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
const extract=quotationExtractor({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL}),results=[];
let nextAt=0,halt=null;
for(let trial=1;trial<=trials;trial++)for(const c of quotationCases){
  const record={trial,id:c.id,family:c.family,split:c.split,inputHash:digest(c.text),output:null,usage:null,error:null,durationMs:null};
  if(halt)record.error={code:'NOT_RUN_AFTER_FATAL_ERROR',reason:halt};
  else{
    const wait=Math.max(0,nextAt-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));nextAt=Date.now()+protocol.minimumCallIntervalMs;
    const started=performance.now();
    try{const response=await extract(c.text);Object.assign(record,{output:response.output,usage:response.usage,model:response.model});}
    catch(error){record.error={code:error.message};record.usage=error.usage??null;if(error.fatal)halt=error.message;}
    record.durationMs=performance.now()-started;
  }
  await writeFile(resolve(root,`trial-${trial}-${c.id}.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx'});results.push(record);
  await writeFile(resolve(root,'progress.json'),JSON.stringify({completed:results.length,total:trials*quotationCases.length,halt},null,2)+'\n');
  console.log(JSON.stringify({trial,id:c.id,error:record.error?.code??null,completed:results.length,total:trials*quotationCases.length}));
}
await writeFile(resolve(root,'responses.json'),JSON.stringify({protocol,status:halt?'incomplete':'complete',halt,results},null,2)+'\n',{flag:'wx'});
await mkdir('artifacts/quotation-trials',{recursive:true});await writeFile('artifacts/quotation-trials/latest.json',JSON.stringify({root,status:halt?'incomplete':'complete'},null,2)+'\n');
console.log(JSON.stringify({root,status:halt?'incomplete':'complete',calls:results.filter(r=>r.durationMs!==null).length}));
