# Annotation and equivalence rubric

Version 1, created before live-model evaluation or prompt tuning. All fixtures are fictional. The labels encode expected behavior; they are not model responses or measured accuracy.

1. Score raw proposed assertions before human correction, then report accepted-state quality separately. Keep missed and unresolved in-scope facts in the recall denominator; unsupported extra assertions are false positives.
2. Concept roles, stable field IDs, identifier authority/kind/value, booleans, enum meanings, source support, currency, numeric values, dates and verification states require exact normalized agreement. A reversed relationship is equivalent only when an explicitly registered inverse mapping exists in the rubric.
3. Decimal comparison uses decimal values and explicit currency, never floating point. There is no tolerance that converts a different amount into a correct answer.
4. Source quotes are verbatim. The runtime derives UTF-8 spans. Similar wording is not an evidence span. Repeated quotes need a zero-based occurrence selection.
5. Free-text labels may normalize Unicode NFC and whitespace. Synonyms need a manually approved per-field equivalence list. Generic token containment does not excuse changed negation, quantities, units, obligations or uncertainty.
6. A payment statement is a reported claim. Confirmation requires independently supplied trusted evidence or an authorized attestation under host policy. Reviewer acceptance alone is not confirmation.
7. Similar names remain ambiguous. A trusted identifier match is unique only in its declared authority/workspace/kind. Abstention is not a correct identity merge.
8. Friday, tomorrow and other relative dates remain unresolved without an explicit reference date/timezone and a declared rule. Do not score an invented date as correct.
9. Accept semantically equivalent concept structures through an independently reviewed concept/ID mapping recorded before scoring. Do not hardcode a solar taxonomy into runtime logic or retroactively invent mappings to raise scores.
10. HOLDOUT-TASKS inputs and answer keys stay out of proposal generation. Tuning after viewing answers consumes that holdout; create a new set or label it development data.
11. Report every trial, numerator/denominator, invalid/refused/truncated response, ambiguity, false merge and reviewer action. A fixture adapter cannot establish live extraction quality.
12. The handoff target remains raw precision 95% and recall 90% in each of three frozen live trials. Earlier development profiles failed these targets; a new v3 14B profile passed the aggregate field targets under an explicit revised description-equivalence policy. All profiles remain separately frozen and reported. The candidate evaluator uses strict task success checks; neither a strong aggregate nor human correction can substitute for each required passing trial. See [the quality report](QUALITY_REPORT.md).

The v3 development rule in `fixtures/release-v1/description-equivalences.json` applies only to `maintenance_request.description`: “maintenance review” and “Schedule maintenance review.” Both denote requested work. Completed/cancelled/negated actions are not equivalent. It was introduced after reviewing v2, then frozen before fresh v3 collection. Independent annotation review remains outstanding.
