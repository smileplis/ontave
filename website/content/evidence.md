## Preserve before interpreting

```ts
const receipt = await ontave.ingest(context, {
  source: "inbox",
  idempotencyKey: "external-message-014",
  payload: { kind: "text", text: "Ramesh needs to inspect the roof." },
  metadata: { sourceReference: "message-014" },
});
```

Text evidence preserves the supplied text under a UTF-8 coordinate contract. JSON evidence preserves values using canonical JSON and RFC 6901 paths. Unsupported JSON values, non-finite numbers, sparse arrays, accessors, unpaired surrogates and PostgreSQL-incompatible NUL characters fail explicitly.

## Source references

An extracted field includes a verbatim quote and, for JSON, a path to its source value. The runtime derives byte spans rather than trusting model-generated offsets. Repeated quotes require a zero-based `occurrence` when ambiguous.

A syntactically valid quote is necessary evidence support. It does not prove the real-world statement is true.

## Inspect the source

```ts
const evidence = await ontave.evidence.get(context, receipt.evidence_id, {
  startByte: 0,
  limitBytes: 4096,
});
```

Source inspection returns explicit range and continuation metadata, with an 8 KiB maximum excerpt. The full accepted source remains stored for bounded worker processing. Reads must respect UTF-8 boundaries.

## Corrections retain the original

A new interpretation or correction does not overwrite original evidence. Use the staged assertion correction/retraction APIs or ingest a new source with correction provenance. Source/event time and recorded time remain distinct.

Allowed metadata defaults are `sourceEventTime`, `sourceTimezone`, `sourceReference`, `externalId`, `correctionOf` and `contentType`. Metadata never grants privileges.
