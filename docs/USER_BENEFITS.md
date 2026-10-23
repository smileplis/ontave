# Measured user benefits

These results use fictional deterministic inputs and real disposable PostgreSQL on a local Apple M4 Pro. They measure framework behavior. They do not measure general extraction accuracy, production response time or human productivity.

The separate [supplier quotation comparison](SUPPLIER_QUOTATION_BENCHMARK.md) adds shared live-model predictions and an exploratory timed walkthrough. Both implementations had the same raw accuracy; Ontave took longer in the one-maintainer guided install/review session. The concrete alpha.5 integration improvement is a source/proposal snapshot in one transaction instead of three and no model credentials on ingest/read/review services. The study does not establish population-level time savings. These additions are in the unpublished alpha.5 candidate; npm remains alpha.4.

| Benefit                                | Observed result                                                                       | Boundary                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Avoid repeated extraction work         | 100 extraction calls for 500 deliveries of 100 distinct inputs                        | Receipt idempotency avoided 400 calls: 80% fewer than a counterfactual that extracts every delivery. This is an operation-count comparison, not a billing study. |
| Read approved data without inference   | 1,000 structured reads, each returning 100 records, caused zero model calls           | Reads used a deterministic adapter and local database; provider availability was unnecessary.                                                                    |
| Keep evidence attached                 | 100 of 100 accepted field assertions retained source references                       | A valid reference is traceability, not proof that an interpretation is semantically correct.                                                                     |
| Review before application data changes | Zero records visible before acceptance; 100 acceptance decisions produced 100 records | Approvals were automated fixture checks. Human review time remains unmeasured.                                                                                   |
| Retain unresolved cases                | Solar flow accepted 44 bundles and retained six unresolved; rental accepted all ten   | These are governed deterministic demonstrations, not live discovery scores.                                                                                      |
| Recover interrupted work               | Real process-kill/restart and abandoned-job restore tests passed                      | Recovery preserved review boundaries; interrupted provider usage remains explicitly unknown.                                                                     |

The updated local load profile used four workers and 100 timed ordered reads per size. Read p95 was approximately **0.95 ms / 1.37 ms / 8.27 ms** at 100 / 1,000 / 10,000 records. First reads were reported separately: 2.88 / 1.59 / 8.93 ms. Receipt p95 was 0.83 / 0.93 / 1.65 ms. All 11,100 jobs completed without a processing failure. These short Person fixtures are a baseline, not a universal latency promise.

An earlier 10,000-record run exposed a plan that compared nearly 50 million entity/projection pairs while statistics were stale. The closed read path now discourages nested loops and disables JIT within its transaction, then lets PostgreSQL reset those settings. Diagnostic EXPLAIN calls are outside timed samples. Preserve the earlier failing measurement when comparing results.

## Measure your own workload

```sh
npm run measure:benefits
npm run measure:load
```

From an authorized server context:

```ts
const metrics = await ontave.metrics.summary(context);
const attempts = await ontave.jobs.attempts(context, jobId);
```

`metrics.summary` requires read capability and reports only its authorized workspace. It includes evidence/entity/assertion counts, waiting states, review actions, verification states, retained worker events, reported tokens and receipt-to-first-staging percentiles. Counts include retained history. Tokens with unknown usage are excluded from reported totals; totals are not a complete bill.

For a real user study, measure time from receipt to usable reviewed data, active reviewer seconds, corrections, identity clarifications and rejected proposals on the same tasks as a manual baseline. Report both quality and effort. The repository does not invent a percentage of human time saved from machine latency or automated approvals.
