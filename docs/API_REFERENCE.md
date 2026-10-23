# Ontave development API

The package exposes a server runtime through `createOntave`. Every operation receives an opaque host context. The host's `authorize` callback resolves actor, workspace, capabilities and optional source policy; message text and browser JSON cannot supply grants.

## Runtime configuration

Supply a `Storage` and authorization callback. `model: ModelAdapter` is optional for ingest, read and review services. Workers, inference evaluations and generated ontology proposals require an explicit adapter; missing worker configuration fails before a job attempt is claimed. Authored proposals and non-inference operations do not require model credentials. `postgres` is imported separately from `ontave/postgres`; provider factories use separate `ontave/models/gemini`, `groq`, `mistral` or `openrouter` entry points. Deterministic adapters use `ontave/testing`. Construction/import performs no migration, inference or worker startup. Call `close` when the process finishes. Optional model configuration and `reviews.forJob` are alpha.5 candidate additions, not part of npm alpha.4.

`cursorSecret` should be a stable private secret of at least 32 characters when requests span processes. The development default is random per instance. `identifierRules` explicitly allow authority/kind combinations; names and unconfigured email addresses do not authorize automatic linking. `sourcePolicies` lists fields a specific trusted source may verify. A reviewer statement uses the separate `reviewer-attestation` policy.

The default metadata keys are `sourceEventTime`, `sourceTimezone`, `sourceReference`, `externalId`, `correctionOf` and `contentType`. A host may supply its own `metadataKeys` allowlist. Metadata is provenance, not authorization.

## Operations

