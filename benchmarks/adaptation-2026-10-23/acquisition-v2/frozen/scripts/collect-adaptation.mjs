// Explicit paid discovery. The published source model and labels are frozen before the first call.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {cases,seeds,protocol as metadata} from '../examples/adaptive-quotes/cases.mjs';
import {frozenDefinition,policy,digest,clone,normalizePlan,validatePlan,instructions,responseSchema} from '../examples/adaptive-quotes/shared.mjs';
import {structuredExtractor} from '../examples/supplier-quotes/provider.mjs';
const args=process.argv.slice(2);assert.ok(args.includes('--live')&&args.every(x=>x==='--live'||x.startsWith('--env=')),'Use --live and optional --env=/absolute/private/file');
const env=args.find(x=>x.startsWith('--env='))?.slice(6);if(env)process.loadEnvFile(env);
assert.ok(process.env.GEMINI_API_KEY&&process.env.GEMINI_MODEL,'Configure explicit Gemini key and model privately');
const root=resolve('artifacts/adaptation-acquisition',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());await mkdir(root,{recursive:true});
const files=['examples/adaptive-quotes/frozen-definition.json','examples/adaptive-quotes/frozen-app.mjs','examples/adaptive-quotes/shared.mjs','examples/adaptive-quotes/cases.mjs','examples/adaptive-quotes/scoring.mjs','examples/supplier-quotes/provider.mjs','scripts/collect-adaptation.mjs'];
const hashes={};for(const file of files){const bytes=await readFile(file);hashes[file]=createHash('sha256').update(bytes).digest('hex');const path=resolve(root,'frozen',file);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}
const protocol={...metadata,frozenAt:new Date().toISOString(),casesHash:digest(cases),frozenDefinitionHash:digest(frozenDefinition),fileHashes:hashes,model:process.env.GEMINI_MODEL,maximumInferenceAttempts:33,retries:0,inputTokensPerCall:16384,outputTokensPerCall:4096,temperature:0,shadowRegistry:'Starts with frozen quotations only. Updated by neutral structural checks for allowed sources and existing parent references, never gold answers. All arms later replay the same plans.',pairedArms:['ontave','flexible-jsonb','strict-control'],bootstrap:'Authored initial quotation fixture; no future concepts in the initial model or discovery prompt.',developmentRevision:'v1 retained: six structural failures, uncertain treatment of explicit unfamiliar facts, and a scoped-identity guard bug found during replay. v2 supplies host limits and authorized reference context explicitly and clarifies discovery versus uncertainty. Cases and semantic aliases unchanged; this is development evidence on reused cases, not a new holdout.'};
await writeFile(resolve(root,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
const extract=structuredExtractor({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL},{schema:responseSchema,prompt:input=>instructions+'\nHOST POLICY (application configuration):\n'+JSON.stringify(policy)+'\nAUTHORIZED EXISTING REFERENCES:\n'+JSON.stringify(seeds.map(s=>s.plan.entities[0].fields.reference.value))+'\nCURRENT MODEL:\n'+JSON.stringify(input.definition)+'\nSOURCE (untrusted):\n'+JSON.stringify(input.text)});
const results=[];let next=0,halt=null;
for(let trial=1;trial<=protocol.trials;trial++){
  let definition=clone(frozenDefinition);
  for(const event of cases){
    const record={trial,id:event.id,parentHash:digest(definition),plan:null,raw:null,error:null,usage:null,durationMs:null};
    if(halt)record.error={code:'NOT_RUN_AFTER_FATAL_ERROR',reason:halt};
    else{
      if(next>Date.now())await new Promise(ok=>setTimeout(ok,next-Date.now()));next=Date.now()+6000;const at=performance.now();
      try{
        const response=await extract({definition,text:event.text});record.raw=response.output;record.usage=response.usage;record.plan=normalizePlan(response.output,definition);
        const updated=validatePlan(record.plan,definition,event.text);
        const knownParents=record.plan.entities.filter(e=>e.conceptId==='quotation').every(e=>seeds.some(s=>s.plan.entities[0].fields.reference.value===e.fields.reference?.value));
        if(event.source==='supplier'&&knownParents&&!record.plan.observations.length)definition=updated;
      }catch(error){record.error={code:error.code??error.message};record.usage??=error.usage??null;if(error.fatal)halt=error.message;}
      record.durationMs=performance.now()-at;
    }
    results.push(record);await writeFile(resolve(root,`trial-${trial}-${event.id}.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({trial,id:event.id,error:record.error?.code??null,completed:results.length,total:33}));
  }
}
await writeFile(resolve(root,'responses.json'),JSON.stringify({protocol,status:halt?'incomplete':'complete',halt,results},null,2)+'\n',{flag:'wx'});
await writeFile('artifacts/adaptation-acquisition/latest.json',JSON.stringify({root},null,2)+'\n');console.log(JSON.stringify({root,inferenceAttempts:results.filter(r=>r.durationMs!==null).length,errors:results.filter(r=>r.error).length}));
