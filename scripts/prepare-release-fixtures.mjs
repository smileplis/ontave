// Maintainer-authored labels. Independent annotation review is a separate release gate.
import { readFile, writeFile } from "node:fs/promises";
import { starter, extend, hash, json } from "../dist/index.js";
import { validateExtraction, sourceSpan } from "../dist/core.js";
const field = (id, type, description, optional = false) => ({
  id,
  name: id,
  description,
  type,
  ...(optional ? { optional: true } : {}),
});
const concept = (id, description, fields) => ({
  id,
  name: id,
  description,
  fields,
});
const relation = (id, source, target) => ({ id, name: id, source, target });
const solarPatch = {
  concepts: [
    concept(
      "inquiry",
      "A request for a quantity; competing reports stay separate",
      [field("quantity", "integer", "Explicit panel quantity")],
    ),
    concept(
      "quotation",
      "A referenced quotation, including proposed revisions; never automatically supersedes an accepted value",
      [
        field("reference", "text", "Quotation reference"),
        field("total", "money", "Explicit quotation total", true),
      ],
    ),
    concept(
      "payment_claim",
      "A source's claim of transferring money; never a confirmed receipt",
      [field("amount", "money", "Claimed transfer amount")],
    ),
    concept(
      "payment_confirmation",
      "A bank receipt; amount verified only with explicit trusted host authorization",
      [
        field("reference", "text", "Bank receipt reference"),
        field("amount", "money", "Amount confirmed by bank receipt"),
      ],
    ),
    concept(
      "installation",
      "Referenced installation work; explicit dates only, relative/unknown dates stay unresolved",
      [
        field("reference", "text", "Installation reference"),
        field("scheduled_date", "date", "Explicit calendar date only", true),
        field(
          "is_complete",
          "boolean",
          "Explicit completion state; not complete means false",
          true,
        ),
      ],
    ),
  ],
  relations: [
    relation("affiliated_with", "person", "organization"),
    relation("inquiry_person", "inquiry", "person"),
    relation("inquiry_organization", "inquiry", "organization"),
    relation("inquiry_quotation", "inquiry", "quotation"),
    relation("quotation_organization", "quotation", "organization"),
    relation("claim_person", "payment_claim", "person"),
    relation("claim_quotation", "payment_claim", "quotation"),
    relation("confirmation_quotation", "payment_confirmation", "quotation"),
    relation("installation_quotation", "installation", "quotation"),
    relation("installation_assigned", "installation", "person"),
  ],
};
const rentalPatch = {
  concepts: [
    concept("asset", "A referenced rental asset", [
      field("reference", "text", "Asset reference"),
    ]),
    concept(
      "condition_observation",
      "A reported asset condition, including damage",
      [field("description", "text", "Explicit condition")],
    ),
    concept(
      "maintenance_request",
      "A request to schedule maintenance; not completed maintenance",
      [field("description", "text", "Requested maintenance activity")],
    ),
  ],
  relations: [
    relation("condition_asset", "condition_observation", "asset"),
    relation("maintenance_asset", "maintenance_request", "asset"),
  ],
};
const definitions = {
  solar: extend(starter, solarPatch),
  rental: extend(starter, rentalPatch),
};
const records = [];
for (const [file, domain] of [
  ["solar-dev", "solar"],
  ["rental-transfer", "rental"],
]) {
  const inputs = JSON.parse(
    await readFile(`fixtures/inputs/${file}.json`, "utf8"),
  );
  for (const input of inputs) {
    const e = { entities: [], relationships: [], observations: [] };
    const add = (conceptId, name, fields) => {
      const mentionId = "m" + e.entities.length;
      e.entities.push({
        mentionId,
        conceptId,
        name,
        fields: Object.fromEntries(
          Object.entries(fields).map(([fieldId, value]) => [
            fieldId,
            {
              value,
              quote:
                typeof value === "object"
                  ? `${value.currency} ${value.amount}`
                  : String(value),
              verification:
                conceptId === "payment_confirmation" && fieldId === "amount"
                  ? "verified"
                  : "reported",
            },
          ]),
        ),
      });
      return mentionId;
    };
    const rel = (relationId, source, target) =>
      e.relationships.push({ relationId, source, target, quote: input.text });
    const text = input.text,
      n = Number(input.id.split("-")[1]);
    if (domain === "rental") {
      const ref = text.match(/CAM-\d+/)[0],
        condition = text.match(/condition: (.+)\. Schedule/)[1];
      const a = add("asset", ref, { reference: ref }),
        c = add("condition_observation", condition, { description: condition }),
        m = add("maintenance_request", "maintenance review", {
          description: "maintenance review",
        });
      rel("condition_asset", c, a);
      rel("maintenance_asset", m, a);
    } else if (n <= 12) {
      const [, name, org, quantity] = text.match(
        /^(.+) from (.+) requests (\d+) solar panels/,
      );
      const p = add("person", name, { name }),
        o = add("organization", org, { name: org }),
        i = add("inquiry", `${quantity} panels`, {
          quantity: Number(quantity),
        });
      rel("affiliated_with", p, o);
      rel("inquiry_person", i, p);
      rel("inquiry_organization", i, o);
    } else if (n <= 22) {
      const ref = text.match(/Q-\d+/)[0],
        amount = text.match(/INR (\d+)/)[1];
      const q = add("quotation", ref, {
          reference: ref,
          total: { amount, currency: "INR" },
        }),
        o = add("organization", "ABC Solar", { name: "ABC Solar" });
      rel("quotation_organization", q, o);
    } else if (n <= 30) {
      const amount = text.match(/INR (\d+)/)[1],
        q = add("quotation", "Q-101", { reference: "Q-101" });
      if (text.startsWith("Bank")) {
        const ref = text.match(/BR-\d+/)[0],
          p = add("payment_confirmation", ref, {
            reference: ref,
            amount: { amount, currency: "INR" },
          });
        rel("confirmation_quotation", p, q);
      } else {
        const p = add("person", "Rahul", { name: "Rahul" }),
          c = add("payment_claim", "Transfer claim", {
            amount: { amount, currency: "INR" },
          });
        rel("claim_person", c, p);
        rel("claim_quotation", c, q);
      }
    } else if (n <= 42) {
      const ref = text.match(/I-\d+/)[0],
        date = text.match(/\d{4}-\d\d-\d\d/)?.[0],
        i = add("installation", ref, {
          reference: ref,
          ...(date ? { scheduled_date: date } : {}),
        }),
        p = add("person", "Ramesh", { name: "Ramesh" }),
        q = add("quotation", "Q-101", { reference: "Q-101" });
      rel("installation_assigned", i, p);
      rel("installation_quotation", i, q);
      if (!date)
        e.observations.push({ concept: "unresolved_date", quote: "Friday" });
    } else if (n === 43) {
      const q = add("quotation", "Q-101", { reference: "Q-101" });
      for (const [name, quantity] of [
        ["Rahul", 20],
        ["Asha", 25],
      ]) {
        const p = add("person", name, { name }),
          i = add("inquiry", `${quantity} panels`, { quantity });
        rel("inquiry_person", i, p);
        rel("inquiry_quotation", i, q);
      }
    } else if (n === 44)
      e.observations.push({ concept: "retraction_request", quote: text });
    else if (n === 45) {
      add("person", "Rahul S.", { name: "Rahul S." });
      add("person", "Rahul Sharma", { name: "Rahul Sharma" });
      e.observations.push({
        concept: "identity_uncertainty",
        quote: "may be Rahul Sharma, but this is not confirmed",
      });
    } else if (n === 46)
      e.observations.push({ concept: "unreceived_payment", quote: text });
    else if (n === 47)
      add("quotation", "Q-101", {
        reference: "Q-101",
        total: { amount: "455000", currency: "INR" },
      });
    else if (n === 48) {
      add("installation", "I-101", { reference: "I-101", is_complete: false });
      e.entities[0].fields.is_complete.quote = "not complete";
    } else if (n === 49) {
      const p = add("person", "Anil Kumar", { name: "Anil Kumar" }),
        o = add("organization", "XYZ Solar", { name: "XYZ Solar" });
      rel("affiliated_with", p, o);
    } else if (n === 50)
      e.observations.push({ concept: "unresolved_date", quote: text });
    // Every label has a real verbatim source. Repeated references explicitly select occurrence 0.
    for (const r of [
      ...e.entities.flatMap((x) => Object.values(x.fields)),
      ...e.relationships,
      ...e.observations,
    ]) {
      if (text.indexOf(r.quote) !== text.lastIndexOf(r.quote)) r.occurrence = 0;
      sourceSpan(text, r.quote, r.occurrence);
    }
    validateExtraction(e, text, definitions[domain]);
    const endpoint = (id) => {
      const x = e.entities.find((x) => x.mentionId === id);
      return {
        conceptId: x.conceptId,
        fields: Object.fromEntries(
          Object.entries(x.fields).map(([id, f]) => [id, f.value]),
        ),
      };
    };
    records.push({
      ...input,
      domain,
      expected: e.entities.flatMap((x) =>
        Object.entries(x.fields).map(([fieldId, f]) => ({
          conceptId: x.conceptId,
          fieldId,
          ...f,
        })),
      ),
      relationships: e.relationships.map((r) => ({
        ...r,
        source: endpoint(r.source),
        target: endpoint(r.target),
      })),
      observations: e.observations,
      annotatedExample: e,
    });
  }
}
await writeFile(
  "fixtures/release-v1/definitions.json",
  JSON.stringify(
    { definitions, patches: { solar: solarPatch, rental: rentalPatch } },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "fixtures/release-v1/labels.json",
  JSON.stringify(records, null, 2) + "\n",
);
await writeFile(
  "fixtures/release-v1/manifest.json",
  JSON.stringify(
    {
      version: "maintainer-labels-v1",
      fictional: true,
      independentReview: false,
      records: records.length,
      assertions: records.reduce((n, r) => n + r.expected.length, 0),
      relationships: records.reduce((n, r) => n + r.relationships.length, 0),
      definitionHash: hash(definitions),
      labelsHash: hash(records),
      policy:
        "All 60 original inputs included, including corrections and unresolved cases. Labels are maintainer-authored, not independently certified. Human correction does not alter raw scores. No candidate-generation model sees labels.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    records: records.length,
    assertions: records.reduce((n, r) => n + r.expected.length, 0),
    relationships: records.reduce((n, r) => n + r.relationships.length, 0),
  }),
);
