import type { Concept } from "./types.js";

const normalized = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") ?? "";
const words = (text: string) =>
  new Set(
    normalized(text)
      .split(" ")
      .filter(
        (word) =>
          word.length > 2 &&
          !["the", "and", "for", "with", "from", "that", "this"].includes(word),
      ),
  );

/** Review hints only. A shared label, description or shape never establishes equivalence. */
export function conceptReuseReasons(
  proposed: Concept,
  existing: Concept,
): string[] {
  const reasons: string[] = [];
  const labels = (concept: Concept) =>
    [
      concept.id.replaceAll("_", " "),
      concept.name,
      ...(concept.aliases ?? []),
    ].map(normalized);
  const priorLabels = new Set(labels(existing));
  if (
    labels(proposed).some((label) => label.length > 0 && priorLabels.has(label))
  )
    reasons.push(
      "A name, alias or stable-ID label matches an existing concept; review reuse before adding a synonym.",
    );
  const a = words(proposed.description),
    b = words(existing.description);
  const shared = [...a].filter((word) => b.has(word)).length;
  if (shared >= 2 && shared / new Set([...a, ...b]).size >= 0.5)
    reasons.push(
      "Descriptions share substantial vocabulary; compare their meanings before adding a distinct concept.",
    );
  if (
    proposed.fields.length > 0 &&
    proposed.fields.every((field) =>
      existing.fields.some(
        (old) => old.id === field.id && old.type === field.type,
      ),
    )
  )
    reasons.push(
      "All proposed fields already exist with these types on an existing concept. Compare meanings and justify reuse or a distinct concept; shared shape is not semantic equivalence.",
    );
  return reasons;
}
