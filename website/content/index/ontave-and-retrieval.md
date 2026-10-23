Retrieving a paragraph and accepting a business fact solve different problems. An application may need both, but it should be clear which one a component provides.

Ontave is an evidence-to-reviewed-record framework for TypeScript servers. It preserves source material, stages interpretations and exposes accepted facts through typed database queries. Retrieval-augmented generation supplies relevant source context to a model while it generates an answer.

## Choose the boundary you need

| Application need | Useful starting point |
| --- | --- |
| Answer a question using a collection of documents | Search or retrieval-augmented generation |
| Validate a form whose schema is already known | Form validation and a conventional database |
| Turn changing operational messages into reviewable, source-linked records | Evaluate Ontave |
| Schedule tools and coordinate agent steps | An orchestration layer in your application |

These are architectural distinctions, not claims that one approach is always better.

## A retrieved claim is still a claim

Suppose a customer writes “I paid ₹50,000.” A retrieval system can find that message and cite it in an answer. An extraction pipeline can return an amount. Neither operation independently confirms the payment.

Ontave preserves the source and keeps acceptance separate from [verification](/docs/verification/). A reviewer can accept that the source reports a payment while the recorded value retains its reported status. Conflicting, unknown and missing information have [explicit field states](/docs/uncertainty/).

The point is to preserve the distinction as information moves from language into application state.

## Combine retrieval and accepted records

An assistant can retrieve documents for background context and query accepted operational records for current structured state. In that design, the host decides which questions need a model, which need a database read and which require a person.

Ontave's typed queries execute against persisted accepted records without invoking an LLM at read time. They do not provide unrestricted natural-language analytics or arbitrary SQL. The supported query dialect is bounded by the registered application contract.

## What you still build

Your server supplies authentication, workspace authorization, PostgreSQL operations, a model adapter and review policy. You build the application interface and any agent orchestration. Ontave does not currently supply a hosted service, browser runtime, MCP server or autonomous fact acceptance.

Start with the [fictional playground](/playground/) to understand the review boundary, then use your own reviewed data to evaluate the [developer preview](/docs/status/). The playground demonstrates SDK and database behavior, not arbitrary-document accuracy.
