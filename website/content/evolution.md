## Start from an unresolved observation

When a source introduces an unknown concept, extraction preserves a source-backed observation and the bundle waits for ontology work. The model does not create an approved concept while processing the message.

The website's RoofInspection example is illustrative. Installation must already be present in that example's model; the Person/Organization quickstart does not preload it.

## Propose an additive candidate

```ts
const candidate = await ontave.ontology.propose(context, {
  evidenceIds: [evidenceId],
  requestKey: "roof-inspection-v1",
  reason: "Represent an inspection that precedes installation",
  patch: reviewedAdditiveDefinition,
});
```

The patch is a `Definition` containing proposed additions. Omit it to explicitly request proposal generation through a compatible model adapter. Gemini supports generation; experimental Groq currently supports extraction only.

Generation freezes the parent and selected unresolved observations, reserves a bounded request and records available model/usage metadata. Inspect `ontology.proposalStatus` before issuing a new key after a failed or abandoned request.

## Inspect and evaluate

Inspect the candidate diff with `ontology.diff`. Register an immutable bounded [evaluation suite](/docs/evaluation/) and compare parent and candidate against the same frozen evidence.

```ts
const evaluation = await ontave.evaluations.evaluate(context, {
  candidateId: candidate.candidateId,
  suiteId,
});
```

## Activate the exact artifact

```ts
await ontave.ontology.publish(context, {
  candidateId: candidate.candidateId,
  candidateHash: candidate.hash,
  evaluationId: evaluation.evaluationId,
  evaluationHash: evaluation.hash,
  requestKey: "activate-roof-inspection-v1",
  reason: "Reviewed the diff and passing evaluation",
});
```

Check the exact API input in the [reference](/docs/api/) for your installed version. Publication checks the current parent head, candidate hash, passing suite artifact and registered contracts. The active pointer and affected replay scheduling commit atomically.

## Review replayed facts separately

Activation makes a concept available. Reprocessing can now produce a new interpretation, which still needs identity resolution and fact-bundle review. Existing application contracts continue to select their previously registered interface until you explicitly adopt a new one.
