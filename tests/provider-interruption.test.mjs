import test from "node:test";
import assert from "node:assert/strict";
import { starter } from "../dist/index.js";
import { gemini } from "../dist/models/gemini.js";
import { groq } from "../dist/models/groq.js";
import { mistral } from "../dist/models/mistral.js";
import { openrouter } from "../dist/models/openrouter.js";
const task = {
  text: "Asha",
  ontology: starter,
  candidates: [],
  signal: AbortSignal.timeout(5000),
};
for (const [name, factory] of [
  ["Gemini", gemini],
  ["Groq", groq],
  ["Mistral", mistral],
  ["OpenRouter", openrouter],
]) {
  test(`${name} never salvages an interrupted response or exposes its transport exception`, async () => {
    let pulls = 0;
    const adapter = factory({
      apiKey: "fixture-only-canary",
      model: "fixed",
      fetch: async (url) => {
        if (url.endsWith(":countTokens"))
          return Response.json({ totalTokens: 100 });
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (pulls++ === 0)
                controller.enqueue(new TextEncoder().encode('{"entities":[]'));
              else
                controller.error(
                  Error("fixture-only-canary private evidence text"),
                );
            },
          }),
        );
      },
    });
    await assert.rejects(
      adapter.extract(task),
      (e) =>
        e.code === "MODEL_UNAVAILABLE" &&
        e.retryable &&
        e.details.outcome === "transport_failed" &&
        e.details.usage === undefined &&
        !JSON.stringify(e).includes("canary") &&
        !e.message.includes("private"),
    );
  });
}
