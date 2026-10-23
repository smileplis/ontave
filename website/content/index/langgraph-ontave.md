LangGraph and Ontave can sit in the same application while owning different responsibilities. LangGraph controls the agent's execution graph. Ontave preserves evidence, stages interpretations and governs the accepted operational records it manages.

This is an **integration architecture**, not a claim that Ontave ships a LangGraph adapter. The current Ontave package is a TypeScript server SDK. A Python graph would need an authenticated service boundary or another application-owned bridge; no Python SDK is implied here.

## Assign state to the component that owns it

| State or operation | Suggested owner |
| --- | --- |
| Agent messages, branch selection and execution checkpoints | Your LangGraph application and checkpoint backend |
| Preserved input and interpretation jobs | Ontave |
| Candidate ontology evaluation and activation | Ontave, with authorized host decisions |
| Inspection and acceptance of proposed facts | Your review interface using Ontave's scoped review API |
| Querying current accepted records | A host-authorized typed Ontave query |
| Sending a message or scheduling work | Your host application's action service |

The [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview) describes its stateful orchestration model. The ownership split above is an application design choice, not a built-in integration guarantee.

## Ingest once at a trusted boundary

An inbound message route should authenticate its caller, resolve the workspace and assign a stable external delivery key. It can then call `ontave.ingest` and retain the returned evidence and job IDs in graph state.

```ts
// An application-owned helper called by a graph node or ingestion route.
// ontave and context are configured trusted-server dependencies.
const receipt = await ontave.ingest(context, {
  source: "installation-inbox",
  idempotencyKey: externalMessageId,
  payload: { kind: "text", text: sourceText },
  metadata: { sourceReference: externalMessageId },
});

// Persist these references in the graph's own state/checkpoint.
const references = {
  evidenceId: receipt.evidence_id,
  jobId: receipt.job_id,
};
```

This fragment assumes a migrated database, a provisioned workspace and host authorization. It does not start an Ontave worker or accept a fact. Follow the [Node.js integration guide](/docs/node/) for setup.

Use a stable key for the same source delivery when a graph retries the node. Do not generate a new random key each time execution resumes. Keep a changed message revision distinct from an identical redelivery.

## Process and inspect job state explicitly

Run Ontave workers under their own authorized, supervised server context. A durable receipt means the source and job were stored. It does not mean interpretation is complete.

The orchestration layer can inspect `jobs.get` and route based on the actual state. A waiting model, identity or review dependency should remain a pending state in the host workflow. Avoid treating a successful tool response as proof that accepted records exist.

A generated model proposal may require evaluation and activation. Fact acceptance remains a separate operation after that. See [workers and recovery](/docs/workers/) and the [schema evolution guide](/index/schema-evolution/).

## Pause for review without granting the model review authority

LangGraph's [interrupt mechanism](https://docs.langchain.com/oss/javascript/langgraph/interrupts) can pause execution for human input. A resumed graph should use an authenticated host decision to call Ontave's review API against the exact inspected bundle and digest.

Do not accept a model-generated `approved: true` field as the reviewer's authorization. Persist references to the decision and distinguish a rejected proposal from an accepted one. If a dependency or digest changed, inspect the current proposal again.

## Read facts before performing an action

After acceptance, query through the registered Ontave contract. A graph can use those accepted records as tool data without another model call for the underlying read. Application code should still enforce verification requirements and action permissions.

An accepted inspection requirement does not schedule a visit automatically. A reported payment does not permit marking an invoice settled. Keep those checks in the host's business logic.

## Test the seam between the systems

Replay the same delivery after a simulated retry, restart a paused run and submit a decision against an outdated bundle. Confirm that an unauthorized workspace cannot be selected through graph input. Track both graph run references and Ontave job or bundle references during failures.

Ontave remains a [developer preview](/docs/status/), with independent semantic and live discovery/identity qualification open. Validate this architecture against a small real workload before treating it as a production integration. The [human-review guide](/index/human-in-the-loop-agents/) covers the approval boundary in more detail.
