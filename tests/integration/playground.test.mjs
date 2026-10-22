import test from "node:test";
import assert from "node:assert/strict";
import { PreviewSession } from "../../dist/preview/session.js";
import { startPlayground } from "../../dist/playground.js";
import { disposablePostgres } from "../helpers/postgres.mjs";
import { referenceClient } from "../../examples/playground/web/playground.js";
import { readFile } from "node:fs/promises";

test("developer playground exercises governed model adoption and source-bound records", async (t) => {
  const db = await disposablePostgres(),
    session = new PreviewSession(db.storage);
  t.after(async () => {
    await session.close();
    await db.stop();
  });
  for (const scenario of ["roof", "payment"])
    await t.test(
      scenario +
        " remains non-canonical until exact review and keeps reported verification",
      async () => {
        let state = await session.reset(scenario);
        assert.equal(state.phase, "ready");
        assert.equal(state.records.length, 0);
        await assert.rejects(
          session.act("accept"),
          (e) => e.code === "INVALID_INPUT",
        );
        state = await session.act("interpret");
        assert.equal(state.phase, "model-review");
        assert.equal(state.source.jobState, "waiting_ontology");
        assert.equal(state.records.length, 0);
        state = await session.act("evaluate");
        assert.equal(state.evaluation.passed, true);
        assert.equal(state.earlierContract.readable, true);
        state = await session.act("activate");
        assert.equal(state.phase, "fact-review");
        assert.equal(state.records.length, 0);
        assert.equal(state.source.jobState, "waiting_identity");
        assert.deepEqual(state.bundle.pending.sort(), [
          "installation",
          "person",
        ]);
        state = await session.act("accept");
        assert.equal(state.records.length, 1);
        assert.equal(state.source.jobState, "completed");
        assert.equal(state.earlierContract.readable, true);
        assert.equal(state.usage.providerCalls, 0);
        const field = Object.values(state.records[0].fields)[0];
        assert.equal(field.verification, "reported");
        assert.ok(field.assertionIds.length);
        if (scenario === "payment")
          assert.deepEqual(field.value, { amount: "50000", currency: "INR" });
        await assert.rejects(
          session.act("activate"),
          (e) => e.code === "INVALID_INPUT",
        );
      },
    );
  await t.test(
    "declining models and facts retains evidence and no new accepted record",
    async () => {
      await session.reset("roof");
      await session.act("interpret");
      let state = await session.act("reject");
      assert.equal(state.phase, "rejected");
      assert.equal(state.records.length, 0);
      assert.ok(state.source.evidenceId);
      assert.ok(!state.model.concepts.some((c) => c.id === "roof_inspection"));
      await session.reset("roof");
      for (const action of ["interpret", "evaluate", "activate"])
        await session.act(action);
      state = await session.act("reject");
      assert.equal(state.records.length, 0);
      assert.ok(state.model.concepts.some((c) => c.id === "roof_inspection"));
    },
  );
  await t.test(
    "public reference branches preserve the actual SDK phases and cannot skip review",
    async () => {
      const manifest = JSON.parse(
          await readFile("website/public/preview-reference.json", "utf8"),
        ),
        browser = referenceClient(manifest);
      assert.throws(() => browser.act("accept"));
      assert.equal(browser.act("interpret").phase, "model-review");
      assert.equal(browser.act("reject").records.length, 0);
      assert.throws(() => browser.act("activate"));
      browser.reset("payment");
      for (const action of ["interpret", "evaluate", "activate"])
        browser.act(action);
      let state = browser.act("accept");
      assert.equal(state.records[0].fields.amount.verification, "reported");
      assert.equal(state.mode, "reference");
      assert.throws(() => browser.reset("invented"));
    },
  );
});

test("local HTTP playground binds loopback, rejects cross-site mutations and exposes no configuration", async (t) => {
  const playground = await startPlayground({ port: 0 });
  t.after(playground.close);
  const page = await fetch(playground.url),
    html = await page.text(),
    cookie = page.headers.get("set-cookie").split(";")[0];
  assert.ok(html.includes("Live local playground"));
  assert.ok(!html.includes("postgresql:"));
  assert.ok(
    page.headers
      .get("content-security-policy")
      .includes("frame-ancestors 'none'"),
  );
  let result = await fetch(playground.url + "/api/state");
  assert.equal(result.status, 401);
  result = await fetch(playground.url + "/api/state", { headers: { cookie } });
  assert.equal((await result.json()).phase, "ready");
  result = await fetch(playground.url + "/api/action", {
    method: "POST",
    headers: {
      cookie,
      origin: "https://unrelated.example",
      "content-type": "application/json",
      "x-ontave-playground": "1",
    },
    body: JSON.stringify({ action: "interpret" }),
  });
  assert.equal(result.status, 403);
  result = await fetch(playground.url + "/api/action", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "interpret" }),
  });
  assert.equal(result.status, 403);
  const headers = {
    cookie,
    origin: playground.url,
    "content-type": "application/json",
    "x-ontave-playground": "1",
  };
  result = await fetch(playground.url + "/api/action", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "accept" }),
  });
  assert.equal(result.status, 400);
  result = await fetch(playground.url + "/api/action", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "interpret", workspace: "forged" }),
  });
  assert.equal(result.status, 400);
  result = await fetch(playground.url + "/api/action", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "interpret" }),
  });
  assert.equal((await result.json()).phase, "model-review");
  result = await fetch(playground.url + "/api/reset", {
    method: "POST",
    headers,
    body: JSON.stringify({ scenario: "payment" }),
  });
  assert.equal((await result.json()).scenario.id, "payment");
});