| Operation                                | Input and behavior                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces.create(context, input)`      | `workspaceId`, `name`, `requestKey`, `seed: 'empty' \| 'people'`; explicit provisioning, no inference. A workspace-scoped provisioner cannot select another workspace                     |
| `ingest(context, input)`                 | `source`, `idempotencyKey`, `payload: {kind:'text',text} \| {kind:'json',value}`, optional metadata; atomically returns `evidence_id`, `job_id`, `state`                                  |
| `evidence.get(context, id, options?)`    | Optional `startByte`, `limitBytes`; returns source metadata, payload excerpt and explicit byte range/continuation                                                                         |
| `jobs.get/list`                          | Inspect scoped durable jobs; list is bounded to 100 newest jobs                                                                                                                           |
| `jobs.reprocess(context, input)`         | `evidenceId`, `requestKey`, `reason`; stages a new interpretation without changing accepted data                                                                                          |
| `worker.runOnce(context)`                | Claims at most one job in the authorized workspace; returns staged result, bounded failure, exhausted result or null                                                                      |
| `reviews.get(context, bundleId)`         | Inspect source-bound extraction, resolutions, pending dependencies, revision and hash                                                                                                     |
| `reviews.forJob(context, jobId)`         | One repeatable-read snapshot of the scoped job, current bundle (or null) and first bounded evidence excerpt; requires both read and review capabilities                                   |
| `reviews.resolveIdentity`                | Exact `bundleId`, `digest`, `mentionId`, compatible `entityId` or `'new'`, `requestKey`, `reason`; creates a new bundle/digest                                                            |
| `reviews.amend`                          | Exact bundle/digest, complete `extraction`, optional retractions, request key and reason; existing mention identities remain bound                                                        |
| `reviews.accept/reject`                  | Exact `bundleId`, `digest`, `requestKey`, `reason`; acceptance checks current dependencies and entity revisions atomically                                                                |
| `reviews.resolveConflict`                | `entityId`, `fieldId`, `expectedRevision`, selected current assertion ID or explicit null, `statement`, key and reason; stages a source selection, or records a still-unresolved conflict |
| `assertions.explain(context, entityId)`  | Inspect original assertions, evidence references, byte spans/JSON paths and retractions                                                                                                   |
| `assertions.correct/retract`             | Field assertion ID, expected entity revision, statement, key and reason; correction also supplies typed value; returns a staged bundle                                                    |
| `assertions.attest`                      | Entity/field, expected revision, typed value, statement, key/reason and optional verification; preserves separate authenticated evidence and still requires acceptance                    |
| `ontology.inspect/diff`                  | Read active definitions or a selected immutable candidate                                                                                                                                 |
| `ontology.propose`                       | Supporting `evidenceIds`, `requestKey`, `reason`; optional explicit additive `patch`. Omit patch to request model generation from current unresolved observations                         |
| `ontology.proposalStatus`                | Read state/result/error for a generated-proposal request key                                                                                                                              |
| `evaluations.registerSuite/evaluate/get` | Register a bounded immutable extract/contract/read suite, then evaluate a selected candidate and suite; publication needs a passing exact artifact                                        |
| `ontology.publish/reject`                | Candidate ID/hash, key/reason; publication also names exact evaluation ID/hash and checks the base head                                                                                   |
| `contracts.register/pull`                | Explicit selected `Definition` or contract ID; returns a pinned contract and source ontology lineage                                                                                      |
| `entities.find`                          | Exact contract ID/hash, concept, supported predicates/order, page limit/cursor and optional one-hop relationship IDs                                                                      |
| `generateContract(lock, directory)`      | Writes lock, `.d.ts`/`.d.mts` declarations and executable `.mjs` validators under an explicit directory; rejects symlinks and incomplete lineage                                          |

Mutation results return the next digest for review. Retrying the same key and exact input returns the earlier effect. Reusing a key with changed input conflicts. Acceptance never turns a reported event into a verified event.

`reviews.forJob` returns `{job: {id, state, evidenceId}, bundle, evidence}`. Evidence has the same shape and explicit byte-range metadata as `evidence.get`; inspect `range.hasMore` and paginate the source before reviewing large inputs. The returned snapshot neither resolves dependencies nor grants acceptance. Submit the current bundle ID/hash through a separate authorized review action. In an integration regression, the former job/bundle/evidence calls use three transactions; the combined snapshot uses one.

## Values and query dialect

Definitions use lowercase stable IDs beginning with a letter, followed by letters, digits or underscores. Scalars are text, safe integers, decimal strings, money objects, booleans, dates, offset-aware timestamps and enums. Decimal/money normalization removes redundant trailing zeros without floating-point arithmetic. Nullable and optional are separate properties. Timestamps require seconds, an explicit offset and at most six fractional digits; supported years are 1–9999.

Fields return discriminated `value`, `unknown`, `conflict` or `missing` envelopes. The value state includes verification and assertion IDs. A missing field must be optional; unknown/conflict do not become null or zero. A nullable declared value can explicitly contain null.

Queries are closed objects. Predicates are `eq`, `in`, `gt`, `gte`, `lt`, `lte`, `stateIs` and `verificationIn`; operators and field identifiers are allowlisted. Only usable value states match scalar predicates. Money range/sort is unsupported. Ordering supports one field plus entity ID as tie-breaker. State order is non-null value, null, missing, unknown, conflict. Each page is transaction-consistent; changes may affect later pages. Signed cursors bind scope, contract and query.

## Limits and errors

Defaults are 256 KiB payload, 16 KiB metadata, 250 bundle operations, 10 identity candidates, 45-second call deadline, 2 extraction calls, 3 worker attempts and a 90-second lease renewed at most every 20 seconds. Explicit lower limits are accepted; unknown limits or increases beyond the tested profile are rejected. Read pages default to 25 and cap at 100; links cap at 25 per relationship. Source excerpts cap at 8 KiB.

Model factories request at most 4,096 output tokens and reject refusals/truncation. Gemini preflights the complete request, including schema and instructions, with the provider token-count endpoint against at most 16,384 input tokens. Experimental Groq retains its byte guard. A preserved source can exceed the processing context: processing fails explicitly rather than truncating it.

`OntaveError` exposes `code`, safe `message` and `retryable`. Common codes include `INVALID_INPUT`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `STALE_BUNDLE`, `STALE_BASE`, `STALE_ONTOLOGY`, `UNRESOLVED_IDENTITY`, `UNRESOLVED_CONFLICT`, `VALIDATION_FAILED`, `UNSUPPORTED_EVOLUTION`, `CONTRACT_NOT_AVAILABLE`, `EVALUATION_INCOMPLETE`, `BUDGET_EXHAUSTED`, `MODEL_UNAVAILABLE`, `INVALID_MODEL_OUTPUT`, `LEASE_LOST`, `OPERATION_IN_PROGRESS` and `STORAGE_UNAVAILABLE`. CLI success exits 0; failures exit 1 with a safe JSON error on stderr.

Failed evaluations persist a non-passing artifact with available traces and usage. The thrown `OntaveError.details.evaluationId` identifies it for `evaluations.get`; the CLI exposes `evaluation get --id`.

## Alpha.2 evaluation and operations

`jobs.attempts(context, jobId)` requires read capability and returns append-only `started`, `completed`, `failed` and `lease_expired` events with fences and available usage. A killed process can leave an unfinished attempt with unknown usage. Late fenced responses retain accounting without replacing a current bundle.

`metrics.summary(context)` returns workspace-scoped aggregate counts and machine latency. See [measured user benefits](USER_BENEFITS.md); it is not an accuracy estimator or a human time-saving claim. The CLI exposes `ontave metrics --config …`.

Evaluation now supports three closed task kinds:

- `extract`: authorized evidence, expected normalized field claims, optional entity-name/source checks, identities, relationships and observations. Matches are one-to-one; duplicate claims cannot increase precision. Relationship endpoints can use a display name or selected field values. Explicit empty expectations test abstention.
- `contract`: a registered earlier contract must remain compatible on both sides.
- `read`: an explicit definition, at most 100 complete fixture records, a closed structured query and expected records/continuation or supported error. Parent and candidate run the same SQL implementation over the same immutable JSON fixture CTEs. No workspace entities, assertions or projections are written.

Suites cap at 40 tasks, 80 inference calls, ten minutes and 1 MiB encoded size. Budgets must cover both sides of every extraction task. Read fixtures require complete declared relationship endpoints and do not accept SQL or JavaScript. Passing evaluation still requires new capability and no candidate task failures. Reports retain per-side output, scores, hashes, usage and failed-attempt details. Expected text fields may declare up to 20 explicit `equivalentValues`; the suite hash binds them. They cannot relax non-text values, verification or evidence matching. Equivalence policy must be frozen before a trial. A changed policy requires a new trial/version, retaining earlier results.

`ontology.diff` includes reuse warnings from names, aliases, stable-ID labels, overlapping description vocabulary and shared field shapes, plus earlier rejected candidates with the same parent and definition. These bounded lexical and structural checks are review hints; they do not establish semantic equivalence or authorize reuse automatically. New concepts can declare up to 20 aliases. Aliases are trimmed, sorted and checked for normalized duplicates; changing aliases on an existing concept is unsupported.

New worker bundles record each identity resolution’s `basis`: the source evidence ID, configured authority/kind and normalization policy, matched entity IDs and any reuse of an earlier accepted interpretation of the same source. Name/email similarity without a configured identifier authority remains insufficient for an automatic link. Reviewed resolutions retain the explicit reviewer decision. Explicit new request keys and reasons are required to reconsider a rejected proposal.

`reviews.amend` can revise a waiting-ontology interpretation to dismiss an incorrect discovery observation while retaining the original evidence and interpretation. The new extraction must use approved definitions and existing mention identities. Remaining observations retain the ontology waiting state; dropping an observation never transfers an old acceptance to the changed digest. Relationship withdrawal/replacement uses reviewed amendment retractions bound to current entity revisions. `assertions.correct/retract` is field-only. Distinct sources retain separate relationship support, while one-hop reads deduplicate target IDs; replay cannot resurrect withdrawn support.

The experimental `ontave/models/mistral` and `ontave/models/openrouter` factories accept explicit `{apiKey, model}` and have no environment reads, automatic model fallback or implicit runtime startup. Their complete encoded request is limited to 15,360 bytes and output to 4,096 tokens; this byte guard is not provider-certified token accounting. OpenRouter requires parameter support and disables fallback routes. Actual route/model metadata and available usage are retained. The shared provider schema uses typed per-concept alternatives with closed fields. Date formats, safe integers and enums are constrained before generation; runtime validation remains authoritative. Existing IDs are limited to the authorized candidates of that concept, and identifiers require configured host rules. For text of at most 1,024 bytes, quotations bind the complete immutable source with occurrence zero. Longer text requires exact source quotes; JSON requires valid paths and values. These source anchors prevent invented quotations but do not prove that an interpretation is correct. Gemini retains provider token preflight. The trusted host supplies the list of fields permitted to be marked verified; source text cannot grant that permission.

Provider references: [Mistral custom structured output](https://docs.mistral.ai/studio/conversations/structured-output/custom), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), [Gemini structured output limits](https://ai.google.dev/gemini-api/docs/structured-output).

## Local developer playground

`ontave playground --install [--port 4320]` explicitly starts a loopback-only interactive example. It prepares a temporary PostgreSQL database and restricted runtime role, runs the public SDK with a fictional fixture adapter, and removes the temporary database on normal shutdown. If the optional `embedded-postgres` tooling is missing, `--install` permits a pinned tooling install in the temporary directory. Core import/install does not load or install that tooling. The playground supports only its two supplied fictional scenarios; use a configured server adapter for arbitrary messages.

The corresponding browser sandbox replays generated SDK reference runs. It is labelled separately from the local PostgreSQL runtime. The example’s authored evaluation expectations and explicit identity-confirmation action are teaching orchestration, not an automatic discovery or identity policy added to the core.

## Alpha.3 qualification changes

Required generated contract fields exclude the `missing` state; optional fields retain it. Runtime validators reject malformed or additional envelope properties with typed errors. Definition IDs reject reserved object-property names. All provider adapters bound response buffering at 2 MiB and redact interrupted-stream exceptions. Truncated or malformed responses retain available usage; interrupted responses record unknown usage and follow bounded retry policy. No partial output is salvaged.

Amendments revalidated after compatible ontology activation create a new digest bound to the current ontology ID/hash and original evidence, preserving the earlier bundle. Incompatible definitions return `STALE_ONTOLOGY` and require reprocessing and renewed review. Workers, evaluation and generated proposals enforce the 25-concept limit for custom adapters too. Workers/evaluation bound complete encoded source, definitions, authorized candidates and host policy context at 60,000 bytes before inference; adapters additionally apply their declared tokenizer/request limits. Nothing is silently sliced. `ontave ontology rollback` returns `UNSUPPORTED_EVOLUTION` and directs the operator to a reviewed forward correction.
