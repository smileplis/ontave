// The installed package must support first-time local provisioning and offline cache reuse.
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const packed = JSON.parse(
    await readFile("artifacts/package-verification.json", "utf8"),
  ),
  directory = await mkdtemp(resolve(tmpdir(), "ontave-installed-local-"));
await writeFile(
  resolve(packed.consumer, "local-check.mjs"),
  `import assert from 'node:assert/strict';
import {openOntave} from 'ontave/local';import {fixtureAdapter,personFixture}from'ontave/testing';
const directory=process.env.ONTAVE_LOCAL_CHECK_DIR;let app=await openOntave({directory,install:true,model:fixtureAdapter(()=>personFixture('Rahul'))});
try{const r=await app.ingest({id:'fixture-1',text:'Rahul'});await app.process();const view=await app.runtime.reviews.forJob(app.context,r.job_id);const studio=await app.studio({port:0}),response=await fetch(studio.url),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(response.status,200);const accept=await fetch(studio.url+'/api/accept',{method:'POST',headers:{cookie,origin:studio.url,'content-type':'application/json','x-ontave-studio':'1'},body:JSON.stringify({bundleId:view.bundle.id,digest:view.bundle.hash,requestKey:crypto.randomUUID()})});assert.equal(accept.status,200);}finally{await app.close();}
app=await openOntave({directory,install:false});try{assert.equal((await app.find({conceptId:'person'})).records[0].fields.name.value,'Rahul');console.log('Installed local persistence, Studio approval and cached restart passed');}finally{await app.close();}
`,
);
const start = performance.now();
let output = "",
  error = "";
const child = spawn(process.execPath, ["local-check.mjs"], {
  cwd: packed.consumer,
  env: {
    ...process.env,
    ONTAVE_LOCAL_CHECK_DIR: directory,
    npm_config_cache: resolve(".cache/npm"),
    PATH: resolve("node_modules/node/bin") + ":" + process.env.PATH,
  },
});
child.stdout.on("data", (c) => (output += c));
child.stderr.on("data", (c) => (error += c));
const exit = await new Promise((ok, fail) => {
  child.once("error", fail);
  child.once("exit", ok);
});
assert.equal(exit, 0, error + "\n" + output);
const report = {
  ok: true,
  version: packed.version,
  archiveSha256: createHash("sha256")
    .update(await readFile(packed.archive))
    .digest("hex"),
  node: process.version,
  automatedElapsedMs: performance.now() - start,
  scope:
    "Clean installed package, local provisioning, fictional review UI, persistent data and cached restart; npm caches may be warm. Not human setup time.",
  modelCalls: 0,
  hostedInfrastructureCreated: false,
};
await writeFile(
  "artifacts/local-verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
