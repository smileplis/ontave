import type { Definition, Extraction, ModelTask } from "../types.js";

export const installationPatch: Definition = {
  concepts: [
    {
      id: "installation",
      name: "Installation",
      description: "Scheduled installation work",
      fields: [
        {
          id: "reference",
          name: "Reference",
          description: "Installation reference",
          type: "text",
        },
      ],
    },
  ],
  relations: [],
};
export const scenarios = [
  {
    id: "roof",
    name: "An unexpected inspection",
    text: "Before we install the panels for I-101, Ramesh needs to inspect the roof.",
    conceptId: "roof_inspection",
    label: "Roof inspection",
    field: "requirement",
    quote: "inspect the roof",
    value: "inspect the roof",
    description:
      "A new requirement arrives inside a familiar installation workflow.",
    patch: {
      concepts: [
        {
          id: "roof_inspection",
          name: "Roof inspection",
          description: "An inspection requirement reported by a source",
          fields: [
            {
              id: "requirement",
              name: "Requirement",
              description: "The reported inspection requirement",
              type: "text",
            },
          ],
        },
      ],
      relations: [
        {
          id: "inspection_installation",
          name: "Precedes installation",
          source: "roof_inspection",
          target: "installation",
        },
        {
          id: "inspection_person",
          name: "Assigned person",
          source: "roof_inspection",
          target: "person",
        },
      ],
    },
  },
  {
    id: "payment",
    name: "A payment claim",
    text: "Ramesh says: I paid ₹50,000 for installation I-101.",
    conceptId: "payment_claim",
    label: "Payment claim",
    field: "amount",
    quote: "₹50,000",
    value: { amount: "50000", currency: "INR" },
    description:
      "A correctly recorded claim still needs independent confirmation.",
    patch: {
      concepts: [
        {
          id: "payment_claim",
          name: "Payment claim",
          description: "An unverified report of a payment",
          fields: [
            {
              id: "amount",
              name: "Amount",
              description:
                "Amount claimed by the source; acceptance does not verify receipt",
              type: "money",
            },
          ],
        },
      ],
      relations: [
        {
          id: "claim_installation",
          name: "For installation",
          source: "payment_claim",
          target: "installation",
        },
        {
          id: "claim_person",
          name: "Reported by",
          source: "payment_claim",
          target: "person",
        },
      ],
    },
  },
] as const;
export type Scenario = (typeof scenarios)[number];
export const scenarioById = (id: string): Scenario => {
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) throw Error("Unknown fictional scenario");
  return scenario;
};
export function sampleExtraction(task: ModelTask): Extraction {
  const field = (value: any, quote: string) => ({
    value,
    quote,
    verification: "reported" as const,
  });
  const person = {
    mentionId: "person",
    conceptId: "person",
    name: "Ramesh",
    fields: { name: field("Ramesh", "Ramesh") },
  };
  const work = {
    mentionId: "installation",
    conceptId: "installation",
    name: "I-101",
    fields: { reference: field("I-101", "I-101") },
  };
  if (task.text === "Ramesh")
    return { entities: [person], relationships: [], observations: [] };
  if (task.text === "Installation I-101 is scheduled.")
    return task.ontology.concepts.some((c) => c.id === "installation")
      ? { entities: [work], relationships: [], observations: [] }
      : {
          entities: [],
          relationships: [],
          observations: [{ concept: "Installation", quote: "I-101" }],
        };
  const scenario = scenarios.find((s) => s.text === task.text);
  if (!scenario)
    throw Error(
      "The fixture adapter accepts only the supplied fictional messages",
    );
  const entities: any[] = [person, work];
  for (const entity of entities) {
    const candidate = task.candidates.find(
      (c) => c.conceptId === entity.conceptId && c.name === entity.name,
    );
    if (candidate) entity.existingId = candidate.id;
  }
  if (!task.ontology.concepts.some((c) => c.id === scenario.conceptId))
    return {
      entities,
      relationships: [],
      observations: [{ concept: scenario.label, quote: scenario.quote }],
    };
  entities.push({
    mentionId: "new",
    conceptId: scenario.conceptId,
    name: scenario.label,
    fields: { [scenario.field]: field(scenario.value, scenario.quote) },
  });
  return {
    entities,
    relationships: scenario.patch.relations.map((r) => ({
      relationId: r.id,
      source: "new",
      target: r.target === "person" ? "person" : "installation",
      quote: scenario.text,
    })),
    observations: [],
  };
}
