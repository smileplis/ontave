import test from "node:test";
import assert from "node:assert/strict";
import { mistral } from "../dist/models/mistral.js";
import { openrouter } from "../dist/models/openrouter.js";
import { starter } from "../dist/index.js";
const task = {
  text: "Asha",
  ontology: starter,
  candidates: [],
  signal: AbortSignal.timeout(5000),
};
for (const [provider, factory] of [
  ["mistral", mistral],
  ["openrouter", openrouter],
]) {
  test(`${provider} requires explicit configuration and protects complete request bounds`, async () => {
    assert.throws(
      () => factory({ apiKey: "", model: "model" }),
      (e) => e.code === "MODEL_UNAVAILABLE",
    );
    assert.throws(
      () => factory({ apiKey: "fake", model: "../../other" }),
      (e) => e.code === "INVALID_INPUT",
    );
    const a = factory({
      apiKey: "fictional-canary",
      model: "pinned-model",
      fetch: () => {
        throw Error("Must not call oversized request");
      },
    });
    await assert.rejects(
      a.extract({ ...task, text: "x".repeat(20000) }),
      (e) => e.code === "BUDGET_EXHAUSTED",
    );
  });
  test(`${provider} preserves schema, usage and route metadata with no fallback`, async () => {
    const a = factory({
      apiKey: "fictional-canary",
      model: "pinned-model",
      fetch: async (url, init) => {
        assert.ok(!url.includes("fictional-canary"));
        assert.equal(init.headers.authorization, "Bearer fictional-canary");
        const b = JSON.parse(init.body);
        assert.equal(b.max_tokens, 4096);
        assert.equal(b.response_format.type, "json_schema");
        assert.equal(b.response_format.json_schema.strict, true);
        const variants =
          b.response_format.json_schema.schema.properties.entities.items.anyOf;
        const person = variants.find(
          (v) => v.properties.conceptId.enum[0] === "person",
        );
        assert.equal(person.properties.existingId, undefined);
        assert.deepEqual(
          person.properties.fields.properties.name.properties.quote.enum,
          [task.text],
        );
        if (provider === "openrouter") {
          assert.equal(b.provider.require_parameters, true);
          assert.equal(b.provider.allow_fallbacks, false);
        }
        return Response.json({
          model: "pinned-model",
          provider: "fixed-route",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  entities: [],
                  relationships: [],
                  observations: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, total_tokens: 20 },
        });
      },
    });
    const result = await a.extract(task);
    assert.equal(result.usage.total_tokens, 20);
    assert.equal(result.usage.provider, "fixed-route");
  });
  test(`${provider} rejects refusal, truncation, malformed and oversized responses with available accounting`, async () => {
    for (const [finish, content] of [
      ["length", "{}"],
      ["stop", "not json"],
      ["content_filter", "{}"],
    ]) {
      const a = factory({
        apiKey: "fake",
        model: "fixed",
        fetch: async () =>
          Response.json({
            choices: [{ finish_reason: finish, message: { content } }],
            usage: { total_tokens: 77 },
          }),
      });
      await assert.rejects(
        a.extract(task),
        (e) =>
          e.code === "INVALID_MODEL_OUTPUT" &&
          e.details.usage.total_tokens === 77,
      );
    }
    const a = factory({
      apiKey: "fake",
      model: "fixed",
      fetch: async () => new Response("x".repeat(2097153)),
    });
    await assert.rejects(
      a.extract(task),
      (e) => e.code === "INVALID_MODEL_OUTPUT",
    );
  });
  test(`${provider} redacts upstream error bodies and marks retryable HTTP states`, async () => {
    for (const status of [400, 401, 402, 429, 503]) {
      const a = factory({
        apiKey: "fake",
        model: "fixed",
        fetch: async () => new Response("private response and key", { status }),
      });
      await assert.rejects(
        a.extract(task),
        (e) =>
          !e.message.includes("private") &&
          e.retryable === (status === 429 || status >= 500),
      );
    }
  });
}
