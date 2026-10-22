# Ontave MVP qualification

**Unreleased `0.1.0-alpha.2`; npm publication blocked.** This report records measured successes and failures. Neither passing database tests nor a successful provider smoke check establishes the complete MVP's semantic accuracy.

## Deterministic behavior

The expanded tests cover preserved evidence, hostile and untyped input, workspace isolation, identity authority collisions and partial-name review, stale workers/approvals, staged corrections, typed reads, cursor scope, pure inspection, isolated evaluation and actual CLI workflows. Process tests kill a real worker and restart it; shutdown tests cover cooperative and hung provider calls. Activation fault injection proves that a failure during replay scheduling rolls back the new head and candidate state.

The backup/restore exercise compares all 18 table hashes across two disposable PostgreSQL 18 instances, preserves accepted and waiting state, and recovers an abandoned processing lease without publishing its pending facts. Clean tarball consumers exercise Node.js 24 and Next.js server routes, including browser-boundary and fictional credential canary checks.

The complete solar/rental database demonstrations use deterministic adapters and automated fixture decisions. Solar: 44 accepted bundles, six unresolved, 49 affected replays. Rental: ten accepted bundles, zero unresolved, ten replays. Earlier pinned Person/Organization contracts remain readable. No domain-specific runtime code or business DDL is added.

Exact fresh test counts, archive bindings and CI status are recorded in local `artifacts/release-readiness.json` when qualification finishes. They are not inferred from this prose.

## Completed live experiments

All 60 original fictional inputs are eligible in each trial. The maintainer labels contain 179 expected field assertions per trial (149 solar, 30 rental) and 107 relationship checks. The approved fixture definitions are supplied explicitly; these experiments test extraction rather than autonomous discovery. Labels are never sent to the provider.

Scoring uses one-to-one normalized concept/field/value/verification agreement and verbatim source containment. Under the frozen conservative policy, an invalid complete response yields no valid staged field claims: its proposals count as false positives and its expected claims remain misses. A malformed relationship quote can therefore invalidate otherwise correct fields. No human correction improves a raw score. Relationship and observation checks are reported separately.

| Model                                                   | Trial | Correct / proposed | Expected | Precision | Recall | Provider or validation failures |
| ------------------------------------------------------- | ----- | ------------------ | -------- | --------- | ------ | ------------------------------- |
| Gemini 3.1 Flash Lite                                   | 1     | 82 / 134           | 179      | 61.2%     | 45.8%  | 32                              |
| Gemini 3.1 Flash Lite                                   | 2     | 99 / 154           | 179      | 64.3%     | 55.3%  | 25                              |
| Gemini 3.1 Flash Lite                                   | 3     | 107 / 165          | 179      | 64.8%     | 59.8%  | 24                              |
| Ministral 8B 2512                                       | 1     | 97 / 151           | 179      | 64.2%     | 54.2%  | 18                              |
| Ministral 8B 2512                                       | 2     | 95 / 155           | 179      | 61.3%     | 53.1%  | 20                              |
| Ministral 8B 2512                                       | 3     | 86 / 157           | 179      | 54.8%     | 48.0%  | 23                              |
| Ministral 14B 2512, constrained v2                      | 1     | 161 / 180          | 179      | 89.4%     | 89.9%  | 2                               |
| Ministral 14B 2512, constrained v2                      | 2     | 167 / 180          | 179      | 92.8%     | 93.3%  | 1                               |
| Ministral 14B 2512, constrained v2                      | 3     | 163 / 181          | 179      | 90.1%     | 91.1%  | 2                               |
| Ministral 14B 2512, v3 explicit description equivalence | 1     | 172 / 176          | 179      | 97.7%     | 96.1%  | 1                               |
| Ministral 14B 2512, v3 explicit description equivalence | 2     | 174 / 178          | 179      | 97.8%     | 97.2%  | 1                               |
| Ministral 14B 2512, v3 explicit description equivalence | 3     | 172 / 176          | 179      | 97.7%     | 96.1%  | 1                               |

The Gemini, 8B and constrained-v2 configurations **failed** the 95% precision / 90% recall target. The separately frozen v3 configuration **passed the aggregate field targets in all three trials**. This is a development result on maintainer labels, not independent certification of the complete MVP. Gemini failures included 26 HTTP 503 responses, one transport interruption, 40 non-verbatim quotations and 14 unknown-field responses across the three trials. Mistral failures included invalid occurrence indices, unknown fields, malformed endpoints and unsupported dates.

