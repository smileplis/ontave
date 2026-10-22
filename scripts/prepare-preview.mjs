// Generate public fictional reference runs through the real SDK/PostgreSQL.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { PreviewSession } from "../dist/preview/session.js";
import { scenarios } from "../dist/preview/scenarios.js";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
const db = await disposablePostgres(),
  session = new PreviewSession(db.storage);
try {
  const result = {
    version: "0.1.0-alpha.2",
    kind: "recorded-sdk-fixtures",
    generatedAt: new Date().toISOString(),
    notice:
      "Fictional reference runs generated with the actual Ontave SDK and PostgreSQL. Browser exploration replays these runs; run ontave playground locally for live database operations.",
    scenarios: {},
  };
  for (const scenario of scenarios) {
    const states = [await session.reset(scenario.id)];
    for (const action of ["interpret", "evaluate", "activate", "accept"])
      states.push(await session.act(action));
    assert.equal(states[1].phase, "model-review");
    assert.equal(states[2].evaluation.passed, true);
    assert.equal(states[3].records.length, 0);
    assert.equal(states[4].records.length, 1);
    assert.equal(
      states[4].records[0].fields[scenario.field].verification,
      "reported",
    );
    assert.ok(states.every((s) => s.earlierContract.readable));
    await session.reset(scenario.id);
    await session.act("interpret");
    const rejectedModel = await session.act("reject");
    assert.equal(rejectedModel.records.length, 0);
    await session.reset(scenario.id);
    for (const action of ["interpret", "evaluate", "activate"])
      await session.act(action);
    const rejectedFacts = await session.act("reject");
    assert.equal(rejectedFacts.records.length, 0);
    result.scenarios[scenario.id] = { states, rejectedModel, rejectedFacts };
  }
  await mkdir("website/public", { recursive: true });
  await writeFile(
    "website/public/preview-reference.json",
    JSON.stringify(result) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: true,
      scenarios: scenarios.length,
      source: "actual SDK with disposable PostgreSQL",
      providerCalls: 0,
    }),
  );
} finally {
  await session.close();
  await db.stop();
}
