import { readFile, writeFile } from "node:fs/promises";
import { starter, hash } from "../dist/index.js";
const labels = JSON.parse(
  await readFile("fixtures/release-v1/labels.json", "utf8"),
);
const { definitions } = JSON.parse(
  await readFile("fixtures/release-v1/definitions.json", "utf8"),
);
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const value = (v, n) => ({
  state: "value",
  value: v,
  verification: "reported",
  assertionIds: [uid(n)],
});
const tasks = [];
for (let i = 0; i < 10; i++) {
  const label = labels[i],
    name = label.expected.find((x) => x.conceptId === "person").value;
  const record = {
    id: uid(i + 1),
    conceptId: "person",
    name,
    revision: 1,
    fields: { name: value(name, i + 101), email: { state: "missing" } },
  };
  tasks.push({
    id: `HOLDOUT-${String(i + 1).padStart(3, "0")}`,
    kind: "read",
    definition: starter,
    records: [record],
    query: {
      conceptId: "person",
      where: [
        { field: "name", op: "eq", value: name },
        { field: "email", op: "stateIs", value: "missing" },
      ],
    },
    expected: { records: [record], hasMore: false },
  });
}
for (let i = 0; i < 10; i++) {
  const label = labels.find(
      (x) => x.id === `SOLAR-${String(i + 31).padStart(3, "0")}`,
    ),
    ref = label.expected.find(
      (x) => x.conceptId === "installation" && x.fieldId === "reference",
    ).value,
    date = label.expected.find((x) => x.fieldId === "scheduled_date");
  const person = {
    id: uid(201 + i),
    conceptId: "person",
    name: "Ramesh",
    revision: 1,
    fields: { name: value("Ramesh", 301 + i), email: { state: "missing" } },
  };
  const quotation = {
    id: uid(401 + i),
    conceptId: "quotation",
    name: "Q-101",
    revision: 1,
    fields: { reference: value("Q-101", 501 + i), total: { state: "missing" } },
  };
  const install = {
    id: uid(601 + i),
    conceptId: "installation",
    name: ref,
    revision: 1,
    fields: {
      reference: value(ref, 701 + i),
      scheduled_date: date ? value(date.value, 801 + i) : { state: "missing" },
      is_complete: { state: "missing" },
    },
    relationships: {
      installation_assigned: {
        items: [
          {
            id: person.id,
            verification: "reported",
            assertionId: uid(901 + i),
          },
        ],
        hasMore: false,
      },
      installation_quotation: {
        items: [
          {
            id: quotation.id,
            verification: "reported",
            assertionId: uid(1001 + i),
          },
        ],
        hasMore: false,
      },
    },
  };
  tasks.push({
    id: `HOLDOUT-${String(i + 11).padStart(3, "0")}`,
    kind: "read",
    definition: definitions.solar,
    records: [person, quotation, install],
    query: {
      conceptId: "installation",
      where: [
        { field: "reference", op: "eq", value: ref },
        {
          field: "scheduled_date",
          op: "stateIs",
          value: date ? "value" : "missing",
        },
      ],
      include: ["installation_assigned", "installation_quotation"],
    },
    expected: { records: [install], hasMore: false },
  });
}
await writeFile(
  "fixtures/release-v1/read-tasks.json",
  JSON.stringify(
    {
      status:
        "Executable maintainer-authored regression fixtures; not an independently authored held-out benchmark",
      tasks,
      hash: hash(tasks),
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ tasks: tasks.length, hash: hash(tasks) }));
