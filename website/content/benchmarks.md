## What was measured

The local synthetic workload ingests fictional sources, drains jobs with four workers, automatically approves known deterministic fixtures and queries accepted records. It makes **zero provider calls**. Automated test review is not human review latency.

The three dataset sizes are 100, 1,000 and 10,000 distinct fictional records in separate workspaces. Payloads are short synthetic Person names. Reads request 25 records ordered by name; this is not a representative production corpus.

## Recorded environment

| Component          | Environment                             |
| ------------------ | --------------------------------------- |
| Host               | Apple M4 Pro, macOS arm64, 24 GB memory |
| Runtime            | Node.js 24.22.0                         |
| Database           | Disposable localhost PostgreSQL 18.4    |
| Worker concurrency | 4                                       |
| Pool maximum       | 8                                       |
| Read samples       | 40 per dataset, warm shared instance    |

## Results and query work

The latest profiled run processed every input with zero recorded job failures:

| Records | Receipt p95 | Ordered-read p95 |
| ------- | ----------- | ---------------- |
| 100     | 1.88 ms     | 2.98 ms          |
| 1,000   | 0.47 ms     | 24.80 ms         |
| 10,000  | 1.39 ms     | 974.52 ms        |

Later profiled ascending and descending SQL executions at 10,000 records took about 11–12 ms, while the earlier full-request samples produced a much higher p95. This variability remains an optimization investigation, not a resolved performance claim. The current read path batches projection fetches for a page.

These numbers describe that local synthetic run. They are not a production SLO, a model-inference latency, a distributed-load result or a general extraction-quality claim.

## Reproduce

```sh
npm run build
npm run measure:load
```

The script creates a disposable database, records timings and query plans under local `artifacts`, then stops the instance. Inspect receipt acknowledgement, staging, automated review and read latency separately. Receipt-to-staging includes queue delay and processing in the current harness.

## Quality is still open

A deterministic database benchmark cannot establish semantic accuracy. The required frozen live extraction trials, richer evaluator tasks and complete independently reviewed labels remain release gates. [See the full status](/docs/status/).
