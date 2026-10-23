An agent's conversation history is not automatically a reliable system of record. A remembered sentence may be a request, an unverified claim or an outdated interpretation. Before choosing an agent memory system, decide which kind of state the application is storing.

For an installation assistant, “the customer said they paid” and “the payment processor confirmed settlement” should not collapse into the same memory. That distinction affects what the application can responsibly do next.

## Separate four kinds of state

| State | What it answers | Example |
| --- | --- | --- |
| Conversation context | What are we discussing now? | The user asked about installation I-101 |
| Workflow state | Where did execution stop? | Waiting for an authorized reviewer |
| Retrieved context | Which source passages may help answer? | A paragraph from an installation agreement |
| Accepted operational records | What facts has this system committed, with what status? | A source-linked payment claim, still marked reported |

One storage system may implement several of these, but the meanings still differ. Naming the distinction makes retention, correction and access-control decisions easier to reason about.

## What an agent checkpoint gives you

A workflow checkpoint can preserve execution state so work can resume after interruption. It helps answer where the process was, which messages were in context and what should run next.

It does not independently establish that a customer's claim is true. Nor does storing a generated summary make it a reviewed business fact. LangGraph's [persistence and orchestration overview](https://docs.langchain.com/oss/javascript/langgraph/overview) describes execution capabilities; your application decides what business records those steps can affect.

## What retrieval gives you

An embedding index or search engine helps locate potentially relevant material. That is useful for answering questions from documents, finding similar cases and assembling context for a model.

Relevance is different from acceptance, verification and currentness. A highly similar message may describe another person. An old document may have been superseded. A retrieved invoice can support that a charge was requested without establishing that it was paid.

Keep source identifiers and event times with retrieved context. When the assistant needs operational state, use the application's record API rather than asking a model to reconstruct it from a memory summary.

## What a conventional database gives you

A well-designed application database can store authoritative records, transactions and history. If your schema is stable and your ingestion paths already enforce the required policies, that may be enough.

The extra work appears when unstructured inputs continually introduce new facts or concepts. Someone must decide how to retain sources, stage interpretations, resolve identities, review changes and expose a stable interface to application code. Those decisions exist whether you implement them yourself or evaluate a framework.

## How Ontave approaches accepted records

Ontave preserves text or JSON evidence and stages source-linked interpretations. Authorized review controls acceptance. Unfamiliar concepts can support an additive model proposal that is evaluated before activation. Applications query accepted records through pinned contracts without a model call at read time.

An accepted value can still be reported rather than verified. Unknown, missing and conflicting fields remain [explicit states](/docs/uncertainty/). That makes the record's limitations available to downstream code instead of hiding them in a conversational summary.

Ontave does not replace an orchestrator's checkpoint system or provide a universal vector-memory store. Its current [developer preview](/docs/status/) also has open semantic-quality gates. Evaluate the specific record workflow you need.

## A practical storage decision

For a read-only support assistant, begin with scoped retrieval and the existing customer database. For a resumable agent, add durable workflow state. For a message-driven operations app, decide whether incoming claims require review and model evolution before they become queryable records.

A useful design may combine all three. Keep access to each behind explicit host-controlled interfaces. When a source is corrected, ask which summaries, pending runs and accepted assertions need reconciliation. Avoid pretending that deleting one memory entry resolves every derived record.

Start with the [agent workflow example](/index/agent-workflows/) to follow one message through those boundaries, or the [framework comparison](/index/best-ai-agent-frameworks/) to choose the orchestration layer separately.
