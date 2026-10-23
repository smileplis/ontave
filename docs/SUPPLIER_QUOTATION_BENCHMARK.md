# Supplier quotation comparison

This is a reproducible development benchmark of a quotation application built with Ontave and with a standalone LLM + PostgreSQL implementation. It is not a production certification or an official external benchmark score. The npm release remains `0.1.0-alpha.4`; these integration changes target the unpublished `0.1.0-alpha.5` candidate.

## What is compared

Both arms receive **the same acquired prediction** for each document/trial. They share the source text, neutral extraction schema, domain checks, model instructions, authorization grants and review decisions. The plain implementation imports no Ontave code. It includes its own forced PostgreSQL row security, evidence retention, queue leases/fences, source-bound proposals, exact-hash approval, immutable assertions, identity decisions and conflict-preserving reads. Comparing against an unguarded direct SQL write would exaggerate the framework's benefit.

Ontave supplies those controls through its SDK, together with versioned ontology publication, evaluation and pinned contracts. The plain application's schema is authored SQL; Ontave's schema is also explicitly authored, then published using a tiny fixture evaluation. That bootstrap is setup, not evidence of autonomous discovery accuracy. The plain comparator is example code, not a second fully qualified framework. In particular, it does not implement every Ontave recovery/audit/evolution feature; its extraction failures terminate that job. Acquisition retries are shared upstream and are not a comparison of the two worker retry implementations.

## Frozen acquisition and scoring

The original, fictional English text dataset contains eight development families and sixteen held-out supplier/layout/scenario families. Suppliers and families do not cross the split. Labels were written by the maintainer before model calls. Cases cover currencies, multiple lines, equal prices on distinct SKUs, missing fields, list versus net unit prices, line totals, ambiguous dates, non-integral lead times, OCR-like ambiguity, a non-quotation, withdrawn terms and source instructions that attempt to redirect extraction. This is a small text suite; it does not measure PDF layout or OCR.

The configured model was `gemini-3.1-flash-lite`, temperature zero, three trials over all 24 documents. Calls preflight the complete request with the provider's token-count endpoint, cap input at 16,384 tokens and output at 4,096 tokens, impose a 45-second deadline and cap response buffering at 2 MiB. Two earlier acquisitions stopped on their first HTTP 400 because the structured-output schema was too complex. Those failed acquisitions remain in private artifacts; the wire schema was simplified without changing labels or primary scoring.

Primary field matches are one-to-one tuples of record type, quotation reference/SKU, field and normalized value, with an exact source quote supporting the claimed scalar. Extra or duplicate fields are false positives. Missing fields and unavailable documents retain their expected fields as misses. Money requires explicit currency and decimal normalization. A correct empty document counts toward exact-document accuracy, while undefined precision is reported as null. Observations outside the model are retained and can block the entire bundle; they are not silently removed to improve accepted-data coverage. Observation correctness is not a separately qualified metric here.

Results distinguish raw extraction from data actually accepted after the scripted review policy. Scripted review accepts unchanged valid proposals; it does not repair them using gold answers. Source references establish traceability, not semantic truth. Supplier assertions remain `reported` after acceptance.

## Results, 23 October 2026

The [machine-readable results](../benchmarks/quotation-2026-10-23/results.json) include per-field, trial and family breakdowns, token accounting, hashes and local timing distributions. Normalized predictions and all acquisition attempts are published alongside them for replay. Full provider transport envelopes and private study configuration remain local.

| Held-out raw extraction, shared by both arms | Initial zero-retry run | Follow-up on reused cases |
| -------------------------------------------- | ---------------------: | ------------------------: |
| Document observations                        |   48 (16 families × 3) |      48 (16 families × 3) |
| Correct / predicted / expected fields        |        310 / 310 / 354 |           354 / 354 / 354 |
| Precision                                    |                   100% |                      100% |
| Recall                                       |                 87.57% |                      100% |
| Micro F1                                     |                 93.37% |                      100% |
| Exact documents                              |                 89.58% |                      100% |
| Provider successes across all 72 tasks       |                67 / 72 |                   72 / 72 |
| Inference attempts / retries actually used   |                 72 / 0 |                    72 / 0 |

The first run missed its predeclared 90% recall target because five held-out documents failed with temporary provider/transport errors. The follow-up allowed two transient retries but **needed none**. It demonstrates neither a causal retry benefit nor generalization to a fresh holdout. No instruction or gold-answer selection was used to choose successful outputs.

The initial 95% family-cluster bootstrap F1 interval was 88.37–97.91%. The follow-up's empirical bootstrap degenerates to 100–100%; that is not evidence of universal accuracy. All three trials were exact in 16 distinct families; a descriptive Wilson interval for that binary family result is **80.64–100%**. Trials within a family are correlated. These intervals do not account for label bias, dataset selection or production distribution shift. No significance or framework accuracy-uplift claim is made.

