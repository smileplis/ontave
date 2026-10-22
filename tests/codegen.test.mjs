import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, rm, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  generateContract,
  validateContractRecords,
  starter,
  hash,
  definition,
  extend,
} from "../dist/index.js";
const id = randomUUID(),
  assertion = randomUUID();
const row = () => ({
  id,
  conceptId: "person",
  name: "Asha",
  revision: 1,
  fields: {
    name: {
      state: "value",
      value: "Asha",
      verification: "reported",
      assertionIds: [assertion],
    },
    email: { state: "missing" },
  },
});

test("contract validators distinguish null, unknown, conflict and absence and reject malformed nested envelopes", () => {
  const d = definition({
    concepts: [
      {
        ...starter.concepts.find((c) => c.id === "person"),
        fields: starter.concepts
          .find((c) => c.id === "person")
          .fields.map((f) => ({ ...f, nullable: true })),
      },
    ],
    relations: [],
  });
  for (const state of [
    {
      state: "value",
      value: null,
      verification: "reported",
      assertionIds: [assertion],
    },
    { state: "unknown", reason: "Not determined", assertionIds: [] },
    {
      state: "conflict",
      candidates: [
        { value: "Asha", verification: "reported", assertionIds: [assertion] },
        {
          value: "Riya",
          verification: "disputed",
          assertionIds: [randomUUID()],
        },
      ],
    },
  ]) {
    const r = row();
    r.fields.name = state;
    assert.deepEqual(validateContractRecords([r], d), [r]);
  }
  for (const mutate of [
    (r) => {
      r.fields = [];
    },
    (r) => {
      r.fields.name = [];
    },
    (r) => {
      r.fields.name = { state: "toString" };
    },
    (r) => {
      r.fields.name = { state: "conflict", candidates: [null, null] };
    },
    (r) => {
      r.fields.name = {
        state: "conflict",
        candidates: Array(2).fill({
          value: "A",
          verification: "reported",
          assertionIds: [assertion],
          execute: "code",
        }),
      };
    },
    (r) => {
      r.extra = true;
    },
    (r) => {
      r.relationships = { friend: { items: [], hasMore: false } };
    },
  ]) {
    const r = row();
    mutate(r);
    assert.throws(
      () => validateContractRecords([r], d),
      (e) => e.code === "VALIDATION_FAILED",
    );
  }
});

