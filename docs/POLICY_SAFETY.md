# Automatic acceptance safety patch: alpha.6

Upgrade with `npm install ontave@latest`, or pin `ontave@0.1.0-alpha.6`. This patch tightens automatic acceptance; it does not change the website design or the explicit manual review API.

## Defect in alpha.5

An allowed source could reference an existing quotation and supply different supplier or currency values. `acceptByPolicy` validated the source and identity scope but did not restrict field assertions on the linked record. It accepted the new assertions, turning previously usable fields into conflicts. Queries filtering the original currency or supplier could stop returning that quotation. The same gap affected other existing fields and allowed new identifier aliases.

The regression suite reproduced the defect in a disposable PostgreSQL database with fictional data and no paid model calls. It failed against the alpha.5 implementation before the fix.

## New boundary

- Existing records are read-only references during automatic acceptance, including records in the extension namespace.
- Every supplied field must match a current single accepted value. Different values, unknown/missing fields and choices from existing conflicts stay pending.
- Recognized identifiers must already bind to that exact record. Automation cannot add aliases or rebind an identity.
- A matching reference does not append field assertions, change identifiers, increment the entity revision or rewrite its projection.
- Automatic relationships may originate only from new entities. Existing outgoing relationships require explicit review.
- New eligible entities can still link to an allowed existing parent. `allowNewExistingEntities` permits new base-model records; it never grants mutation of an existing record.

Policy validation, row locking, revision checks and canonical writes now run in one acceptance transaction. If any part is denied, the whole bundle rolls back and stays pending. Source evidence and the staged proposal remain available for review. A concurrent committed parent revision causes a stale-bundle failure; the automatic operation cannot adopt partially checked data.

## Upgrade and existing data

The patch prevents new automatic mutations of protected records. It does not delete or retract claims already accepted by alpha.5. Inspect earlier automatic decisions and any resulting conflicts in your workspace, then use explicit review/correction operations when warranted. Rewriting accepted history without review could discard legitimate business claims.

Manual acceptance remains an explicit host-authorized action and may deliberately introduce a reported conflict. Automatic schema publication retains its separately disclosed structural checks and `semanticAccuracyQualified: false`; this patch is not semantic accuracy qualification or full production certification.

## Regression coverage

`tests/integration/automatic-policy-boundary.test.mjs` covers quotation currency/supplier changes, missing expiry fills, line quantities and price amount/currency, existing extension records, identifier aliases, prior conflicts, mixed-bundle rollback, reference-only retries, concurrent valid commitments, new-base-record permission boundaries and a real PostgreSQL parent-lock/revision race. It checks frozen quotation queries, accepted values, assertions, identifiers, projections and revisions.

Existing automatic-evolution tests continue to exercise source/parent limits and strict defaults. Historical benchmark artifacts remain unchanged; new cached replays test that eligible delivery commitments remain usable with the patch.
