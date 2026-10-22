import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { starter } from "../../dist/index.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
test("actual CLI provisioning, review, evaluation, activation, generation and failure paths", async (t) => {
  const db = await disposablePostgres(),
    w = randomUUID(),
    dir = await mkdtemp(resolve("artifacts/cli-workflow-"));
  t.after(async () => {
    await db.storage.close();
    await db.stop();
  });
  const patch = {
    concepts: [
      {
        id: "installation",
        name: "Installation",
        description: "Work",
        fields: [
          {
            id: "reference",
            name: "Reference",
            description: "Reference",
            type: "text",
          },
        ],
      },
    ],
    relations: [],
  };
  const config = resolve(dir, "config.mjs"),
    url = (name) => JSON.stringify(pathToFileURL(resolve("dist/" + name)).href);
  await writeFile(
    config,
    `import{createOntave}from ${url("index.js")};import{postgres}from ${url("postgres.js")};import{fixtureAdapter,personFixture}from ${url("testing.js")};export default()=>({context:null,migrationConnectionString:process.env.ONTAVE_TEST_ADMIN,runtimeRole:'ontave_runtime',runtime:createOntave({storage:postgres({connectionString:process.env.ONTAVE_TEST_DATABASE}),authorize:()=>({actorId:'cli-owner',workspaceId:process.env.ONTAVE_TEST_WORKSPACE,capabilities:['provision','read','ingest','worker','review']}),model:fixtureAdapter(task=>task.text==='I-101'?(task.ontology.concepts.some(c=>c.id==='installation')?{entities:[{mentionId:'work',conceptId:'installation',name:'I-101',fields:{reference:{value:'I-101',quote:'I-101'}}}],relationships:[],observations:[]}:{entities:[],relationships:[],observations:[{concept:'Installation',quote:'I-101'}]}):personFixture(task.text))})});`,
  );
  let serial = 0;
  const cli = async (args, input, code = 0) => {
    const all = [...args, "--config", config];
    if (input !== undefined) {
      const file = resolve(dir, `input-${serial++}.json`);
      await writeFile(file, JSON.stringify(input));
      all.push("--input", file);
    }
    // spawnSync would block the in-process PostgreSQL socket driver during long DB startup,
    // but the database is an independent OS process and each CLI owns its own connection.
    const result = spawnSync(
      process.execPath,
      [resolve("dist/cli.js"), ...all],
      {
        env: {
          ...process.env,
          ONTAVE_TEST_DATABASE: db.connectionString,
          ONTAVE_TEST_ADMIN: db.admin.options.connectionString,
          ONTAVE_TEST_WORKSPACE: w,
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, code, result.stderr);
    return JSON.parse(code ? result.stderr : result.stdout);
  };
  await cli(["workspace", "create"], {
    workspaceId: w,
    name: "CLI",
    seed: "people",
    requestKey: "create",
  });
  await cli(["doctor"]);
  await cli(["migrate", "plan"]);
  await cli(["migrate", "apply"], undefined, 1);
  await cli(["migrate", "apply", "--yes"]);
  const contract = await cli(["contract", "register"], starter);
  const ingest = (text) =>
    cli(["ingest"], {
      source: "cli",
      idempotencyKey: text,
      payload: { kind: "text", text },
    });
  await ingest("Asha");
  assert.equal((await cli(["status"]))[0].state, "queued");
  const work = await cli(["worker", "once"]),
    bundle = await cli(["review", "show", "--id", work.bundleId]);
  const accept = {
    bundleId: bundle.id,
    digest: bundle.hash,
    requestKey: "accept",
    reason: "CLI fictional source checked",
  };
  assert.equal(
    (await cli(["review", "accept"], accept, 1)).code,
    "INVALID_INPUT",
  );
  await cli(["review", "accept", "--yes"], accept);
  await cli(["review", "accept", "--yes"], accept);
  const q = {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  };
  assert.equal(
    (await cli(["entities", "find"], q)).records[0].fields.name.value,
    "Asha",
  );
  const lock = await cli(["contract", "pull", "--id", contract.id]),
    out = resolve(dir, "generated");
  await cli(["typegen", "--output", out], lock);
  assert.ok(
    (await readFile(resolve(out, "index.d.ts"), "utf8")).includes(
      "OntaveEntities",
    ),
  );
  const r = await ingest("I-101");
  assert.equal((await cli(["worker", "once"])).state, "waiting_ontology");
  const candidate = await cli(["ontology", "propose"], {
    patch,
    evidenceIds: [r.evidence_id],
    requestKey: "proposal",
    reason: "Work concept",
  });
  await cli(["ontology", "validate", "--id", candidate.candidateId]);
  const suite = await cli(["evaluation", "register"], {
    name: "CLI suite",
    maxCalls: 2,
    timeoutMs: 5000,
    tasks: [
      { id: "old", kind: "contract", contractId: contract.id },
      {
        id: "work",
        kind: "extract",
        evidenceId: r.evidence_id,
        expected: [
          { conceptId: "installation", fieldId: "reference", value: "I-101" },
        ],
      },
    ],
  });
  const evaluation = await cli(["ontology", "evaluate"], {
    candidateId: candidate.candidateId,
    suiteId: suite.suiteId,
  });
  assert.equal(evaluation.passed, true);
  assert.equal(
    (await cli(["evaluation", "get", "--id", evaluation.evaluationId])).passed,
    true,
  );
  const publication = {
    candidateId: candidate.candidateId,
    candidateHash: candidate.hash,
    evaluationId: evaluation.evaluationId,
    evaluationHash: evaluation.hash,
    requestKey: "publish",
    reason: "CLI exact evaluation approved",
  };
  await cli(["ontology", "publish"], publication, 1);
  await cli(["ontology", "publish", "--yes"], publication);
  assert.equal((await cli(["ontology", "inspect"])).ordinal, 1);
  const replay = await cli(["worker", "once"]);
  let b = await cli(["review", "show", "--id", replay.bundleId]);
  const revised = await cli(["review", "amend"], {
    bundleId: b.id,
    digest: b.hash,
    extraction: b.body.extraction,
    requestKey: "amend",
    reason: "Renewed exact source review",
  });
  await cli(["review", "accept", "--yes"], {
    bundleId: revised.bundleId,
    digest: revised.digest,
    requestKey: "accept-work",
    reason: "CLI replay checked",
  });
  await cli(["metrics"]);
  await cli(["ingest"], {
    source: "cli",
    idempotencyKey: "same-name",
    payload: { kind: "text", text: "Asha" },
  });
  const ambiguous = await cli(["worker", "once"]);
  assert.equal(ambiguous.state, "waiting_identity");
  b = await cli(["review", "show", "--id", ambiguous.bundleId]);
  const resolved = await cli(["review", "resolve-identity"], {
    bundleId: b.id,
    digest: b.hash,
    mentionId: "person_1",
    entityId: "new",
    requestKey: "identity",
    reason: "No trustworthy identifier",
  });
  await cli(["review", "reject"], {
    bundleId: resolved.bundleId,
    digest: resolved.digest,
    requestKey: "reject",
    reason: "Explicitly decline new identity",
  });
  const rejected = await cli(["ontology", "propose"], {
    patch: {
      concepts: [
        {
          id: "customer",
          name: "Customer",
          description: "Person role",
          fields: [
            { id: "name", name: "Name", description: "Name", type: "text" },
          ],
        },
      ],
      relations: [],
    },
    evidenceIds: [r.evidence_id],
    requestKey: "second-candidate",
    reason: "Check reuse",
  });
  await cli(["ontology", "reject"], {
    candidateId: rejected.candidateId,
    candidateHash: rejected.hash,
    requestKey: "reject-candidate",
    reason: "Reuse Person",
  });
  assert.equal(
    (await cli(["ontology", "diff", "--id", rejected.candidateId])).state,
    "rejected",
  );
  assert.equal(
    (
      await cli(
        ["review", "resolve-conflict"],
        {
          entityId: randomUUID(),
          fieldId: "name",
          expectedRevision: 1,
          selectedAssertionId: null,
          statement: "No evidence",
          requestKey: "missing",
          reason: "Missing scoped entity",
        },
        1,
      )
    ).code,
    "STALE_BUNDLE",
  );
});
