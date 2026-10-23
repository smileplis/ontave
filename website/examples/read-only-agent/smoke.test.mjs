import assert from "node:assert/strict";
import test from "node:test";
import { installationInput, lookupInstallation, createInstallationAgent } from "./agent.ts";
test("a known record retains its reported payment state", () => {
  assert.deepEqual(lookupInstallation("I-101"), {
    found: true, id: "I-101", stage: "awaiting inspection", payment: "reported",
  });
});
test("an absent record stays absent", () => {
  assert.deepEqual(lookupInstallation("I-999"), { found: false });
});
test("tool input rejects malformed identifiers", () => {
  assert.equal(installationInput.safeParse({ installationId: "I-101" }).success, true);
  for (const id of ["", "all records", "I-101 OR 1=1", 101]) {
    assert.equal(installationInput.safeParse({ installationId: id }).success, false);
  }
});
test("agent construction does not need provider credentials", () => {
  const agent = createInstallationAgent("provider/model-selected-by-user");
  assert.ok(agent);
});
