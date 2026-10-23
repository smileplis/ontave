# Supplier quotations: Ontave and plain PostgreSQL

The example has a real PostgreSQL implementation in each arm, a shared neutral extractor, fictional sources, source-bound proposals and explicit review. Read the [benchmark method and measured results](../../docs/SUPPLIER_QUOTATION_BENCHMARK.md) before interpreting any score. The example is included in the alpha.5 developer preview.

## Run the paired comparison without model credentials

From this source checkout, using Node.js 24:

```sh
npm ci
npm run compare:quotes
```

This creates disposable PostgreSQL databases and verifies all 24 authored fixtures through both implementations. It is a correctness run, not live-model accuracy. It writes a separate report under ignored `artifacts/quotation-comparison/` and removes the databases on completion. The pinned embedded PostgreSQL tooling is a development dependency; core npm imports do not install or start it.

Replay the published live predictions without making model calls:

```sh
npm run compare:quotes -- --responses=benchmarks/quotation-2026-10-23/initial-predictions.json
npm run compare:quotes -- --responses=benchmarks/quotation-2026-10-23/followup-predictions.json
```

Both arms receive the exact same output for each case/trial. Frozen dataset hashes prevent silent rescoring against edited labels. Machine operation timings warm both pools and exclude acquisition latency; acquisition attempts, reported token use and failures are separate. Each invocation creates fresh database state. Keep earlier reports.

## Try the interactive review study

```sh
npm run verify:package
npm run example:quotes
```

Open the printed loopback URL. The two guided setup tasks install a frozen local candidate and a baseline into fresh consumer folders, then verify a real database operation. Six review tasks deliberately contain four source-grounded price errors. Inspect the proposed unit prices against the source, save corrections when appropriate, and accept, reject or hold. Correct source anchoring alone is not enough. This study makes no model calls and does not place purchases. Start/Pause track active elapsed time; keep credentials in the private generated configuration. Ctrl+C stops the server and removes the temporary database. Study files remain in ignored local artifacts. Automated controller tests use separate sessions marked `automated: true` and cannot count as participants.

This is an exploratory tool, not a validated human-factors instrument. Its setup is guided and uses pre-provisioned storage, schema and workspace. The first recorded participant was a project maintainer, not an independent first-time developer.

## Standalone package demonstration with your own dedicated PostgreSQL

Follow the [quickstart](../../docs/QUICKSTART.md) to migrate a **dedicated** PostgreSQL database with an admin connection and create a restricted, non-owner runtime role. Never use the admin connection as `ONTAVE_DATABASE_URL`. The example creates a fresh workspace per invocation, uses only the first fictional quotation and asks for explicit approval:

```sh
export ONTAVE_DATABASE_URL='postgresql://runtime-role:password@localhost/dedicated_database'
node node_modules/ontave/examples/supplier-quotes/run.mjs
```

This command is available after installing `ontave@0.1.0-alpha.5`. From the source checkout, run `npm run build` then `node examples/supplier-quotes/run.mjs` instead. No API key is required: this particular demonstration is explicitly fixture-backed. Entering anything other than `accept` leaves the proposal pending. No other code path auto-approves supplier data. The database retains this demo workspace, unlike the disposable comparison/study.

## Add an actual extraction provider

`provider.mjs` uses Gemini REST directly and imports no Ontave code. `domain.mjs` defines the neutral output and maps it to the SDK in the Ontave arm. The same validated output goes to `PlainQuotationStore` in the other arm. Host authorization uses trusted opaque credentials; source messages never grant capabilities.

For a new, explicit paid acquisition:

```sh
# Configure GEMINI_API_KEY and an explicit GEMINI_MODEL in a private env file.
npm run collect:quotes -- --live --env=/absolute/private/.env
# Optional new retry-policy experiment; all attempts remain visible:
npm run collect:quotes -- --live --retry-transient=2 --env=/absolute/private/.env
```

The default is three trials, no automatic retries and six-second request spacing. The protocol is frozen before calls. Bounds, source snapshots, response/schema hashes and per-attempt usage are retained; no output is selected using gold answers. Temporary network failures count as missing expected fields. The follow-up published here allowed retries but used none. Source/model changes need a separately identified run; do not overwrite the historical evidence.

## Application integration

```ts
const runtime = createOntave({ storage, authorize }); // ingest/read/review server
const receipt = await runtime.ingest(serverContext, {
  source: "supplier-mail",
  idempotencyKey: messageId,
  payload: { kind: "text", text: supplierQuotation },
});

// A separately configured worker, with the same database and a model adapter:
await workerRuntime.worker.runOnce(workerContext);

const view = await runtime.reviews.forJob(reviewerContext, receipt.job_id);
// Render source, proposed values, pending dependencies and the exact bundle hash.
// After an explicit authorized reviewer decision:
await runtime.reviews.accept(reviewerContext, {
  bundleId: view.bundle!.id,
  digest: view.bundle!.hash,
  requestKey: decisionId,
  reason: "Reviewer checked this supplier quotation against its source",
});
```

The application must check job state and pending dependencies before offering acceptance. Large sources are paginated through `evidence.get`; `forJob` only returns the first bounded 8 KiB excerpt and explicit continuation metadata. The complete wrapper, including authored schema provisioning and pinned contracts, is in `ontave-store.mjs`. Its fixture bootstrap evaluates only a minimal schema smoke check; replace that with an application-specific qualification suite rather than calling it general accuracy validation.

The plain comparator owns its DDL, queue, RLS, source validation, proposals, exact-hash decisions, immutable assertions and conflicts in `plain-postgres.mjs`. It contains no SDK import. Both arms keep reports as supplier claims, retain unknown concepts for review and refuse stale approvals. Exact source citations can still support the wrong interpretation; human or domain-specific semantic checks are required.

## External DocILE evaluator

`node scripts/evaluate-docile.mjs` reports the access requirement without inventing a score. With organizer-authorized data, the official Python evaluator installed and predictions produced for that task:

```sh
node scripts/evaluate-docile.mjs --dataset=/absolute/dataset --predictions=/absolute/predictions.json --manifest=/absolute/dataset-manifest.json --task=KILE --split=val --arm=ontave
```

Run both arms on the same split and geometry conventions; LIR additionally requires line-item IDs. The wrapper records prediction/manifest hashes and evaluator version. It does not download gated data or submit an official test result. Our textual quotation predictions lack page/bounding-box annotations and cannot be relabeled as official DocILE predictions.
