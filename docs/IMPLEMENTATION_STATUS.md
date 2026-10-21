# Ontave implementation status

Ontave `0.1.0-alpha.1` is a development alpha with a working evidence, review, evolution and contract-read flow. It is not the completed release candidate described by the handoff. The implementation, examples, fixtures, tests and public documentation live in this repository.

## Verified behavior

The deterministic suite exercises canonical JSON, UTF-8 quotes and JSON Pointer references, strict value validation, decimal normalization, safe contract generation and mocked provider HTTP failures. Real PostgreSQL suites exercise atomic ingestion, row security under a restricted runtime role, authorization, leased workers, stale results, concurrent approvals, source verification rules, corrections, conflicts, identity replay, additive activation, affected replay, pinned current-data contracts, numeric reads, deadlines and failed-attempt history.

The packed artifact is tested outside this source tree. Its ESM imports, CLI, declarations and generated validators work without a provider credential. The separate Node example uses the installed tarball. The Next.js example builds the tarball into server routes, checks fictional secret canaries in browser assets, denies unauthenticated requests and rejects request-body privileges. Exact results and artifact hashes are in [the build report](BUILD_REPORT.md).

A fictional Groq extraction has completed the full database flow. Gemini has returned both HTTP 503 failures and a valid staged result that remained waiting for ontology review. These development smoke checks establish neither the handoff's extraction targets nor general discovery quality. The experiments preserve that distinction.

## Work package progress

| Package | Current result                                                                                                        | Remaining gate                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| WP00    | Decisions, source pin, fictional 50 solar and 10 rental inputs, initial labels and 20 task descriptions               | Complete independent labels, source/identity checks and frozen scoring policy; current holdout descriptions are not an executable release suite |
| WP01    | Compiled npm tarball and clean ESM, CLI, type and generation consumers                                                | CI execution in an actual repository and additional platform support                                                                            |
| WP02    | Restricted PostgreSQL storage, explicit checksummed migrations and authorized provisioning                            | Complete privilege/failure coverage and expanded restore/failure coverage                                                                       |
| WP03    | Atomic receipts, durable waiting states, leases, fencing, deadlines and failed-run history                            | Real process-kill/restart and shutdown fault matrix                                                                                             |
| WP04    | Guarded whole-bundle publication, amendment and rejection                                                             | Complete adversarial review and stale-digest cases                                                                                              |
| WP05    | Authority-scoped identifiers, identity decisions, source-bound replay and staged corrections/conflict resolution      | Full authority-collision, partial-name candidate and correction-reconciliation matrix                                                           |
| WP06    | Additive-only candidates and deterministic contract checks                                                            | Better synonym/reuse explanations and rejection deduplication policy                                                                            |
| WP07    | Registered contracts, source lineage, generated declarations/validators and structured current reads                  | Complete scalar, relationship, cursor and hostile-generation matrix                                                                             |
| WP08    | Explicit Gemini REST adapter and experimental Groq JSON-mode adapter                                                  | Reliable Gemini end-to-end result, frozen live quality trials and experimental Groq token accounting                                            |
| WP09    | Bounded model proposal requests, extraction/contract comparison, exact evaluation hashes and atomic activation/replay | Structured-read fixture tasks, identity/relationship scoring, complete evaluation attempt records and full solar/rental traces                  |
| WP10    | SDK, CLI and actual Node/Next.js examples                                                                             | Full CLI command/failure audit and fresh-developer walkthrough                                                                                  |
| WP11    | Local tests, clean consumers, deterministic load measurements and scoped secret/isolation checks                      | All outstanding acceptance cases, backup/restore and three successful frozen semantic trials                                                    |
| WP12    | Public alpha authorized; Apache 2.0 selected                                                                          | Registry authentication and complete MVP acceptance remain open                                                                                 |

## Current differences from the complete handoff

- Evaluation supports `extract` and `contract` tasks. It does not yet implement isolated structured-read fixtures, relationship/identity scoring or semantic equivalence mappings. Failed attempts now persist non-passing artifacts retrievable by evaluation ID. Exact task success is stricter than a partial-match average, but it cannot replace those missing checks.
- Gemini now counts the complete request with the provider tokenizer before inference against at most 16,384 input tokens. Experimental Groq still uses a conservative byte guard. Definitions above 25 concepts fail explicitly.
- A generated proposal reserves one call per request key. A failed or abandoned request needs an explicit new key after inspection through `ontology.proposalStatus`; there is no automatic proposal repair loop. Candidate generation is supported by the Gemini adapter; Groq currently supports extraction only.
- Failed extraction attempts retain available output/usage, or explicitly unknown usage. Complete provider usage on connection loss, refusals and shutdown is not always available.
- JSON evidence uses canonical JSON, RFC 6901 pointers and UTF-8 byte spans. Text evidence preserves the supplied text. Evidence inspection returns an explicitly ranged excerpt, up to 8 KiB; workers read the full preserved source within processing limits.
- Timestamp equality currently follows the preserved typed string representation; decimal and money values normalize numeric strings. Money supports equality, with range/sort rejected. Rich schema constraints, automatic established-entity merges and physical business DDL are outside this alpha.
- The public website and GitHub alpha distribution are being prepared. No managed database service, worker daemon, npm registry publication, managed backup or automatic operational rollback is supplied.

[Acceptance coverage](acceptance-coverage.json) lists every original acceptance ID. A passing local test is not a blanket claim that all 123 cases pass.

## Next implementation sequence

1. Complete the declarative evaluator's read-fixture, identity, relation and uncertainty checks, with frozen parent/candidate metadata and failure artifacts.
2. Complete provider token accounting and the remaining job/review/identity fault cases.
3. Finish the independently labeled solar and rental fixtures and executable holdout tasks before scored trials. Keep these labels out of candidate prompts.
4. Run the complete solar and rental demonstrations, then all three declared live quality trials. Record every outcome against the unchanged 95% precision and 90% recall thresholds.
5. Exercise PostgreSQL backup/restore, audit every acceptance case, and freeze a new release-candidate tarball.
