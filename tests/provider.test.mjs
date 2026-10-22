import test from "node:test";
import assert from "node:assert/strict";
import { gemini } from "../dist/models/gemini.js";
import { starter } from "../dist/index.js";
const task = {
  text: "Rahul",
  ontology: starter,
  candidates: [],
  signal: new AbortController().signal,
};
test("Gemini adapter validates explicit configuration without reading environment", () => {
  assert.throws(() => gemini({ apiKey: "", model: "x" }));
  assert.throws(() => gemini({ apiKey: "secret", model: "../x" }));
});
test("Gemini HTTP contract sends bounded schema and does not place key in URL", async () => {
  let calls = 0;
  const adapter = gemini({
    apiKey: "test-secret",
    model: "test-model",
    fetch: async (url, init) => {
      calls++;
      assert.ok(!url.includes("test-secret"));
      assert.equal(init.headers["x-goog-api-key"], "test-secret");
      const body = JSON.parse(init.body);
      if (url.endsWith(":countTokens")) {
        assert.equal(body.generateContentRequest.model, "models/test-model");
        assert.ok(
          body.generateContentRequest.generationConfig.responseJsonSchema,
        );
        return Response.json({ totalTokens: 123 });
      }
      assert.equal(body.generationConfig.maxOutputTokens, 4096);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      entities: [],
                      relationships: [],
                      observations: [],
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 12 },
        }),
      );
    },
  });
  assert.equal(calls, 0);
  const result = await adapter.extract(task);
  assert.equal(result.model, "test-model");
  assert.equal(result.usage.totalTokenCount, 12);
  assert.equal(calls, 2);
});
for (const reason of ["MAX_TOKENS", "SAFETY", "RECITATION"])
  test(`Gemini ${reason} output cannot become successful extraction`, async () => {
    const model = gemini({
      apiKey: "not-real",
      model: "test",
      fetch: async (url) =>
        url.endsWith(":countTokens")
          ? Response.json({ totalTokens: 123 })
          : new Response(
              JSON.stringify({
                candidates: [
                  {
                    finishReason: reason,
                    content: { parts: [{ text: "{}" }] },
                  },
                ],
              }),
            ),
    });
    await assert.rejects(
      model.extract(task),
      (e) => e.code === "INVALID_MODEL_OUTPUT",
    );
  });
test("Gemini errors redact provider response and classify retryable limits", async () => {
  const model = gemini({
    apiKey: "not-real",
    model: "test",
    fetch: async () =>
      new Response("private source and secret", { status: 429 }),
  });
  await assert.rejects(
    model.extract(task),
    (e) => e.retryable && !e.message.includes("private"),
  );
});

test("Groq uses explicit JSON mode and rejects incomplete or private provider error output", async () => {
  const { groq } = await import("../dist/models/groq.js");
  let count = 0;
  const model = groq({
    apiKey: "test-secret",
    model: "test/model",
    fetch: async (url, init) => {
      count++;
      assert.ok(!url.includes("test-secret"));
      assert.equal(init.headers.authorization, "Bearer test-secret");
      const request = JSON.parse(init.body);
      assert.equal(request.response_format.type, "json_object");
      assert.equal(request.max_completion_tokens, 4096);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: '{"entities":[],"relationships":[],"observations":[]}',
              },
            },
          ],
          usage: { total_tokens: 12 },
        }),
      );
    },
  });
  assert.equal(count, 0);
  assert.equal((await model.extract(task)).usage.total_tokens, 12);
  for (const finish of ["length", "content_filter"]) {
    const bad = groq({
      apiKey: "test-secret",
      model: "test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: finish, message: { content: "{}" } }],
          }),
        ),
    });
    await assert.rejects(
      bad.extract(task),
      (e) => e.code === "INVALID_MODEL_OUTPUT",
    );
  }
  const limited = groq({
    apiKey: "secret",
    model: "test",
    fetch: async () => new Response("private", { status: 429 }),
  });
  await assert.rejects(
    limited.extract(task),
    (e) => e.retryable && !e.message.includes("private"),
  );
});

test("Gemini token preflight rejects over-budget and malformed counts before inference", async () => {
  for (const totalTokens of [16385, -1, 3.5, null]) {
    let calls = 0;
    const model = gemini({
      apiKey: "test",
      model: "test",
      fetch: async (url) => {
        calls++;
        assert.ok(url.endsWith(":countTokens"));
        return Response.json({ totalTokens });
      },
    });
    await assert.rejects(model.extract(task), (e) =>
      ["BUDGET_EXHAUSTED", "INVALID_MODEL_OUTPUT"].includes(e.code),
    );
    assert.equal(calls, 1);
  }
});
test("Gemini preflight boundary is inclusive and custom lower limit is enforced", async () => {
  let inference = 0;
  const model = gemini({
    apiKey: "test",
    model: "test",
    maxInputTokens: 100,
    fetch: async (url) => {
      if (url.endsWith(":countTokens"))
        return Response.json({ totalTokens: 100 });
      inference++;
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: '{"entities":[],"relationships":[],"observations":[]}',
                },
              ],
            },
          },
        ],
      });
    },
  });
  assert.equal((await model.extract(task)).usage.preflightInputTokens, 100);
  assert.equal(inference, 1);
  assert.throws(() =>
    gemini({ apiKey: "test", model: "test", maxInputTokens: 16385 }),
  );
});

test("Gemini schema binds short source anchors, concept fields and authorized ID choices", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const a = gemini({
    apiKey: "fake",
    model: "test",
    fetch: async (url, init) => {
      const body = JSON.parse(init.body),
        schema = (body.generateContentRequest ?? body).generationConfig
          .responseJsonSchema;
      const person = schema.properties.entities.items.anyOf.find(
        (v) => v.properties.conceptId.enum[0] === "person",
      );
      assert.deepEqual(person.properties.existingId.enum, [id]);
      assert.equal(person.properties.fields.properties.amount, undefined);
      assert.deepEqual(
        person.properties.fields.properties.name.properties.quote.enum,
        [task.text],
      );
      assert.deepEqual(
        person.properties.fields.properties.name.properties.occurrence.enum,
        [0],
      );
      if (url.endsWith(":countTokens"))
        return Response.json({ totalTokens: 100 });
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: '{"entities":[],"relationships":[],"observations":[]}',
                },
              ],
            },
          },
        ],
      });
    },
  });
  await a.extract({
    ...task,
    candidates: [{ id, name: "Rahul", conceptId: "person" }],
  });
});
