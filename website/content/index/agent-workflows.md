A message can change what an application needs to remember. That does not mean an agent should be able to write anything it infers into a production database.

Ontave is an open-source TypeScript framework for preserving evidence, reviewing proposed facts and evolving an additive logical model. It sits between incoming information and the accepted records an application reads.

## Start with a source, not an action

Consider this fictional message to a solar installation team:

> “I've paid ₹50,000. Before installing the panels, Ramesh needs to inspect the roof.”

There are at least two different claims here: a reported payment and an inspection requirement. The original message is evidence for what the sender said. It does not establish that the money arrived, or that this Ramesh is a particular person already in the system.

In a configured Ontave server, ingestion preserves the source and queues durable work:

```ts
const receipt = await ontave.ingest(context, {
  source: "installation-messages",
  idempotencyKey: "message-014",
  payload: {
    kind: "text",
    text: "I've paid ₹50,000. Before installing the panels, Ramesh needs to inspect the roof.",
  },
});
```

This fragment assumes a migrated PostgreSQL database, a provisioned workspace, a model adapter and host authorization. The receipt identifies evidence and a job. It is not an accepted business record. Follow the [Node.js setup](/docs/node/) for the surrounding configuration.

## Give each decision a boundary

An authorized worker proposes an interpretation. If roof inspection is unfamiliar to the current model, an additive model proposal can be evaluated before activation. Ambiguous identity links wait for review. An authorized reviewer inspects the source-bound bundle before accepting facts.

Model activation and fact acceptance are separate decisions. Accepting the payment claim still leaves it **reported** unless an authorized verification source establishes more.

After acceptance, the application uses a [pinned contract and typed queries](/docs/queries/) to read persisted records. Those reads require no model call. Sending a reminder, scheduling an inspection or initiating a payment remains the host application's responsibility.

## When this fits

Consider Ontave when messages or documents introduce operational facts that need provenance, review and controlled model changes. A support workflow, installation coordinator or document intake service can use this boundary before taking action.

A fixed form with an established schema may only need validation and an ordinary database. A document question-answering system may primarily need retrieval. Ontave is not an agent orchestrator, a hosted database or an automatic application builder.

The current npm release is a developer preview. Live identity linking, discovery quality and independent semantic qualification remain open. Use [release status](/docs/status/) and your own reviewed examples when evaluating a workload.
