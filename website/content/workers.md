## Durable states

A receipt preserves evidence and a job in one transaction. `queued` and due `retry_scheduled` jobs are eligible for a scoped worker. `waiting_ontology`, `waiting_identity` and `waiting_review` require their named dependency and must not be treated as completed facts.

```ts
const result = await ontave.worker.runOnce(workerContext);
```

The worker claims at most one job in the authorized workspace. A null result means no eligible claim. Inspect a returned state and bundle rather than assuming a successful inference means publication.

## Leases and fences

The default lease is 90 seconds, renewed at most every 20 seconds. Claiming reserves bounded attempt/call work. Inference happens outside the transaction. Staging checks the owner, fence, lease and model version before committing.

If a process dies, evidence remains intact. Another appropriately scoped worker can reclaim after expiry. A late result from the old fence cannot overwrite the newer interpretation. Provider networking may repeat, so this is not an exactly-once inference guarantee.

## Bounded retries

Default limits permit two extraction calls per job and three worker attempts, with a 45-second model deadline. Retryable failures schedule bounded work; invalid output and exhausted budgets remain inspectable. A preserved payload can exceed model context and fail processing without losing the source.

## Shutdown and supervision

The CLI worker loop stops claiming on SIGINT/SIGTERM and allows up to ten seconds to drain. Unfinished leases remain recoverable. Use a supervisor that backs off on storage or configuration failures.

`jobs.reprocess` creates another interpretation of preserved evidence. It does not silently retract accepted assertions or reactivate previously retracted facts.

Real process-kill/restart and complete shutdown-fault coverage are still release checks; see [status](/docs/status/).

## Incoming alpha.2 accounting

Unreleased alpha.2 adds `jobs.attempts(context, jobId)` for started, completed, failed and expired-lease events. Model calls are reserved before networking, so a killed process still consumes its budget. Available returned usage is retained even when a late response is fenced. A process killed before returning can leave usage unknown; unknown usage is not a zero bill.

Real process tests cover restart, bounded CLI drain, a hung request, lost acknowledgements and repeated crashes. The existing public alpha.1 archive does not contain these new attempt events.