The Mistral model also proposed unavailable IDs. These were raw proposals, not actual established-entity merges: the direct adapter experiment wrote no canonical data. The runtime separately rejects unavailable IDs. An earlier schema-compatibility experiment was aborted after repeated HTTP errors; a Mistral Small configuration stopped after a quota failure. Those incomplete experiments are retained and are not presented as accuracy measurements.

The constrained v2 experiment uses typed per-concept fields, authorized candidate ID enums, required fields for new concepts and complete-source citation anchors for text receipts of at most 1,024 bytes. Longer text still requires exact source quotes; JSON retains path/value validation. It removed the invented-ID proposals, but the exact wording policy counted “Schedule maintenance review” against gold “maintenance review” as a mismatch on all ten rental inputs in each trial. Invalid optional dates remained another failure mode.

The v3 experiment froze a narrow per-field equivalence for those two requested-action descriptions, plus provider schema date/number constraints, before collecting 180 fresh responses. This is a revised development policy after examining v2, not a rescore or an untouched held-out result. The original v2 scores remain unchanged. The original input set and 179-assertion denominator remain unchanged; every input is attempted once per trial without retry. Concurrency is two with a shared minimum request interval. The exact model is `ministral-14b-2512`.

All v3 trials had zero unavailable-ID proposals. Each had one rejected complete response: the model supplied year-zero `0000-01-01` for an unresolved “Friday.” Runtime validation rejected it, and all its expected fields remained misses. Other misses were abstentions on uncertain/conflicting person statements. No malformed output was silently salvaged or published.

Rental field precision/recall was 100% in each v3 trial. Solar precision was 97.26% / 97.30% / 97.26%, and recall was 95.30% / 96.64% / 95.30%. Relationship and observation expectations remain separately scored under their frozen stricter reference rules; the field result does not imply those components passed. These direct adapter trials write no canonical data and do not test established identity selection or autonomous ontology discovery.

Available usage is retained for every v3 response. Monetary cost is unavailable. The report’s `correctionsRequired` is a count of false-positive plus missed-assertion units (11 / 9 / 11), not measured human edits or time. Each trial returned 15 unresolved observations; those are model observations rather than independently validated discovery decisions.

The v3 frozen experiment is `2026-10-22T04-24-38.870Z-2f8f904a-529a-4b09-af9e-2ecb6fec1664`; v2 is `2026-10-22T04-01-35.680Z-95998fb6-1bbc-4b5b-a736-6fec9ea685e0`. Each retains the protocol, source snapshots, hashes, raw outputs and per-input scores in ignored local artifacts. Earlier incomplete runs are retained as incomplete; they are not treated as three completed 0%-accuracy trials.

## Benefits and practical limits

The deterministic benefit harness avoided 400 extraction calls across 500 deliveries of 100 distinct inputs, compared with extracting every delivery. One thousand accepted-data queries used zero model calls. All 100 accepted field assertions retained source references, and no records appeared before review. These operation counts do not establish human time saved or real-provider cost savings. [See the complete benefit method](USER_BENEFITS.md).

The guarded local load profile processed all 11,100 fictional records without a job failure. Ordered-read p95 was 0.95 / 1.37 / 8.27 ms at 100 / 1,000 / 10,000 records, with first reads separately reported. An earlier stale-statistics plan performed nearly 50 million join comparisons. The read path now discourages nested loops and disables JIT within its transaction; settings reset afterward. These numbers are a local synthetic baseline, not an SLO.

## Remaining qualification

Labels and semantic equivalences need independent review; human review time and manual-entry productivity remain unmeasured. Live established-identity linking and autonomous discovery are not demonstrated by the direct extraction trials. Acceptance coverage still distinguishes tested, partial and pending cases. The release guard remains closed until those requirements, the remaining partial acceptance cases, a fresh-developer walkthrough and source/archive/CI bindings pass. Current acceptance mapping is 81 tested, 40 partial and two measured cases; a passing test suite does not convert the partial cases to passed requirements.

Reproduction commands and bounded provider limits are in the README and API reference. Raw responses, per-input scores, protocols, hashes, available usage and failure history stay in ignored local artifacts; public documentation contains aggregate fictional results. No credentials, customer data or private research are included in the package.