test("generated types keep required absence invalid, optional uncertainty valid, and new concepts explicit", async (t) => {
  const parent = await mkdtemp(resolve("artifacts/contract-types-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const lock = (d) => ({
    id: randomUUID(),
    hash: hash(d),
    definition: d,
    sourceOntologyId: randomUUID(),
    sourceOntologyHash: hash(d),
  });
  const fixed = lock(starter);
  await generateContract(fixed, resolve(parent, "old"));
  await generateContract(fixed, resolve(parent, "repeat"));
  for (const file of [
    "contract.json",
    "index.mjs",
    "validator.mjs",
    "index.d.ts",
    "index.d.mts",
  ])
    assert.equal(
      await readFile(resolve(parent, "old", file), "utf8"),
      await readFile(resolve(parent, "repeat", file), "utf8"),
    );
  const next = extend(starter, {
    concepts: [
      {
        id: "installation",
        name: '"; globalThis.executed = true; //',
        description: "Unicode 屋根 inspection",
        fields: [
          {
            id: "status",
            name: "default",
            description: "State",
            type: "enum",
            values: ["pending", '";process.exit(1);//'],
          },
        ],
      },
    ],
    relations: [],
  });
  await generateContract(lock(next), resolve(parent, "next"));
  const prior = globalThis.executed;
  const generated = await import(
    pathToFileURL(resolve(parent, "next/index.mjs")).href
  );
  assert.equal(typeof generated.validate, "function");
  assert.equal(
    globalThis.executed,
    prior,
    "definition display text must never execute",
  );
  await writeFile(
    resolve(parent, "check.mts"),
    `import type {OntaveEntities as Old} from './old/index.mjs';
import type {OntaveEntities as Next} from './next/index.mjs';
type Name = Old['person']['fields']['name'];
type Email = Old['person']['fields']['email'];
const unknown: Name = {state:'unknown',reason:'not determined',assertionIds:[]};
const missing: Email = {state:'missing'};
const conflict: Name = {state:'conflict',candidates:[{value:'A',verification:'reported',assertionIds:['a']},{value:'B',verification:'reported',assertionIds:['b']}]};
// @ts-expect-error a required field cannot be missing
const absent: Name = {state:'missing'};
// @ts-expect-error a non-nullable field cannot be null
const nil: Name = {state:'value',value:null,verification:'reported',assertionIds:['a']};
// @ts-expect-error adding to the ontology cannot alter a pinned contract type
type Unadopted = Old['installation'];
const installed: Next['installation']['fields']['status'] = {state:'value',value:'pending',verification:'reported',assertionIds:['a']};
// @ts-expect-error enum field stays narrow
const invalid: Next['installation']['fields']['status'] = {state:'value',value:123,verification:'reported',assertionIds:['a']};
`,
  );
  const compiled = spawnSync(
    process.execPath,
    [
      resolve("node_modules/typescript/bin/tsc"),
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--module",
      "nodenext",
      resolve(parent, "check.mts"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  for (const bad of [
    "../person",
    "constructor",
    "__proto__",
    "person;process.exit()",
    "人",
  ])
    assert.throws(
      () =>
        definition({
          concepts: [{ ...next.concepts[0], id: bad }],
          relations: [],
        }),
      (e) => e.code === "VALIDATION_FAILED",
    );
  assert.throws(
    () =>
      definition({
        concepts: [starter.concepts[0], starter.concepts[0]],
        relations: [],
      }),
    (e) => e.code === "VALIDATION_FAILED",
  );
});
test("contract validators reject invalid uncertainty, types and unsupported fields", () => {
  assert.equal(validateContractRecords([row()], starter).length, 1);
  for (const state of [
    { state: "missing" },
    { state: "unknown", reason: "uncertain", assertionIds: [], value: null },
    {
      state: "value",
      value: null,
      verification: "reported",
      assertionIds: [assertion],
    },
    { state: "conflict", candidates: [] },
  ]) {
    const r = row();
    r.fields.name = state;
    assert.throws(() => validateContractRecords([r], starter));
  }
  const r = row();
  r.fields.extra = { state: "missing" };
  assert.throws(() => validateContractRecords([r], starter));
  const unknown = row();
  unknown.fields.name = {
    state: "unknown",
    reason: "Retracted",
    assertionIds: [],
  };
  assert.equal(
    validateContractRecords([unknown], starter)[0].fields.name.state,
    "unknown",
  );
});
test("code generation emits usable safe module/type files and rejects traversal through symlinks", async (t) => {
  const parent = await mkdtemp(
    resolve(await realpath(tmpdir()), "ontave-gen-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const out = resolve(parent, "generated"),
    lock = {
      id: randomUUID(),
      hash: hash(starter),
      definition: starter,
      sourceOntologyId: randomUUID(),
      sourceOntologyHash: hash(starter),
    };
  await generateContract(lock, out);
  const declaration = await readFile(resolve(out, "index.d.mts"), "utf8");
  assert.ok(declaration.includes("FieldResult<string>"));
  assert.equal(
    JSON.parse(await readFile(resolve(out, "contract.json"), "utf8")).hash,
    lock.hash,
  );
  assert.ok(
    (await readFile(resolve(out, "index.mjs"), "utf8")).includes(
      "validator.mjs",
    ),
  );
  await symlink(out, resolve(parent, "link"));
  await assert.rejects(
    generateContract(lock, resolve(parent, "link")),
    (e) => e.code === "INVALID_INPUT",
  );
  await assert.rejects(
    generateContract({ ...lock, hash: "wrong" }, out),
    (e) => e.code === "VALIDATION_FAILED",
  );
});
