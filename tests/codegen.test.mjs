import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, rm, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  generateContract,
  validateContractRecords,
  starter,
  hash,
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
