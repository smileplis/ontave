import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  cache = resolve(root, ".cache/npm");
function run(bin, args, cwd = root) {
  const r = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
  if (r.status !== 0)
    throw new Error(
      `${bin} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`,
    );
  return r.stdout;
}
await mkdir(resolve(root, "artifacts"), { recursive: true });
const packed = JSON.parse(
  run("npm", ["pack", "--json", "--pack-destination", "artifacts"]),
)[0];
const archive = resolve(root, "artifacts", packed.filename),
  consumer = await mkdtemp(
    resolve(await realpath(tmpdir()), "ontave-consumer-"),
  );
await writeFile(
  resolve(consumer, "package.json"),
  JSON.stringify({
    name: "ontave-clean-consumer",
    private: true,
    type: "module",
    dependencies: { ontave: `file:${archive}` },
  }),
);
run(
  "npm",
  [
    "install",
    ...(process.argv.includes("--offline") ? ["--offline"] : []),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  consumer,
);
await writeFile(
  resolve(consumer, "check.mjs"),
  `import { createOntave, sourceSpan, generateContract, starter, hash } from 'ontave';
import {randomUUID} from 'node:crypto';
import { postgres } from 'ontave/postgres';
import { fixtureAdapter } from 'ontave/testing';
import { mistral } from 'ontave/models/mistral';
import { openrouter } from 'ontave/models/openrouter';
import { gemini } from 'ontave/models/gemini';
import { groq } from 'ontave/models/groq';
if(typeof createOntave!=='function'||typeof postgres!=='function'||typeof fixtureAdapter!=='function')throw Error('Bad exports');
if(typeof mistral!=='function'||typeof openrouter!=='function')throw Error('Missing experimental adapter exports');
for(const factory of [gemini,groq,mistral,openrouter]){let rejected=false;try{factory({apiKey:'',model:''});}catch(e){rejected=e.code==='MODEL_UNAVAILABLE';}if(!rejected)throw Error('Missing provider configuration was not rejected');}
const span=sourceSpan('₹50','₹50');if(span.endByte!==5)throw Error('Bad bytes');
await generateContract({id:randomUUID(),hash:hash(starter),definition:starter,sourceOntologyId:randomUUID(),sourceOntologyHash:hash(starter)},'./generated');
const generated=await import('./generated/index.mjs');
const record={id:randomUUID(),conceptId:'person',name:'Asha',revision:1,fields:{name:{state:'value',value:'Asha',verification:'reported',assertionIds:[randomUUID()]},email:{state:'missing'}}};
if(generated.validate([record])[0].fields.name.value!=='Asha')throw Error('Generated validator failed');
console.log('clean consumer imports and generated validators passed without a database or provider credential');`,
);
const node = process.execPath;
run(node, ["check.mjs"], consumer);
const help = run(node, ["node_modules/ontave/dist/cli.js", "help"], consumer);
if (!help.includes("Ontave")) throw Error("CLI missing");
await writeFile(
  resolve(consumer, "check.ts"),
  `import { createOntave, type FieldResult, type ModelAdapter } from 'ontave';
import { postgres } from 'ontave/postgres';
import {type OntaveEntities,validate} from './generated/index.mjs';
const value: FieldResult<string> = {state:'unknown',reason:'test',assertionIds:[]};
const model:ModelAdapter={async extract(){return {model:'test',output:{entities:[],relationships:[],observations:[]}}}};
const name:OntaveEntities['person']['fields']['name']={state:'value',value:'Asha',verification:'reported',assertionIds:[]};
const reviewOnly=createOntave({storage:postgres({connectionString:'postgresql://unused.invalid/db'}),authorize:async()=>({actorId:'reader',workspaceId:'00000000-0000-4000-8000-000000000001',capabilities:['read','review']})});
const reviewSnapshot=()=>reviewOnly.reviews.forJob('trusted context','00000000-0000-4000-8000-000000000002');
// @ts-expect-error declared person name cannot contain a number
const wrongName:OntaveEntities['person']['fields']['name']={state:'value',value:123,verification:'reported',assertionIds:[]};
void [value,model,createOntave,postgres,name,wrongName,validate,reviewSnapshot];`,
);
run(
  node,
  [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "NodeNext",
    "--target",
    "ES2023",
    "check.ts",
  ],
  consumer,
);
const configPath = resolve(consumer, "ontave.config.mjs");
run(
  node,
  ["node_modules/ontave/dist/cli.js", "init", "--output", configPath],
  consumer,
);
const scaffold = await readFile(configPath, "utf8");
const again = spawnSync(
  node,
  ["node_modules/ontave/dist/cli.js", "init", "--output", configPath],
  { cwd: consumer, encoding: "utf8" },
);
if (again.status === 0 || (await readFile(configPath, "utf8")) !== scaffold)
  throw Error("Initialization overwrote existing configuration");
const installed = JSON.parse(
  await readFile(resolve(consumer, "node_modules/ontave/package.json"), "utf8"),
);
if (installed.scripts?.postinstall || installed.scripts?.install)
  throw Error("Package has an installation side effect");
await readFile(
  resolve(consumer, "node_modules/ontave/examples/supplier-quotes/run.mjs"),
);
await readFile(
  resolve(consumer, "node_modules/ontave/docs/SUPPLIER_QUOTATION_BENCHMARK.md"),
);
const publishedResults = JSON.parse(
  await readFile(
    resolve(
      consumer,
      "node_modules/ontave/benchmarks/quotation-2026-10-23/results.json",
    ),
    "utf8",
  ),
);
if (publishedResults.productionQualified !== false)
  throw Error("Benchmark must preserve open qualification gates");
const report = {
  archive,
  consumer,
  version: packed.version,
  integrity: packed.integrity,
  files: packed.files.length,
  node: process.version,
  imports: true,
  types: true,
  cli: true,
  networkDuringChecks: false,
  generatedTypes: true,
  generatedValidator: true,
  safeInitialization: true,
};
await writeFile(
  resolve(root, "artifacts/package-verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
