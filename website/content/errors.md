## Typed failures

`OntaveError` exposes `code`, a safe message and a `retryable` flag. Handle a known code, then inspect the scoped job or proposal status. Do not infer that a timeout means nothing committed.

| Category      | Examples                                                                              |
| ------------- | ------------------------------------------------------------------------------------- |
| Authorization | `UNAUTHORIZED`, `FORBIDDEN`                                                           |
| Input         | `INVALID_INPUT`, `VALIDATION_FAILED`                                                  |
| Retry/content | `IDEMPOTENCY_CONFLICT`, `STALE_BUNDLE`, `STALE_BASE`, `STALE_ONTOLOGY`                |
| Dependencies  | `UNRESOLVED_IDENTITY`, `UNRESOLVED_CONFLICT`, `CONTRACT_NOT_AVAILABLE`                |
| Model/budget  | `MODEL_UNAVAILABLE`, `INVALID_MODEL_OUTPUT`, `BUDGET_EXHAUSTED`                       |
| Operation     | `EVALUATION_INCOMPLETE`, `LEASE_LOST`, `OPERATION_IN_PROGRESS`, `STORAGE_UNAVAILABLE` |

## Default resource profile

| Bound                              | Default / maximum               |
| ---------------------------------- | ------------------------------- |
| Preserved payload                  | 256 KiB                         |
| Metadata                           | 16 KiB, allowlisted keys        |
| Bundle operations                  | 250                             |
| Identity candidates                | 10                              |
| Model deadline                     | 45 seconds                      |
| Extraction calls / worker attempts | 2 / 3                           |
| Lease                              | 90 seconds                      |
| Definition concepts per model task | 25                              |
| Read page / link count             | 100 / 25                        |
| Evidence excerpt                   | 8 KiB                           |
| Evaluation                         | 40 tasks, 80 calls, 600 seconds |

Explicit lower runtime overrides are allowed. Unknown keys or increases beyond the tested profile are rejected. Gemini counts a complete request against at most 16,384 input tokens and requests at most 4,096 output tokens.

## No silent truncation

Preservation and inference have different limits. An accepted source larger than the processing context remains preserved, with an explicit processing failure. There is no implicit chunking that publishes a partial interpretation.

## CLI behavior

The CLI exits 0 on success and 1 on failure, with safe JSON errors on stderr. Run `ontave help` for the installed command surface. Config is an explicitly trusted server-side module; keep it and private environment out of client bundles.