Both arms had identical accepted-data results. Initial accepted recall was 61.58%; follow-up accepted recall was **72.03%**, with 255/255/354 correct/predicted/expected fields and 68.75% exact documents. In the follow-up, 30 held-out observations completed and 18 remained `waiting_ontology`. This is the cost of holding unknown terms for explicit model/review work. It is not appropriate to advertise raw 100% as fully usable application coverage. Neither arm exposed records before approval in the paired replay.

## Human setup and review

One project maintainer completed two guided installs and six source-review tasks. Storage, schemas and workspaces were pre-provisioned; the candidate archive and baseline files were frozen before the session. Both installs used a fresh consumer/cache and needed no model key. This measures a guided local install, not the time to implement an application or provision production infrastructure. Ontave was first, so learning/order effects are unresolved.

| Observed measure                        | Plain LLM + PostgreSQL |   Ontave |
| --------------------------------------- | ---------------------: | -------: |
| Guided install active elapsed time      |                37.92 s | 146.40 s |
| Three review tasks, active elapsed time |                80.63 s | 114.35 s |
| Save-correction actions                 |                      3 |        3 |
| Deliberately flawed proposals kept out  |                  2 / 2 |    2 / 2 |
| Clean proposals accepted                |                  1 / 1 |    1 / 1 |

Four proposals deliberately replaced a unit price with a quantity from the same source. This creates a source-grounded semantic error, not an observed model error rate. The participant rejected three and held one; the two clean proposals were accepted. All 12 accepted fields across the two arms matched the labels. With held/rejected documents included, coverage was 6/28 fields in the plain tasks and 6/25 in the Ontave tasks. These different small task sets cannot establish a comparative accuracy or time-saving percentage. Active elapsed time is pause-aware, not a direct measurement of cognitive effort.

The participant's feedback was that prices were wrong in places. These were the predeclared perturbations. This reinforces the need to show source and proposed values together and retain an explicit acceptance step. Ontave was slower in this session; there is no measured human productivity win.

## Integration changes resulting from the comparison

- `createOntave` can omit `model` on ingest/read/review services. Inference still requires it; a missing worker adapter fails before consuming a queued attempt. The CLI scaffold and Next server example follow this behavior.
- `reviews.forJob(context, jobId)` returns the scoped job, current proposal and bounded source excerpt in one repeatable-read transaction. A real PostgreSQL regression checks equivalence with the former three-call flow: **three transactions become one**. Acceptance still names the exact digest and is a separate action.
- The package includes a standalone quotation demonstration with explicit approval, shared neutral extractor and complete plain PostgreSQL comparator. Hosted authorization, persistent workers and provider configuration remain application responsibilities.

Local machine timings are reported separately from human effort. Both pools are warmed before per-operation timings, while database startup, migrations and schema bootstrap are separate. Ontave performs extra schema publication, contract and provenance work. Small local latency differences do not establish production SLOs, dollar savings or developer implementation time. Code size is not used as a productivity proxy.

## Recognized reference methods and pending external qualification

[DocILE](https://docile.rossum.ai/) is the relevant established business-document reference: key information localization/extraction and line-item recognition, with its [official evaluator](https://github.com/rossumai/docile). Its [paper](https://arxiv.org/abs/2302.05658) describes a materially different document/layout task. This example borrows explicit field and line-item matching discipline; its scores are **not DocILE scores**. The organizer-approved dataset is unavailable in this workspace. `scripts/evaluate-docile.mjs` validates prediction geometry and invokes the installed official evaluator once authorized data is supplied. Official KILE/LIR validation results and any organizer test submission remain pending.

[HELM](https://crfm.stanford.edu/2022/11/17/helm.html) motivates reporting quality, availability, efficiency and limitations together under standardized conditions. [Dror et al., ACL 2018](https://aclanthology.org/P18-1128/) informs the distinction between paired observations and unsupported statistical conclusions. [NIST's Wilson interval reference](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm) supports the descriptive binary intervals. The [NIST AI RMF](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) motivates documented evaluation scope and uncertainty; this is not a claim of NIST compliance or certification.

Before a broad production claim, obtain independent source-label review and new independently authored holdouts, run the external evaluator on authorized data, test real PDF/OCR and supplier integrations if those are advertised, complete the remaining framework acceptance and live discovery/identity/publication gates, and validate representative deployment load, recovery and access control. Current results support a bounded developer preview.

## Reproduce

See the [runnable example instructions](../examples/supplier-quotes/README.md). Public cached replays require no paid calls. Re-collection is explicit, uses fictional text and records every attempt. Do not retune labels or thresholds on the held-out results; freeze a new protocol and retain the earlier scores when changes are needed.
