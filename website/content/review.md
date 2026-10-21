## Inspect a whole bundle

```ts
const bundle = await ontave.reviews.get(context, bundleId);
```

A bundle binds an interpretation to source evidence, extraction/model version, identity resolutions, dependencies and a digest. Unknown concepts or unresolved identities block the whole assertion bundle. Known fields do not publish ahead of the unresolved parts.

## Resolve, then review again

`reviews.resolveIdentity` chooses a compatible entity or explicitly creates a new identity. `reviews.amend` stages a revised extraction. These operations return the new content/digest. Previously reviewed content cannot authorize a modified revision.

```ts
await ontave.reviews.accept(context, {
  bundleId: bundle.id,
  digest: bundle.hash,
  requestKey: "review-014",
  reason: "Checked each value against the source",
});
```

Acceptance validates dependencies and expected entity revisions, then commits the bundle's effects atomically. Repeated exact acceptance is idempotent. A reused key with changed input conflicts; a stale digest or revision requires renewed review.

## Rejection and history

Use `reviews.reject` with the exact digest and a reason to retain a rejection decision without publishing the proposed facts. Review decisions remain inspectable alongside evidence and assertion lineage.

## Corrections, retractions and attestations

`assertions.correct`, `assertions.retract`, `assertions.attest` and `reviews.resolveConflict` create staged work. They do not edit accepted values in place. Inspect the returned bundle and explicitly accept that exact revision.

A reviewer who accepts a reported claim has accepted the interpretation. [Verification](/docs/verification/) remains a separate question.
