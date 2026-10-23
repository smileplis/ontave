// Explicit deterministic teaching/test fixture. It is never a live discovery result.
import { seeds } from "./cases.mjs";
export const fixturePatch = {
  concepts: [
    {
      id: "ext_delivery_commitment",
      name: "Delivery commitment",
      description:
        "A source-reported promise to supply a quantity on a future date",
      fields: [
        {
          id: "quantity",
          name: "Quantity",
          description: "Explicit promised panel count",
          type: "integer",
          optional: false,
        },
        {
          id: "delivery_date",
          name: "Promised date",
          description: "Explicit unambiguous ISO date",
          type: "date",
          optional: false,
        },
      ],
    },
  ],
  relations: [
    {
      id: "ext_for_quotation",
      name: "For quotation",
      source: "ext_delivery_commitment",
      target: "quotation",
    },
  ],
};
export function fixturePlan(event, parent) {
  const expected = event.expected ?? [],
    reference =
      expected[0]?.reference ??
      (event.id === "guard-09"
        ? "Q999"
        : event.id === "guard-10"
          ? "Q17"
          : null);
  const tuples = expected.length
    ? expected
    : event.id === "guard-09"
      ? [{ reference: "Q999", quantity: 10, date: "2026-12-08" }]
      : event.id === "guard-10"
        ? [{ reference: "Q17", quantity: 30, date: "2026-12-30" }]
        : [];
  const exists = parent.concepts.some(
    (c) => c.id === "ext_delivery_commitment",
  );
  return {
    patch:
      tuples.length && !exists
        ? structuredClone(fixturePatch)
        : { concepts: [], relations: [] },
    entities: tuples.length
      ? [
          {
            mentionId: "q",
            conceptId: "quotation",
            name: reference,
            fields: { reference: { value: reference, quote: reference } },
          },
          ...tuples.map((t, i) => ({
            mentionId: "c" + i,
            conceptId: "ext_delivery_commitment",
            name: "Commitment " + t.date + " " + t.quantity,
            fields: {
              quantity: { value: t.quantity, quote: event.text },
              delivery_date: { value: t.date, quote: event.text },
            },
          })),
        ]
      : [],
    relationships: tuples.map((_, i) => ({
      source: "c" + i,
      target: "q",
      relationId: "ext_for_quotation",
      quote: event.text,
    })),
    observations: [],
  };
}
