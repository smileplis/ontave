import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cases } from "../examples/adaptive-quotes/cases.mjs";
import {
  digest,
  frozenDefinition,
} from "../examples/adaptive-quotes/shared.mjs";
import { totalScores } from "../examples/adaptive-quotes/scoring.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("adaptation evidence binds all acquisitions, unchanged labels, original failures and normalized replay scores", async () => {
  const root = new URL("../benchmarks/adaptation-2026-10-23/", import.meta.url);
  const summary = JSON.parse(
    await readFile(new URL("results.json", root), "utf8"),
  );
  let attempts = 0;
  for (const [name, entry] of Object.entries(summary.acquisitions)) {
    const bytes = await readFile(
      new URL(`acquisition-${name}/predictions.json`, root),
    );
    assert.equal(sha(bytes), entry.predictionsSha256);
    const run = JSON.parse(bytes);
    attempts += run.results.length;
    assert.equal(run.protocol.casesHash, digest(cases));
    assert.equal(run.protocol.frozenDefinitionHash, digest(frozenDefinition));
    assert.equal(run.results.filter((r) => r.error).length, entry.errors);
    for (const [file, hash] of Object.entries(run.protocol.fileHashes)) {
      assert.equal(
        sha(
          await readFile(new URL(`acquisition-${name}/frozen/${file}`, root)),
        ),
        hash,
      );
    }
  }
  assert.equal(attempts, 99);
  for (const [name, entry] of Object.entries(summary.replays)) {
    const bytes = await readFile(new URL(`replay-${name}.json`, root));
    assert.equal(sha(bytes), entry.reportSha256);
    const report = JSON.parse(bytes);
    assert.equal(report.casesHash, digest(cases));
    for (const [arm, published] of Object.entries(entry.arms)) {
      assert.deepEqual(
        totalScores(report.results.map((r) => r.arms[arm].score)),
        published.quality,
      );
      assert.equal(published.oldQueriesUnchanged, true);
      assert.equal(published.manualReviewActions, 0);
    }
  }
  assert.equal(summary.replays["v1-original"].arms.ontave.quality.recall, 0);
  assert.equal(summary.replays["v2-original"].arms.ontave.quality.recall, 0);
  assert.equal(summary.replays["v3-original"].arms.ontave.quality.correct, 21);
  assert.equal(
    summary.replays["v3-normalized"].arms.ontave.quality.correct,
    37,
  );
  assert.equal(
    summary.replays["v3-normalized"].arms.flexible.quality.correct,
    37,
  );
  assert.equal(summary.productionQualified, false);
  assert.equal(summary.developerTimeSaved, null);
  assert.equal(summary.independentDevelopers, 0);
  assert.equal(
    sha(await readFile(new URL("initial-guard-failure.log", root))),
    summary.initialFailure.sanitizedLogSha256,
  );
});
