# Quotation adaptation comparison

The frozen app starts with quotations and quote lines. It learns a source-reported delivery schedule through a bounded host policy. A standalone flexible PostgreSQL implementation receives the same plans. Strict Ontave is the control.

From the repository, with Node.js 24:

```sh
npm ci
npm run compare:adaptation
```

This runs deterministic fictional fixtures against real disposable PostgreSQL. It makes no paid model calls and is not a live-learning accuracy result. Reports are written to `artifacts/adaptation`.

Replay the public acquired plans without paid calls:

```sh
node scripts/compare-adaptation.mjs --responses=benchmarks/adaptation-2026-10-23/acquisition-v3/predictions.json --reuse-current-definitions
```

For the unnormalized development result, omit `--reuse-current-definitions`. Raw v1/v2 acquisitions and acquisition snapshots are also retained. See [the milestone report](../../docs/ADAPTATION_MILESTONE.md) for failure history, scopes and limitations. No case labels are sent to the model. Never treat deterministic fixtures or cached shared predictions as fresh end-to-end held-out evaluation.

Fresh acquisition is explicitly paid and optional:

```sh
npm run collect:adaptation -- --live --env=/absolute/private/provider.env --expand-known-references
```

That makes up to 33 Gemini calls with an explicit model, preflight token caps and zero retries. Configure provider credentials outside the repository. It is unnecessary for inspecting the published development evidence.
