## Three independent results

**Integrity:** deterministic model responses plus real PostgreSQL test atomic receipts, RLS, review, concurrency, leases and history. **Distribution:** clean consumers test the packed artifact outside the source checkout. **Semantic quality:** real-model trials measure proposed assertions before a reviewer fixes them.

A passing result in one category does not establish the others.

## Run deterministic checks

```sh
npm ci
npm test
npm run test:integration
npm run verify:package
npm run verify:node
npm run verify:next
```

Integration tests use their own disposable PostgreSQL process and fictional data. They require local process/port permissions. Deterministic tests and mocked HTTP tests require no real model credential or paid call.

The clean Node consumer checks imports, CLI, declarations, generation and an actual database flow. The Next.js consumer checks server routes, authentication boundaries, browser secret canaries and rejection of client imports of server runtime code.

## Measure model quality separately

The original target is at least 95% raw proposed-assertion precision and 90% raw proposed-assertion recall in **each** of three frozen live trials. Those targets are not established results.

Keep expected answers out of proposal prompts. Freeze definitions, model/config, labels, evidence and scoring rules before trials. Count unsupported extras as false positives and unresolved expected facts in the recall denominator. Record refusal, truncation, identity errors, discovery distinctions, review burden and provider failures.

## Inspect evidence

The repository retains explicit acceptance coverage and build artifacts. Read [release status](/docs/status/) for remaining gaps and [benchmarks](/docs/benchmarks/) for database measurements. A single successful fictional live flow is a smoke check, not a precision/recall study.
