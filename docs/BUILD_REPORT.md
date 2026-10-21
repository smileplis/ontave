# Ontave public alpha verification

Version: `0.1.0-alpha.1`. Baseline: Node.js 24.22.0, PostgreSQL 18.4, TypeScript 7.0.2, macOS arm64. This report describes the development alpha; it does not certify the complete MVP or general extraction accuracy.

## Runtime and distribution

The deterministic suite has 22 passing tests. The real PostgreSQL suite has 25 passing scenarios across three top-level suites. These cover source preservation, durable receipt/review behavior, restricted roles/RLS, concurrent leases and stale writes, identity replay, typed reads, model activation and failed evaluation artifacts.

The clean package verifier builds a tarball, installs it outside the checkout, checks exports and CLI behavior, compiles declarations, and executes generated validators. Separate Node and Next.js consumers test the same archive. The Next.js checks deny unauthenticated/forged privileges and reject importing the server module into browser code.

Gemini now preflights the complete request with the provider tokenizer, including output schema and instructions, against at most 16,384 input tokens. Refusal/truncation retains available usage. Failed candidate evaluations persist a non-passing artifact retrievable by ID. NUL characters fail before PostgreSQL text/JSONB persistence.

## Recovery

A PostgreSQL operator exercise dumps a stopped fictional database and restores it to a second disposable instance. All 17 table-content hashes matched. Original evidence, accepted contract reads, waiting identity state, restricted-role scope and a clean migration ledger were verified. In-flight lease restoration remains a separate fault scenario.

## Website

The website builds 31 HTML pages, including 29 documentation pages. Its static verifier checks 1,317 internal references and search-index coverage. The landing story uses React, shadcn/ui components and GSAP ScrollTrigger; controls work without scroll choreography under reduced-motion preferences. No provider or database secret is used by the static website.

## Measurements and open gates

Synthetic runs at 100, 1,000 and 10,000 fictional records processed every record with zero recorded job failures and no provider calls. Local ordered-read p95 was approximately 3 ms, 25 ms and 975 ms in the latest profiled run. Later profiled query executions were much faster than the early bulk-load measurements; the cause of the latency variation remains under investigation, and the alpha does not promise an SLO. The read path batches projection fetching for each page.

The original 95% precision and 90% recall targets in each of three frozen live trials remain unmeasured. Rich read/identity/relationship evaluation tasks, complete independently reviewed labels, process crash/shutdown cases and the remaining acceptance matrix are still open. A successful fictional Groq flow is a smoke check, and Gemini development failures are retained as failures.

## Reproduction

Run the commands in the repository README. Detailed machine-readable artifacts are produced locally under ignored `artifacts/`; credentials and private research are excluded from source control and the npm file allowlist. Public GitHub release assets contain the package tarball and a checksum, not raw operational or research files.
