A human approval step is useful only when the person can see what will change, why it was proposed and which exact version they are approving. A generic “Allow this agent?” button leaves too much room between the decision and its effects.

For an operations agent, separate approval of a business fact from permission to perform an action. Accepting an inspection requirement is different from scheduling a contractor. Accepting a reported payment is different from confirming settlement.

## Put review at a specific boundary

A useful approval request identifies the proposed effect, the supporting source and the current dependency state. For example:

| Review item | What the person should see |
| --- | --- |
| Proposed fact | Installation I-101 requires a roof inspection |
| Evidence | The original message and the exact supporting passage |
| Identity | Which person and installation the proposal refers to |
| Uncertainty | Whether names, dates or relationships remain unresolved |
| Version | The digest or revision bound to the proposed change |
| Effect | Which accepted records will change if this is approved |

If a source changes, an identity is resolved differently or a dependency advances, the earlier decision may no longer apply. Show the changed proposal and request a decision against its current version.

## Make the approval survive a restart

An agent's execution pause needs durable state. A person may respond after a deployment, a worker crash or an expired browser session. Persist a reference to the pending operation rather than keeping a request open in memory.

LangGraph provides an interrupt-and-resume mechanism backed by checkpointing. Its [interrupt guide](https://docs.langchain.com/oss/javascript/langgraph/interrupts) explains the required execution setup and replay considerations. Treat that as an execution primitive; the application still owns reviewer authorization, the approval interface and business record semantics.

For a particular deployment, test pause, process termination, restart and resume. Include a rejection path and an expired or changed proposal. Keep irreversible external actions outside work that may be repeated unless those actions have their own idempotency protection.

## Bind the decision to the inspected proposal

Ontave's review API accepts an exact bundle and digest. In an already configured runtime, a host-authorized reviewer can inspect a bundle and accept the version they reviewed:

```ts
const bundle = await ontave.reviews.get(reviewerContext, bundleId);

// Present this exact bundle and evidence in your review interface first.
await ontave.reviews.accept(reviewerContext, {
  bundleId: bundle.id,
  digest: bundle.hash,
  requestKey: reviewRequestKey,
  reason: "Checked the proposed values and identity links against the source",
});
```

This is an API fragment, not an automatic-approval worker. The host must authenticate the reviewer, assign the appropriate workspace capability and submit a decision only after the person acts. Use a stable request key for retries of the same decision. A changed proposal requires renewed review.

See [review bundles](/docs/review/) for amendments, rejection and stale-dependency handling. Do not place a fact-acceptance tool in an agent loop simply to remove the review step.

## Keep three decisions separate

**Model activation** makes an evaluated concept available in the logical model. **Fact acceptance** commits an inspected interpretation. **Action authorization** permits a host application to do something with the accepted information.

For a roof inspection, those may happen at different times and involve different people. Ontave governs the first two within its data model; it does not schedule the appointment or implement the host's action permissions.

## Measure the human work

Track time to reach a decision, the number of amendments, rejection reasons and disagreement between reviewers. Count ambiguous identities and missing source support separately. A system that routes nearly everything to a person may preserve control while still creating too much work to adopt.

Ontave's [current preview](/docs/status/) does not establish a general reduction in review effort. Test your own workload, retain the failed cases and use the [agent evaluation checklist](/index/evaluating-ai-agents/) to separate correctness from a smooth demo.
