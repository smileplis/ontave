// Deterministic wire-protocol convenience. Only explicit, authorized existing keys can be expanded.
export function expandKnownReferences(input, knownReferences, text) {
  if (!input) return input;
  const plan = structuredClone(input),
    known = new Set(knownReferences),
    ids = new Set(plan.entities.map((e) => e.mentionId));
  for (const rel of plan.relationships) {
    if (ids.has(rel.target) || !known.has(rel.target)) continue;
    const value = rel.target,
      escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      !new RegExp("(?<![A-Za-z0-9_])" + escaped + "(?![A-Za-z0-9_])").test(text)
    )
      continue;
    const mentionId = "existing_reference_" + plan.entities.length;
    plan.entities.push({
      mentionId,
      conceptId: "quotation",
      name: value,
      fields: { reference: { value, quote: value } },
    });
    for (const r of plan.relationships)
      if (r.target === value) r.target = mentionId;
    ids.add(mentionId);
  }
  const mapping = new Map(plan.entities.map((e, i) => [e.mentionId, "m_" + i]));
  for (const entity of plan.entities)
    entity.mentionId = mapping.get(entity.mentionId);
  for (const relation of plan.relationships) {
    relation.source = mapping.get(relation.source) ?? relation.source;
    relation.target = mapping.get(relation.target) ?? relation.target;
  }
  return plan;
}

/** Keep the active model authoritative; repeated compatible declarations do not change it. */
export function reuseCurrentDefinitions(input, current) {
  if (!input) return input;
  const plan = structuredClone(input),
    notes = [];
  const shape = (c) =>
    JSON.stringify(
      c.fields
        .map((f) => ({
          id: f.id,
          type: f.type,
          nullable: f.nullable ?? false,
          values: f.values ?? null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  plan.patch.concepts = plan.patch.concepts.filter((c) => {
    const existing = current.concepts.find((old) => old.id === c.id);
    if (
      existing &&
      existing.name.trim().toLowerCase() === c.name.trim().toLowerCase() &&
      shape(existing) === shape(c)
    ) {
      notes.push({
        kind: "reused-active-concept",
        id: c.id,
        proposedDescription: c.description,
        activeDescription: existing.description,
      });
      return false;
    }
    return true;
  });
  plan.patch.relations = plan.patch.relations.filter((r) => {
    const existing = current.relations.find((old) => old.id === r.id);
    if (
      existing &&
      existing.source === r.source &&
      existing.target === r.target &&
      (existing.max ?? null) === (r.max ?? null)
    ) {
      notes.push({ kind: "reused-active-relation", id: r.id });
      return false;
    }
    return true;
  });
  return { ...plan, normalization: notes };
}
