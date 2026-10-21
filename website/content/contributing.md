## Start with the actual boundary

Read [architecture](/docs/architecture/), [release status](/docs/status/) and the API before changing behavior. The alpha's strongest promises concern source preservation, explicit review, authorization and contract meaning.

## Local checks

```sh
npm ci
npm test
npm run test:integration
npm run verify:package
```

Use fictional fixtures and disposable databases. Keep deterministic regression tests independent of paid provider calls. If a change affects distribution or server/client boundaries, run the corresponding clean Node and Next.js consumers as well.

## Propose focused changes

Describe the concrete trigger, expected behavior and evidence. A useful regression test exercises an invariant or an actual failure, rather than duplicating the implementation.

Changing scoring labels or a release threshold after seeing results invalidates that frozen trial. Record a new run or use new held-out data instead of improving a score retroactively.

## Website and docs

The static site lives in `website`. Run `npm ci`, `npm run build` and `npm run check` there. Docs are Markdown with an explicit navigation manifest. Keep snippets aligned with exported methods and distinguish illustrative demos from actual model outputs.

## License and security reports

Contributions are under [Apache 2.0](/docs/license/). Do not publish private credentials or sensitive evidence in issues. For an observed security problem, provide a minimal fictional reproduction and redact unrelated application data.
