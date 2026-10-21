## A closed structured query

```ts
const page = await ontave.entities.find(context, {
  contractId: contract.id,
  contractHash: contract.hash,
  conceptId: "person",
  where: [{ field: "name", op: "eq", value: "Ramesh" }],
  order: { field: "name", direction: "asc" },
  limit: 25,
});
```

Queries accept a fixed object dialect. Field IDs and operations are allowlisted, values are validated and SQL is parameterized. Raw SQL and arbitrary natural-language queries are not part of this API.

## Filters

| Operator                 | Meaning                                     |
| ------------------------ | ------------------------------------------- |
| `eq`, `in`               | Exact typed values or an allowed set        |
| `gt`, `gte`, `lt`, `lte` | Supported scalar range comparisons          |
| `stateIs`                | `value`, `missing`, `unknown` or `conflict` |
| `verificationIn`         | Selected verification states                |

Scalar filters match usable value states. Money supports equality; money range and ordering are rejected. Decimal comparisons use numeric semantics rather than lexicographic string order. A query has at most 20 predicates and `in` has at most 100 values.

## Pagination and order

The default page is 25 records, capped at 100. One ordered field plus entity ID defines pagination. Non-null values sort before null, missing, unknown and conflict.

```ts
const next = await ontave.entities.find(context, {
  ...query,
  cursor: page.nextCursor,
});
```

Only request another page when `nextCursor` is non-null. A cursor is signed and binds workspace, contract and query. Use a stable private `cursorSecret` across processes. Each page is transaction-consistent; accepted changes can affect subsequent pages.

## One-hop relationships

Pass `include: ["relation_id"]` for relationships in the selected contract whose source matches the queried concept. Each relation returns at most 25 links with `hasMore`. Nested graph traversal is outside this alpha.

## Reads work without inference

Accepted-data reads use PostgreSQL and authorization. A provider outage does not require a model call to answer the query. Database availability and the selected contract still apply.
