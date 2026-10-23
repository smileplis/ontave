import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { quotationCases } from "../examples/supplier-quotes/cases.mjs";
import { digest } from "../examples/supplier-quotes/domain.mjs";
import {
  aggregate,
  scoreFields,
} from "../examples/supplier-quotes/scoring.mjs";
test("public quotation evidence binds original predictions, frozen acquisition sources, unchanged labels and preserved failures", async () => {
  const root = new URL("../benchmarks/quotation-2026-10-23/", import.meta.url);
  const summary = JSON.parse(
    await readFile(new URL("results.json", root), "utf8"),
  );
  for (const name of ["initial", "followup"]) {
    const bytes = await readFile(new URL(`${name}-predictions.json`, root));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      summary[name].publicPredictionsSha256,
    );
    const run = JSON.parse(bytes);
    assert.equal(run.protocol.datasetHash, digest(quotationCases));
    for (const [file, hash] of Object.entries(run.protocol.fileHashes)) {
      const frozen = await readFile(new URL(`frozen-${name}/${file}`, root));
      assert.equal(createHash("sha256").update(frozen).digest("hex"), hash);
    }
    const rows = run.results
      .filter((r) => r.split === "holdout")
      .map((r) => {
        const c = quotationCases.find((c) => c.id === r.id);
        const s = scoreFields(r.output, c.expected, c.text);
        if (r.error) {
          s.documentExact = false;
          s.f1 = 0;
        }
        return s;
      });
    const actual = aggregate(rows),
      published = summary[name].heldout;
    for (const key of Object.keys(actual))
      assert.deepEqual(published[key], actual[key]);
  }
  assert.equal(summary.initial.availability.finalFailures, 5);
  assert.equal(summary.followup.availability.retriesUsed, 0);
  assert.equal(summary.external.docile.officialScore, null);
  assert.equal(summary.productionQualified, false);
});
