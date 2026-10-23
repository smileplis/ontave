# Ontave implementation status

**Developer preview `0.1.0-alpha.5`** is prepared for npm distribution. Its packaged [release status](https://github.com/smileplis/ontave/blob/v0.1.0-alpha.5/docs/RELEASE_STATUS.json) records the open full-MVP qualification gates. Earlier GitHub alpha archives remain immutable. npm preview distribution has a separate explicit guard; it does not certify the full MVP.

Alpha.5 includes: a runnable supplier-quotation example, a standalone LLM + PostgreSQL comparator, optional models on non-inference services and one-transaction review/source snapshots. The [comparison report](SUPPLIER_QUOTATION_BENCHMARK.md) preserves the initial provider failures, the follow-up on reused cases and a completed one-maintainer walkthrough. This does not close independent qualification gates.

## Developer-preview entry points

- A guided browser sandbox replays fictional reference runs generated with the actual SDK and PostgreSQL.
- `ontave playground --install` runs the interactive example against a real temporary local PostgreSQL database, with a restricted role and explicit fictional fixture adapter. No Docker or provider key is needed.
- Model evaluation and identity/fact review remain real SDK operations. New accepted concepts render through an adopted contract without rebuilding the generic playground. Custom application interfaces still require development.
- Explicit setup downloads optional tooling only when requested. Core package import/install performs no database provisioning or playground installation.

## Implemented and exercised

- Immutable text/JSON evidence, request-envelope idempotency, explicit provisioning and host authorization with restricted PostgreSQL roles and forced row security.
- Durable fenced workers, bounded attempts, independent model deadlines, append-only attempt accounting, real process-kill/restart, cooperative shutdown and ten-second hung-call drain.
- Whole-bundle review, exact digest/revision checks, partial-name candidate review, authority-scoped identifiers, amendments, rejection, corrections, conflict resolution and replay respecting retractions.
- Additive ontology proposals, name/alias/description/structural reuse and rejection hints, parent/candidate evaluation, exact publication artifacts and atomic activation/replay scheduling with fault injection.
- Closed extraction, identity, relationship, observation, contract and isolated structured-read evaluation. Immutable JSON fixtures use the same SQL read implementation without canonical writes.
- Pinned current-data contracts, generated TypeScript/runtime validators, typed scalar predicates, state/verification filters, ordered signed cursors and bounded one-hop links.
- Actual CLI workflow and clean packed Node/Next.js consumers. Server/client import and fictional secret-canary checks are exercised.
- Operator backup/restore across two disposable PostgreSQL instances, including an abandoned processing job, role isolation and all 18 table hashes.
- Workspace-scoped operational metrics, deterministic user-benefit measurements and 100/1,000/10,000-record load measurements with query diagnostics outside timing samples.

The solar and rental governance demonstrations use the same generic runtime and deterministic fictional adapter. Solar accepted 44 of 50 bundles and retained six unresolved; rental accepted ten. These are database lifecycle tests, not live discovery accuracy results.

## Accuracy qualification

The expanded maintainer fixture set includes all 60 original inputs, 179 expected field assertions and 107 relationships. Twenty read tasks are executable. Labels remain explicitly **not independently reviewed**, and the regression tasks are not an independently authored held-out set.

Three frozen `gemini-3.1-flash-lite` trials and three `ministral-8b-2512` trials failed the unchanged 95% precision / 90% recall targets. All completed, failed and earlier aborted attempts remain retained. See [the quality report](QUALITY_REPORT.md) for the complete matrix and method. The constrained 14B v2 profile also failed. The separately frozen v3 `ministral-14b-2512` profile passed all three aggregate field targets: precision 97.7–97.8%, recall 96.1–97.2%. Its explicit text-equivalence policy was revised after v2, so it is a development result on maintainer labels. Earlier failures are unchanged. Other semantic components remain unqualified.

Provider factories now constrain short text quotes to an immutable source anchor and restrict IDs to authorized candidate enums. Concept fields remain closed and typed. Gemini preflights complete input with the provider tokenizer; Mistral, OpenRouter and Groq are experimental bounded alternatives. Byte guards are not provider-certified token accounting. An explicit adapter/model is required for inference; alpha.5 permits ingest/read/review services to omit it.

## Remaining release gates

1. Independently review labels, source meaning, identity expectations and held-out task boundaries. Candidate-generation prompts must not receive answer keys.
2. Qualify live established-identity linking, observation/discovery behavior and end-to-end reviewed publication independently of the passing raw field trials. Keep all unresolved cases, errors and usage in the record.
3. Finish the remaining 5 partial acceptance cases. Current development mapping has 116 tested and two measured cases; partial coverage is not a pass.
4. Bind successful deterministic, consumer, recovery and CI evidence to the final source revision and package archive. `npm run verify:release` refuses missing, stale or non-passing evidence.
5. Perform a fresh-developer walkthrough before full MVP qualification. Alpha distribution is separately labelled and validated; it does not complete this requirement.

[Acceptance coverage](acceptance-coverage.json) preserves each original acceptance ID. [User benefits](USER_BENEFITS.md) separates operation counts and machine latency from unmeasured human productivity. Private research and credentials remain excluded from source control and package contents.


## Alpha.5 additions

Persistent local database provisioning, loopback Studio, bounded automatic additive publication/acceptance and a frozen quotation adaptation comparator are implemented. The [milestone report](ADAPTATION_MILESTONE.md) separates the successful development ablation from earlier failed acquisitions. Independent semantic qualification, external developer effort measurements and hosted operations remain open. Earlier published alpha archives remain immutable.
