A convincing agent demonstration can hide a brittle system. The model may answer one prompt well while guessing a missing record, repeating a side effect after a retry or accepting an unsupported payment claim.

Evaluate the task, the tools and the committed records separately. This makes it possible to identify whether a failure belongs to interpretation, authorization, orchestration or the data boundary.

## Write expected outcomes before running the model

For a small installation assistant, start with reviewed examples such as these:

| Case | Expected behavior |
| --- | --- |
| Known installation ID | Report the stored stage without inventing details |
| Missing installation ID | Say the record is absent or unknown |
| Customer says “I paid” | Preserve reported status without claiming independent verification |
| Two people share a name | Avoid automatic linking without the required authority |
| Same delivery arrives twice | Preserve the intended idempotent effect |
| Source contains instructions to override policy | Treat them as source data; preserve host permissions |
| Reviewer approves an outdated proposal | Reject the stale decision or require renewed review |
| A worker or graph process restarts | Recover through the documented retry/checkpoint path |

This is an example test plan, not a claim that a particular agent has passed it. Define the expected evidence, relationships and acceptable abstentions for your own domain before collecting results.

## Test deterministic tools without paying for inference

The [read-only TypeScript agent example](/index/build-ai-agent-typescript/) includes offline tests for known and absent records, malformed IDs and reported payment state. Such tests are cheap and useful, but they establish the lookup tool's behavior rather than live model judgment.

Add integration tests at the actual storage and authorization boundary. Exercise a cross-workspace request, duplicate delivery and stale review digest. Test a crash with the persistence configuration you will deploy, not only the in-memory implementation used in a demo.

## Score the model's decisions separately

Freeze the model configuration, prompt, source examples, expected outputs and scoring rules for a trial. Retain failures and incomplete runs. If the prompt or equivalence policy changes, give the next trial a separate identity.

For extraction, score unsupported proposed assertions as errors even if other fields are right. Report identity, relationship and unfamiliar-concept handling separately from field extraction. A good aggregate field score can hide a serious mistake in another component.

Keep an independently reviewed or held-out set when possible. A maintainer's own familiar examples are useful during development, but they are weaker evidence for general behavior than unseen cases with independent labels.

## Measure the cost of the whole workflow

Record model calls, available token usage, latency, retries, failed attempts and human review effort. Distinguish a provider's reported usage from missing usage. An interrupted request with no returned token count is not evidence of zero cost.

Use workload-relevant outcomes: how many inputs produced a useful accepted record, how often a reviewer amended a proposal and which errors reached the application. A lower call count can reflect duplicate suppression without demonstrating better semantic accuracy.

Ontave's published [synthetic benchmarks](/docs/benchmarks/) illustrate that distinction. They measure disclosed fixture operations and database behavior. They do not establish human time saved, arbitrary-message accuracy or general provider cost savings.

## Keep review quality visible

A review interface may appear successful because people click approve quickly. Check whether reviewers can find source support, identify the intended entity and explain what acceptance will change. Record rejection and amendment reasons.

Measure disagreements rather than silently resolving them in favor of the model. If a reviewer cannot decide because the source is ambiguous, the system should preserve that uncertainty instead of forcing an apparently complete record.

## Set a release decision for the workload you tested

A suitable release decision names the supported task, dataset limitations, remaining failure cases, operational requirements and rollback or correction procedure. Avoid extending a small trial into a claim about every agentic application.

Ontave's [release status](/docs/status/) explicitly keeps independent label review, live identity/discovery and other MVP qualification gates open. Its fictional playground demonstrates the governed SDK/database flow. Evaluate real sources and the complete host workflow before adopting the preview for a consequential operation.

Use the [framework comparison](/index/best-ai-agent-frameworks/) to select execution tools, then apply the same reviewed cases to each serious candidate. Comparable evidence is more useful than comparing the polish of unrelated demos.
