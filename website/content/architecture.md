## One package inside your service

Your application owns its HTTP interface, authentication and database resources. Ontave runs in the server process and stores its internal tables under the `ontave` PostgreSQL schema.

```text
Authenticated host context
          ↓
     Ontave runtime
          ├─ Evidence + durable jobs → PostgreSQL
          ├─ Scoped worker → explicit model adapter
          ├─ Staged bundles → authorized review
          ├─ Candidate → evaluation → activation
          └─ Pinned contract → accepted-data query
```

## Separate records, separate meaning

**Evidence** preserves the source. **Runs** record interpretations and available provider usage. **Bundles** capture the content and dependencies a reviewer sees. **Assertions** retain accepted facts and their history. **Projections** support current structured reads.

**Ontology versions** describe the active logical model. **Candidates** represent proposed additive changes. **Contracts** describe the subset a particular application adopts. A contract is not a historical data snapshot.

## Inference outside the transaction

A worker claims a fenced lease in a short database transaction. Model networking happens outside it. Staging uses another transaction that checks the lease, fence and model version. A provider can repeat a request after a crash; the guarantee concerns committed effects, not exactly-once inference.

## Explicit boundaries

A receipt is not extraction completion. A candidate is not an active model. Model activation is not fact acceptance. Reviewer acceptance is not independent verification. These boundaries are represented by distinct operations and states.
