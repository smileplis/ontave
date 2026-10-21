## Accepted and verified answer different questions

**Accepted** means an authorized reviewer accepted an interpretation of the source. **Verified** means a configured source policy supports confirmation of that particular field.

“Ramesh says he paid ₹50,000” is a reported payment claim. A reviewer accepting a correct extraction does not establish receipt of money.

## Verification states

| State      | Meaning                                               |
| ---------- | ----------------------------------------------------- |
| `reported` | Represented as a source report                        |
| `verified` | Allowed by an independently configured trusted policy |
| `disputed` | Explicitly represented as contested                   |
| `unknown`  | Verification is not established                       |

The live extraction schema does not invite a model to invent verification. The runtime also checks whether the source policy may verify each field.

## Trusted policies belong in the host

```ts
sourcePolicies: {
  "bank-reconciliation": { verifiedFields: ["payment.received"] },
}
```

The host resolves the policy in its authorization callback. A source message or HTTP request body cannot grant itself `bank-reconciliation` authority. The example assumes the corresponding approved concept and field already exist.

## Attestations retain their own evidence

An authorized reviewer can use `assertions.attest` to stage an authenticated statement. The attestation creates separate evidence and remains subject to the configured `reviewer-attestation` policy and bundle acceptance. It does not modify the original source's authority.
