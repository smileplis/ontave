A document-processing pipeline does more than ask a model to return JSON. It must preserve the input, make extraction failures inspectable, distinguish claims from verified events and prevent a repeated delivery from creating repeated business effects.

For an operations application, a useful pipeline separates the original file, the extracted representation, proposed facts and accepted records.

## Begin before the LLM

Store the original document in a host-controlled object store with its version, access policy and stable identifier. Extract text using the parser or OCR system appropriate for the format. Preserve page or region references where the extraction tool provides them.

Ontave's ingestion API accepts **text or JSON**. It is not a native PDF parser, OCR engine or original-file object store. The host must perform that conversion and retain the relationship to the original file.

Keep the parser/OCR version with the application's own source metadata. If extraction quality is poor, a later model cannot reliably recover characters that were never supplied.

## Make retries refer to the same delivery

A useful identity for an ingestion attempt includes the source document revision and the extraction revision. A repeated delivery of that exact input should reuse its idempotency key. A corrected file or materially changed parser output should be treated as a new source revision.

In a configured Ontave runtime, a host-owned document pipeline can preserve extracted text like this:

```ts
const receipt = await ontave.ingest(context, {
  source: "document-intake",
  idempotencyKey: extractionRevisionId,
  payload: { kind: "text", text: extractedText },
  metadata: {
    sourceReference: originalDocumentRevisionId,
    contentType: "text/plain",
  },
});
```

The identifiers come from your trusted ingestion system. Use an opaque document reference rather than a public or expiring download URL containing credentials. The fragment assumes authorization, a migrated database and a provisioned workspace.

Ontave's preserved evidence is the supplied extraction, not the original PDF's layout. Keep the original-file mapping in the host if page coordinates matter. See [source evidence](/docs/evidence/) for supported inputs and metadata.

## Extract proposals, not unquestioned truth

An invoice can propose an amount, a due date and a claimed customer identity. A receipt can report payment. Those are not interchangeable source authorities.

Validate field shapes, source support and identity separately. Mark ambiguous matches for review. Keep missing, unknown and conflicting values explicit instead of filling them with convenient defaults. The [structured-output guide](/index/structured-output-validation/) explains why parseable JSON is only one layer of validation.

## Review facts and model changes separately

A familiar invoice type may fit an existing contract. An unfamiliar document may introduce a new concept. Do not silently add fields to an application's expected interface whenever a model invents a useful-looking key.

Ontave can stage an additive logical-model change for evaluation and activation while preserving earlier application contracts. That activation does not itself accept the facts extracted from a particular document. Review those interpretations through their own source-bound bundles.

If the incoming format is stable and your domain schema is fixed, a conventional extraction-and-validation pipeline may be simpler. Evaluate the additional layer when provenance, ambiguity and evolving concepts are recurring requirements.

## Handle large and failed inputs deliberately

Do not truncate a long document without recording that information was excluded. Respect the actual model context and runtime payload limits. Splitting documents creates its own problems: facts can cross section boundaries, repeated headers can mislead extraction and a later correction can affect several chunks.

Choose a documented segmentation policy in the host and retain links to the original revision. Ontave's [limits](/docs/errors/) are bounded; it does not supply an automatic cross-document chunking or reconciliation engine. Preserve failures so a person can decide whether to retry, reparse or reject an input.

## Measure the pipeline at each stage

Use reviewed examples to track parsing quality, unsupported extracted fields, identity mistakes, review effort, duplicate deliveries and the final record's query behavior. Keep provider usage separate from business correctness.

The [agent evaluation checklist](/index/evaluating-ai-agents/) provides an example test plan. Ontave's current [developer preview](/docs/status/) has open semantic-quality gates, so a successful fictional playground should not be treated as evidence for your document collection.
