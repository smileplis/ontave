# Fictional qualification fixtures, version 1

All 60 original inputs remain included: 50 solar and ten rental. The expanded maintainer labels contain 179 proposed field assertions (149 solar, 30 rental), 107 relationships, explicit source references and unresolved correction/relative-date cases. The 20 read tasks are executable regressions over frozen fixture records; they are not an independently authored held-out benchmark.

`prepare-release-fixtures.mjs` generates these maintainer-authored labels. `fixtures.test.mjs` checks label consistency and verbatim evidence. Neither makes the labels independently certified. The manifest explicitly records `independentReview: false`. Review expected answers against the original sources before qualification; do not tune a model on a held-out set and continue calling it held out.

Live trials use supplied approved definitions and never send the answer labels to the adapter. They test extraction, not autonomous discovery. Every original input stays in each trial, including cases with no eligible scalar assertion. Refusals, invalid envelopes and unsupported extras remain in the report. Human corrections never improve raw scores. The gold sources permit a field quote that contains the expected supporting span; relationships and observation checks have stricter labels and are reported separately.

Unavailable-ID references are raw model proposals, not established-entity merges. The direct adapter trials do not write database entities. The runtime separately rejects unavailable IDs, and trusted-ID behavior has dedicated scoped integration tests. An abstention is not a correct merge.

Each experiment has an immutable protocol, model, hashes, bounds, raw responses, per-input scores and a report in ignored `artifacts/semantic-trials/`. Earlier failed and aborted experiments remain retained. Do not replace them with only a favorable run. Cost is unavailable unless reported by the provider; unknown usage is not zero.
