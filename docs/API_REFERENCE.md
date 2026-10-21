# Ontave development API

The package exposes a server runtime through `createOntave`. Every operation receives an opaque host context. The host's `authorize` callback resolves actor, workspace, capabilities and optional source policy; message text and browser JSON cannot supply grants.

## Runtime configuration

Supply a `Storage`, `ModelAdapter` and authorization callback. `postgres` is imported separately from `ontave/postgres`; provider factories use `ontave/models/gemini` or `ontave/models/groq`. Deterministic adapters use `ontave/testing`. Construction/import performs no migration, inference or worker startup. Call `close` when the process finishes.

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
| `reviews.resolveIdentity`                | Exact `bundleId`, `digest`, `mentionId`, compatible `entityId` or `'new'`, `requestKey`, `reason`; creates a new bundle/digest                                                            |
| `reviews.amend`                          | Exact bundle/digest, complete `extraction`, optional retractions, request key and reason; existing mention identities remain bound                                                        |
| `reviews.accept/reject`                  | Exact `bundleId`, `digest`, `requestKey`, `reason`; acceptance checks current dependencies and entity revisions atomically                                                                |
| `reviews.resolveConflict`                | `entityId`, `fieldId`, `expectedRevision`, selected current assertion ID or explicit null, `statement`, key and reason; stages a source selection, or records a still-unresolved conflict |
| `assertions.explain(context, entityId)`  | Inspect original assertions, evidence references, byte spans/JSON paths and retractions                                                                                                   |
| `assertions.correct/retract`             | Target assertion ID, expected entity revision, statement, key and reason; correction also supplies typed value; returns a staged bundle                                                   |
| `assertions.attest`                      | Entity/field, expected revision, typed value, statement, key/reason and optional verification; preserves separate authenticated evidence and still requires acceptance                    |
| `ontology.inspect/diff`                  | Read active definitions or a selected immutable candidate                                                                                                                                 |
| `ontology.propose`                       | Supporting `evidenceIds`, `requestKey`, `reason`; optional explicit additive `patch`. Omit patch to request model generation from current unresolved observations                         |
| `ontology.proposalStatus`                | Read state/result/error for a generated-proposal request key                                                                                                                              |
| `evaluations.registerSuite/evaluate/get` | Register a bounded immutable extract/contract suite, then evaluate a selected candidate and suite; publication needs a passing exact artifact                                             |
| `ontology.publish/reject`                | Candidate ID/hash, key/reason; publication also names exact evaluation ID/hash and checks the base head                                                                                   |
| `contracts.register/pull`                | Explicit selected `Definition` or contract ID; returns a pinned contract and source ontology lineage                                                                                      |
| `entities.find`                          | Exact contract ID/hash, concept, supported predicates/order, page limit/cursor and optional one-hop relationship IDs                                                                      |
| `generateContract(lock, directory)`      | Writes lock, `.d.ts`/`.d.mts` declarations and executable `.mjs` validators under an explicit directory; rejects symlinks and incomplete lineage                                          |

Mutation results return the next digest for review. Retrying the same key and exact input returns the earlier effect. Reusing a key with changed input conflicts. Acceptance never turns a reported event into a verified event.

## Values and query dialect

Definitions use lowercase stable IDs beginning with a letter, followed by letters, digits or underscores. Scalars are text, safe integers, decimal strings, money objects, booleans, dates, offset-aware timestamps and enums. Decimal/money normalization removes redundant trailing zeros without floating-point arithmetic. Nullable and optional are separate properties. Timestamps require seconds, an explicit offset and at most six fractional digits; supported years are 1–9999.

Fields return discriminated `value`, `unknown`, `conflict` or `missing` envelopes. The value state includes verification and assertion IDs. A missing field must be optional; unknown/conflict do not become null or zero. A nullable declared value can explicitly contain null.

Queries are closed objects. Predicates are `eq`, `in`, `gt`, `gte`, `lt`, `lte`, `stateIs` and `verificationIn`; operators and field identifiers are allowlisted. Only usable value states match scalar predicates. Money range/sort is unsupported. Ordering supports one field plus entity ID as tie-breaker. State order is non-null value, null, missing, unknown, conflict. Each page is transaction-consistent; changes may affect later pages. Signed cursors bind scope, contract and query.

## Limits and errors

Defaults are 256 KiB payload, 16 KiB metadata, 250 bundle operations, 10 identity candidates, 45-second call deadline, 2 extraction calls, 3 worker attempts and a 90-second lease renewed at most every 20 seconds. Explicit lower limits are accepted; unknown limits or increases beyond the tested profile are rejected. Read pages default to 25 and cap at 100; links cap at 25 per relationship. Source excerpts cap at 8 KiB.

Model factories request at most 4,096 output tokens and reject refusals/truncation. Gemini preflights the complete request, including schema and instructions, with the provider token-count endpoint against at most 16,384 input tokens. Experimental Groq retains its byte guard. A preserved source can exceed the processing context: processing fails explicitly rather than truncating it.

`OntaveError` exposes `code`, safe `message` and `retryable`. Common codes include `INVALID_INPUT`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `STALE_BUNDLE`, `STALE_BASE`, `STALE_ONTOLOGY`, `UNRESOLVED_IDENTITY`, `UNRESOLVED_CONFLICT`, `VALIDATION_FAILED`, `UNSUPPORTED_EVOLUTION`, `CONTRACT_NOT_AVAILABLE`, `EVALUATION_INCOMPLETE`, `BUDGET_EXHAUSTED`, `MODEL_UNAVAILABLE`, `INVALID_MODEL_OUTPUT`, `LEASE_LOST`, `OPERATION_IN_PROGRESS` and `STORAGE_UNAVAILABLE`. CLI success exits 0; failures exit 1 with a safe JSON error on stderr.

Failed evaluations persist a non-passing artifact with available traces and usage. The thrown `OntaveError.details.evaluationId` identifies it for `evaluations.get`; the CLI exposes `evaluation get --id`.
