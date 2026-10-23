# Adaptation development evidence

Read [the milestone report](../../docs/ADAPTATION_MILESTONE.md) before quoting these results. All source messages are fictional. No private provider configuration is included.

- `acquisition-v1`, `acquisition-v2`, `acquisition-v3`: exact prediction/usage/error bytes plus hashed pre-acquisition source snapshots. 33 calls each, 99 total. Cases and semantic aliases remain unchanged.
- `replay-*-original.json`: final-code cached replays without the later active-definition reuse normalization. Ontave and flexible PostgreSQL recalled 0/39, 0/39 and 21/39 respectively.
- `replay-v3-normalized.json`: post-acquisition development ablation, 37/39 for both automatic arms. Original plans and failures remain visible. No new model calls.
- `initial-guard-failure.log`: earlier partial replay failure before the unknown-parent guard was fixed. Only the local checkout path is redacted.
- `results.json`: content bindings, aggregate scores, availability, descriptive family intervals and local cached-processing times. Inference and provisioning are excluded from those processing times. Dollar cost is unknown; reported token usage excludes one outage with no usage returned.

The 95% family-bootstrap recall interval is 83.33–100% on only six routine families; the Wilson interval for five of six families exact across all repeats is 43.65–96.99%. These describe a small reused development set, not population generalization. Independent labels, unseen end-to-end trials and external developer effort measurements remain pending.

Reproduction commands are in `examples/adaptive-quotes/README.md`. Public evidence is checked by `tests/adaptation-evidence.test.mjs`. A new replay may change local timings and IDs; it must not replace these historical artifacts silently.
