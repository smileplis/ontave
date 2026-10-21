## Names are candidates, not authority

Two sources saying “Ramesh” do not establish one person. Similar names can produce review candidates; the runtime does not select the nearest name and silently merge established records.

## Configure trusted identifiers

```ts
const ontave = createOntave({
  storage,
  model,
  authorize,
  identifierRules: [{ authority: "customer-directory", kind: "external-id" }],
});
```

Matching includes workspace, declared authority, identifier kind and normalized value. An email address is not automatically authoritative. The same value in another authority or workspace does not authorize a link.

## Resolve explicitly

```ts
const revised = await ontave.reviews.resolveIdentity(context, {
  bundleId: bundle.id,
  digest: bundle.hash,
  mentionId: "person_1",
  entityId: "new",
  requestKey: "identity-014",
  reason: "The source does not establish an existing identity",
});
```

Select a scoped, compatible entity ID instead of `new` when evidence supports the link. Review the new bundle/digest before accepting it.

## Replay and limits

An accepted source-bound identity decision can be reused when the same source is replayed in its recorded scope. Automatic destructive merging of two established entities is outside the alpha. Record the issue for explicit reconciliation instead.
