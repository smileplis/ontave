# Frozen quotation app: learning delivery commitments

This is a development milestone, not production or adoption qualification. New APIs are available in the alpha.5 developer preview. Public evidence lives in `benchmarks/adaptation-2026-10-23`; the runnable implementations are in `examples/adaptive-quotes`.

## Question

Can an application that already knows quotations and prices adopt a new delivery-schedule concept, store source-reported commitments and expose them through a generic related-record query, without manual review or changing its existing queries?

The initial model contains only `quotation` and `quote_line`. The app and initial definition are frozen before inference. After six authored quotation seeds, eleven sequential messages introduce delivery promises, synonyms, repeated quantities, a table, uncertainty, an unknown quotation, a disallowed source and an instruction injection. Six routine families contain thirteen expected commitment tuples per trial. Three repeated trials contain 33 events and 39 expected tuples. Seeds are explicitly authored setup, not learned data.

## Comparison

All three arms replay the **same acquired model plans**:

1. Ontave with bounded additive adoption and automatic fact acceptance.
2. A standalone LLM + PostgreSQL JSONB implementation, with matching source, identity, structural and additive checks. It imports no Ontave SDK and also supports new metadata without physical migrations.
3. Ontave's strict default without automatic adoption.

The comparison adapter translates the shared neutral plan into SDK extraction/proposal/replay operations. It does not measure the stock Gemini adapter’s end-to-end multi-call discovery workflow or establish that workflow’s inference cost.

The planner sees the current shadow model, trusted host policy, existing quotation identifiers and untrusted source text. It never sees gold answers or a predeclared delivery type. The shadow model advances through neutral checks, rather than either arm's outcomes. Concept IDs are namespaced by a generic rule. A deterministic reference bridge may expand an exact source-present authorized quotation key into a parent mention. No field value is supplied by that bridge.

The frozen application uses three old queries: quotation references, suppliers/currency, and line quantities/prices. A generic related-collection renderer queries newly registered typed records and links with provenance. This measures usable structured retrieval, not an independent natural-language agent-answer benchmark. Commitments are scoped to the source; no global cross-message shipment identity is claimed.

## Development result

The normalized v3 replay stored **37 of 39 expected commitments** in both automatic arms: precision 100%, recall 94.87%, F1 97.37%. Seventeen of eighteen routine events were exact. A provider HTTP 503 left two commitments missing. Both arms learned one delivery-schedule concept per trial, with three automatic publications and **zero manual adaptation review actions**.

All **99 frozen-query checks per arm** passed, 297 total across the three arms. Strict default acceptance produced zero delivery commitments. Each automatic arm left thirteen of 33 events pending or failed: twelve negative/unsupported events plus the provider outage. Three empty injection messages completed as no-ops; do not count those as useful extracted records. Overall routine usable events were 17/33 of all events, or 17/18 of eligible routine events.

The flexible comparator reached the same quality and had lower local processing overhead. Shared predictions cannot establish an extraction-accuracy advantage for Ontave. No independent developer setup or review-time study has been run on these new APIs. Developer time saved is unmeasured.

## Failures and changes retained

The first 33-call acquisition had six structural failures and did not reliably turn unfamiliar explicit facts into usable related records. Replay also exposed an unknown-parent identity guard defect: an absent quotation could be created as a new base record. Both implementations now require existing parents, with regression tests. The earlier partial failed replay log is retained with the development history.

The second 33-call acquisition clarified host bounds and discovery versus uncertainty. Twenty-one plans used direct quotation keys as relation endpoints, which the generic mention validator rejected. These raw plans and the zero-recall original replay remain available.

The third acquisition added the exact-reference bridge. It had fourteen repeated-definition validation failures and one provider outage. Its original replay stored 21/39 expected commitments in each automatic arm and is reported separately. A **post-acquisition development ablation** reuses a current concept only when the same ID, matching name and field-type shape already exist; it retains current semantics and validates claims against the current definition. It does not merge different IDs or accept changed meanings. This produced the 37/39 result without more inference calls.

All 99 paid attempts across the three acquisition revisions are retained. Cases, expected tuples and semantic aliases were not changed to fit outputs. The successful result uses previously exposed cases and a normalization change chosen after failures; it is not a fresh end-to-end holdout result. There were no inference retries within an acquisition. The third acquisition itself is a development rerun, not a retry-free clean-room validation claim.

## What is implemented

`additivePolicy` defines trusted source and extension limits. `ontology.publishByPolicy` checks additive scope, allowed relationship targets, existing contracts and parent freshness, then activates/replays atomically. Its authorization explicitly records `semanticAccuracyQualified: false`; it never fabricates a passing semantic evaluation.

`reviews.acceptByPolicy` requires the current bundle digest, accepted identity scope, eligible source and reported claims. `advanceAutomatically` performs a bounded number of transitions and leaves exceptions pending. Strict review/evaluation defaults remain available. Neither source text nor model confidence can select or enlarge the policy. Accepted payment claims still do not verify payment.

`openOntave` and `ontave dev --install` remove hand-written local database setup and provide persistent local PostgreSQL plus a ready Studio. A clean installed-package test checks provisioning, review, shutdown, data retention and cached restart. Automated elapsed time is reported separately from human effort.

## What would prove developer need

The technical loop now works on this narrow development task. Need is still a hypothesis. Next, give independently authored, unseen requirement changes to external developers using Ontave and a capable flexible baseline. Hold models, source inputs, outcome tests and safety boundaries constant. Measure correct usable adaptation, preserved old behavior, developer minutes, exception minutes, code changes, provider cost and recovery behavior. Include failed setup and abandoned tasks. Do not count generated code lines as human effort saved.

Proceed to a wider release only if Ontave reduces total integration/maintenance effort or improves reliable adaptation enough to justify its extra runtime machinery. A baseline that is simpler, faster and equally reliable is a legitimate negative result. External business-document benchmarks can qualify extraction components, but cannot by themselves prove application adaptation or market demand.

This small synthetic English set has maintainer labels and correlated repeats. Independent annotations, multilingual/source variation, real schema drift, multiple products, global identity, longer-running concurrency/load and externally maintained integrations remain open. No hosted service or production qualification is claimed.
