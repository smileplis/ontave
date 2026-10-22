## What was measured

The local synthetic workload ingests fictional sources, drains jobs with four workers, automatically approves known deterministic fixtures and queries accepted records. It makes **zero provider calls**. Automated test review is not human review latency.

The three dataset sizes are 100, 1,000 and 10,000 distinct fictional records in separate workspaces. Payloads are short synthetic Person names. Reads request 25 records ordered by name; this is not a representative production corpus.

## Recorded environment

| Component          | Environment                                     |
| ------------------ | ----------------------------------------------- |
| Host               | Apple M4 Pro, macOS arm64, 24 GB memory         |
| Runtime            | Node.js 24.22.0                                 |
| Database           | Disposable localhost PostgreSQL 18.4            |
| Worker concurrency | 4                                               |
| Pool maximum       | 8                                               |
| Read samples       | 100 per dataset; first read reported separately |

## Results and query work

The latest profiled run processed every input with zero recorded job failures:

| Records | Receipt p95 | Ordered-read p95 | First read |
| ------- | ----------- | ---------------- | ---------- |
| 100     | 0.83 ms     | 0.95 ms          | 2.88 ms    |
| 1,000   | 0.93 ms     | 1.37 ms          | 1.59 ms    |
| 10,000  | 1.65 ms     | 8.27 ms          | 8.93 ms    |

These are measurements of alpha.2. SQL diagnostics run outside the timed samples. The first ordered read is separate from 100 subsequent reads alternating ascending and descending order.

An earlier stale-statistics plan performed nearly 50 million join comparisons. The shared read transaction now discourages nested loops and disables JIT for this closed query profile; those settings reset afterward. Earlier slow measurements remain retained. The improvement is specific to the disclosed local workload.

These numbers describe that local synthetic run. They are not a production SLO, a model-inference latency, a distributed-load result or a general extraction-quality claim.

## Reproduce

```sh
npm run build
npm run measure:load
```

The script creates a disposable database, records timings and query plans under local `artifacts`, then stops the instance. Inspect receipt acknowledgement, staging, automated review and read latency separately. Receipt-to-staging includes queue delay and processing in the current harness.

## Quality is still open

A deterministic database benchmark cannot establish semantic accuracy. Live trials are recorded separately, and the richer evaluator is implemented in alpha.2. Independent labels and full semantic qualification remain release gates. [See the full status](/docs/status/).

## Measured operation savings

A deterministic fixture test delivered 100 distinct sources five times each. Idempotent receipts required 100 extraction calls instead of the 500 calls in an extract-every-delivery counterfactual: 400 avoided calls, or 80% fewer for this duplicate-heavy workload.

One thousand queries over accepted records used zero model calls. All 100 accepted field assertions retained source references; zero records appeared before review. The harness recorded 100 acceptance actions.

These counts do not establish human time saved, actual provider cost savings or a general productivity percentage. Those require a timed user study and real provider billing. Workspace-scoped `metrics.summary(context)` in alpha.2 exposes counts, usage availability and machine latency to help measure real deployments.
