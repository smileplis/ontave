import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openOntave } from "../../dist/local.js";
import { fixtureAdapter, personFixture } from "../../dist/testing.js";
test("local setup persists source and accepted data across restarts, enforces a directory lock and provides a protected review UI", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "ontave-local-")),
    model = fixtureAdapter(() => personFixture("Rahul"));
  let local = await openOntave({ directory, model });
  t.after(() => local.close());
  const workspaceId = local.workspaceId;
  assert.equal(
    (await stat(resolve(directory, "local.json"))).mode & 0o777,
    0o600,
  );
  assert.match(await readFile(resolve(directory, ".gitignore"), "utf8"), /\*/);
  await assert.rejects(
    openOntave({ directory, model }),
    (e) => e.code === "OPERATION_IN_PROGRESS",
  );
  const receipt = await local.ingest({ id: "message-1", text: "Rahul" });
  await local.process();
  const studio = await local.studio({ port: 0 }),
    page = await fetch(studio.url),
    cookie = page.headers.get("set-cookie").split(";")[0];
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Original|source/);
  assert.equal((await fetch(studio.url + "/api/jobs")).status, 403);
  const view = await (
    await fetch(studio.url + "/api/review?job=" + receipt.job_id, {
      headers: { cookie },
    })
  ).json();
  const input = {
    bundleId: view.bundle.id,
    digest: view.bundle.hash,
    requestKey: crypto.randomUUID(),
  };
  const request = (body, origin = studio.url) =>
    fetch(studio.url + "/api/accept", {
      method: "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "x-ontave-studio": "1",
      },
      body: JSON.stringify(body),
    });
  assert.equal((await request(input, "https://unrelated.invalid")).status, 403);
  assert.equal(
    (await request({ ...input, digest: "0".repeat(64) })).status,
    400,
  );
  assert.equal((await request(input)).status, 200);
  const identity = JSON.parse(
    await readFile(resolve(directory, "local.json"), "utf8"),
  );
  assert.ok(
    !(
      await (
        await fetch(studio.url + "/api/catalog", { headers: { cookie } })
      ).text()
    ).includes(identity.password),
  );
  await local.close();
  local = await openOntave({ directory });
  assert.equal(local.workspaceId, workspaceId);
  const contract = await local.runtime.contracts.register(
    local.context,
    (await local.runtime.ontology.inspect(local.context)).definition,
  );
  const result = await local.runtime.entities.find(local.context, {
    contractId: contract.id,
    contractHash: contract.hash,
    conceptId: "person",
  });
  assert.equal(result.records[0].fields.name.value, "Rahul");
  assert.equal(
    (await local.ingest({ id: "message-1", text: "Rahul" })).evidence_id,
    receipt.evidence_id,
  );
  await assert.rejects(local.process(), (e) => e.code === "MODEL_UNAVAILABLE");
});
test("closing a local workspace cancels a hung adapter and retains the source without waiting for the model deadline", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ontave-local-cancel-"));
  let started;
  const ready = new Promise((ok) => (started = ok));
  const app = await openOntave({
    directory,
    model: {
      extract: async () => {
        started();
        return new Promise(() => {});
      },
    },
  });
  await app.ingest({ id: "hung", text: "Rahul" });
  const work = app.process();
  await ready;
  const at = performance.now();
  await app.close();
  assert.ok(performance.now() - at < 5000);
  await work;
  const reopened = await openOntave({ directory });
  try {
    assert.equal(
      (await reopened.runtime.jobs.list(reopened.context)).length,
      1,
    );
  } finally {
    await reopened.close();
  }
});
