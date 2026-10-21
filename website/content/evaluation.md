## Register immutable checks

An evaluation suite is registered by hash with authorized evidence and contract references. It cannot run arbitrary host JavaScript, SQL or network tools.

```ts
const suite = await ontave.evaluations.registerSuite(context, {
  name: "Person regression and new inspection capability",
  maxCalls: 4,
  timeoutMs: 120000,
  tasks: [
    { id: "existing-interface", kind: "contract", contractId },
    {
      id: "new-inspection",
      kind: "extract",
      evidenceId,
      expected: [
        {
          conceptId: "roof_inspection",
          fieldId: "reference",
          value: "RI-014",
          verification: "reported",
        },
      ],
    },
  ],
});
```

This example assumes the supplied evidence actually contains the expected reference and the candidate defines the named field. Expected answers are evaluator inputs, never candidate-generation prompts.

## Compare the same evidence

Parent and candidate use frozen definitions and the same evidence records. Each side's extraction is validated against its own definition and exact source references. The report records parent/candidate/suite hashes, evidence hashes, available usage and output hashes.

The implemented exact extraction task requires every expected value and no unsupported extras. Contract tasks check compatibility. A passing overall comparison requires a new capability improvement and no failed tasks.

## Bounded work

A suite has at most 40 tasks, 80 inference calls and a 10-minute deadline; individual model deadlines also apply. Failures cannot authorize publication.

## Remaining release work

The alpha's evaluator does not yet implement isolated structured-read fixture tasks or complete identity/relationship semantic scoring. Exact extraction success does not replace those checks. Failed evaluations now persist non-passing artifacts. Inspect the ID in `OntaveError.details.evaluationId` with `evaluations.get(context, id)`. Richer fixture tasks remain open.

## Live quality is a different result

A deterministic suite verifies behavior. It does not measure a cloud model's accuracy. The handoff requires frozen, labeled live trials and separate raw precision/recall, identity, discovery and reviewer-burden results. Read [testing](/docs/testing/) and [release status](/docs/status/).
