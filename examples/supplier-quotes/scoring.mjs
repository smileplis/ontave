// Deterministic, one-to-one field scoring. Never calls a model or imports Ontave.
import {
  canonical,
  fieldsByType,
  normalize,
  recordKey,
  validateClaim,
} from "./domain.mjs";
const ratio = (n, d) => (d ? n / d : null);
export function atoms(output) {
  if (!Array.isArray(output?.records)) return [];
  return output.records.flatMap((r, ri) =>
    r?.fields && typeof r.fields === "object" && !Array.isArray(r.fields)
      ? Object.entries(r.fields).map(([field, claim]) => ({
          type: r.type,
          key: recordKey(r),
          field,
          value: claim?.value,
          quote: claim?.quote,
          occurrence: claim?.occurrence,
          record: ri,
        }))
      : [],
  );
}
function key(atom) {
  const f = fieldsByType[atom.type]?.[atom.field];
  let value = atom.value;
  try {
    if (f) value = normalize(f.type, value);
  } catch {
    return "invalid";
  }
  return canonical([atom.type, atom.key, atom.field, value]);
}
export function scoreFields(raw, expected, text) {
  const predictions = atoms(raw),
    gold = atoms(expected),
    used = new Set(),
    byField = {};
  let correct = 0,
    sourceReferences = 0;
  for (const atom of predictions) {
    let anchored = false;
    try {
      validateClaim(
        fieldsByType[atom.type]?.[atom.field],
        {
          value: atom.value,
          quote: atom.quote,
          ...(atom.occurrence === undefined
            ? {}
            : { occurrence: atom.occurrence }),
        },
        text,
      );
      anchored = true;
      sourceReferences++;
    } catch {}
    const index = anchored
      ? gold.findIndex((g, i) => !used.has(i) && key(g) === key(atom))
      : -1;
    const f = String(atom.type) + "." + atom.field;
    byField[f] ??= { correct: 0, proposed: 0, expected: 0 };
    byField[f].proposed++;
    if (index >= 0) {
      used.add(index);
      correct++;
      byField[f].correct++;
    }
  }
  for (const atom of gold) {
    const f = String(atom.type) + "." + atom.field;
    byField[f] ??= { correct: 0, proposed: 0, expected: 0 };
    byField[f].expected++;
  }
  const precision = ratio(correct, predictions.length),
    recall = ratio(correct, gold.length);
  return {
    correct,
    proposed: predictions.length,
    expected: gold.length,
    falsePositive: predictions.length - correct,
    missed: gold.length - correct,
    precision,
    recall,
    f1:
      predictions.length + gold.length
        ? (2 * correct) / (predictions.length + gold.length)
        : 1,
    documentExact: correct === gold.length && correct === predictions.length,
    sourceReferences,
    byField,
  };
}
export function aggregate(rows) {
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0),
    correct = sum("correct"),
    proposed = sum("proposed"),
    expected = sum("expected");
  return {
    documents: rows.length,
    correct,
    proposed,
    expected,
    precision: ratio(correct, proposed),
    recall: ratio(correct, expected),
    microF1: proposed + expected ? (2 * correct) / (proposed + expected) : 1,
    macroDocumentF1: rows.length
      ? rows.reduce((n, r) => n + r.f1, 0) / rows.length
      : null,
    documentExact: rows.length
      ? rows.filter((r) => r.documentExact).length / rows.length
      : null,
    sourceCoverage: ratio(sum("sourceReferences"), proposed),
    falsePositive: proposed - correct,
    missed: expected - correct,
  };
}
export function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return null;
  const p = successes / total,
    den = 1 + (z * z) / total,
    mid = (p + (z * z) / (2 * total)) / den,
    half =
      (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
      den;
  return {
    lower: successes === 0 ? 0 : Math.max(0, mid - half),
    upper: successes === total ? 1 : Math.min(1, mid + half),
    confidence: 0.95,
    n: total,
  };
}
export function bootstrapByFamily(
  rows,
  select,
  iterations = 10000,
  seed = 20261023,
) {
  const groups = Object.groupBy(rows, (r) => r.family),
    keys = Object.keys(groups);
  if (!keys.length) return null;
  const next = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    samples = [];
  for (let n = 0; n < iterations; n++) {
    const drawn = Array.from(
      { length: keys.length },
      () => groups[keys[Math.floor(next() * keys.length)]],
    ).flat();
    samples.push(select(drawn));
  }
  samples.sort((a, b) => a - b);
  return {
    lower: samples[Math.floor(iterations * 0.025)],
    upper: samples[Math.floor(iterations * 0.975)],
    confidence: 0.95,
    iterations,
    unit: "supplier/layout/scenario family; repeated trials retained within cluster",
  };
}
export function pairedDifference(rows, left, right) {
  return bootstrapByFamily(
    rows,
    (rs) => rs.reduce((n, r) => n + r[left] - r[right], 0) / rs.length,
  );
}
