import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startQuotationStudy } from "../examples/supplier-quotes/study-server.mjs";
import { quotationCases } from "../examples/supplier-quotes/cases.mjs";
test("study controller requires a session, same-origin mutations and exact proposal hashes; automated checks never become human results", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "quotation-controller-")),
    archive = resolve(root, "fixture.tgz");
  await writeFile(archive, "not an installed package");
  const tasks = { plain: [], ontave: [] };
  let accepts = 0;
  for (const arm of ["plain", "ontave"])
    for (let n = 0; n < 3; n++) {
      const document = quotationCases[0],
        id = randomUUID(),
        jobId = randomUUID();
      const view = {
        jobId,
        state: "waiting_review",
        evidence: { text: document.text },
        bundle: {
          id,
          digest: "a".repeat(64),
          output: document.expected,
          pending: [],
        },
      };
      const store = {
        review: async () => view,
        accept: async () => {
          accepts++;
        },
        reject: async () => {},
        amend: async () => {
          view.bundle.digest = "b".repeat(64);
        },
      };
      tasks[arm].push({
        arm,
        store,
        context: null,
        document,
        receipt: { jobId },
        injectedError: null,
      });
    }
  const controller = await startQuotationStudy({
    root,
    tasks,
    setups: {
      plain: {
        config: { workspaceId: randomUUID(), connectionString: "fictional" },
      },
      ontave: {
        config: { workspaceId: randomUUID(), connectionString: "fictional" },
      },
    },
    candidateArchive: archive,
    nodePath: process.execPath,
    automated: true,
  });
  t.after(() => controller.close());
  assert.equal((await fetch(controller.url + "/api/state")).status, 403);
  const page = await fetch(controller.url),
    cookie = page.headers.get("set-cookie").split(";")[0];
  assert.equal(page.status, 200);
  const request = (path, input, headers = {}) =>
    fetch(controller.url + path, {
      method: "POST",
      headers: {
        cookie,
        origin: controller.url,
        "content-type": "application/json",
        "x-quotation-study": "1",
        ...headers,
      },
      body: JSON.stringify(input),
    });
  assert.equal(
    (
      await request(
        "/api/start",
        { requestKey: randomUUID() },
        { origin: "https://unrelated.invalid" },
      )
    ).status,
    403,
  );
  const startKey = randomUUID();
  assert.equal(
    (await request("/api/start", { requestKey: startKey })).status,
    200,
  );
  assert.equal(
    (await request("/api/start", { requestKey: startKey, unexpected: true }))
      .status,
    409,
  );
  for (const label of ["A", "B"]) {
    assert.equal(
      (await request("/api/setup/start", { requestKey: randomUUID() })).status,
      200,
    );
    const path = resolve(root, "setup-" + label, "private-config.json"),
      config = JSON.parse(await readFile(path, "utf8"));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const callback = await fetch(controller.url + "/api/setup/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-setup-proof": config.nonce,
      },
      body: JSON.stringify({ arm: config.arm, ok: true }),
    });
    assert.equal(callback.status, 200);
  }
  for (let n = 0; n < 6; n++) {
    const start = await request("/api/task/start", {
        requestKey: randomUUID(),
      }),
      state = await start.json();
    assert.equal(start.status, 200);
    assert.equal("expected" in state, false);
    const body = {
      requestKey: randomUUID(),
      bundleId: state.view.bundle.id,
      digest: state.view.bundle.digest,
      decision: "accept",
    };
    assert.equal(
      (
        await request("/api/task/decide", {
          ...body,
          requestKey: randomUUID(),
          digest: "f".repeat(64),
        })
      ).status,
      400,
    );
    assert.equal((await request("/api/task/decide", body)).status, 200);
    assert.equal((await request("/api/task/decide", body)).status, 200);
  }
  assert.equal(accepts, 6);
  const report = await (
    await fetch(controller.url + "/api/report", { headers: { cookie } })
  ).json();
  assert.equal(report.automated, true);
  assert.equal(report.participants, 0);
  assert.equal(report.review.length, 6);
});
