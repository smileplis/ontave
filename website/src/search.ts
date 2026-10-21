export interface SearchDocument {
  title: string;
  description: string;
  path: string;
  text: string;
}
export function searchDocuments(
  index: SearchDocument[],
  query: string,
): SearchDocument[] {
  const terms = query
    .toLowerCase()
    .slice(0, 200)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const expressions = terms.map(
    (term) =>
      new RegExp(
        "(^|[^\\p{L}\\p{N}_])" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "u",
      ),
  );
  return index
    .map((entry) => {
      const title = entry.title.toLowerCase(),
        description = entry.description.toLowerCase(),
        text = entry.text.toLowerCase();
      const matches = expressions.map((expression) => ({
        title: expression.test(title),
        description: expression.test(description),
        text: expression.test(text),
      }));
      return {
        entry,
        eligible: matches.every((x) => x.title || x.description || x.text),
        score: matches.reduce(
          (n, x) =>
            n + (x.title ? 10 : 0) + (x.description ? 4 : 0) + (x.text ? 1 : 0),
          0,
        ),
      };
    })
    .filter((x) => x.eligible)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.entry);
}
