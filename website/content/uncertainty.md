## Four field envelopes

```ts
type FieldResult<T> =
  | {
      state: "value";
      value: T;
      verification: Verification;
      assertionIds: string[];
    }
  | { state: "unknown"; reason: string; assertionIds: string[] }
  | { state: "missing" }
  | {
      state: "conflict";
      candidates: {
        value: T;
        verification: Verification;
        assertionIds: string[];
      }[];
    };
```

A missing optional field, an explicitly nullable value, an unknown required value and a conflict have different meanings. They do not collapse to `null`, zero or an empty string.

## Handle the state first

```ts
const amount = record.fields.amount;
if (amount?.state === "value") {
  renderAmount(amount.value, amount.verification);
} else if (amount?.state === "conflict") {
  showCandidates(amount.candidates);
} else {
  showUnresolved(amount?.state ?? "missing");
}
```

## Query semantics

Scalar comparisons match usable `value` states. To find unresolved data, use `stateIs`. To restrict source confirmation, use `verificationIn`.

```ts
where: [{ field: "email", op: "stateIs", value: "missing" }];
```

Ordering puts non-null values first, followed by explicit null, missing, unknown and conflict. Entity ID provides the stable tie-breaker.

## Conflicts preserve competing support

New accepted assertions do not simply overwrite older supported values. Competing assertions remain a conflict until an explicit reviewed resolution selects a source or leaves the conflict open. `assertions.explain` exposes the supporting history.
