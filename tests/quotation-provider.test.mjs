import test from "node:test";
import assert from "node:assert/strict";
import { quotationExtractor } from "../examples/supplier-quotes/provider.mjs";
const key = "fictional-quotation-provider-secret-canary";
test("shared extractor counts the complete request, sends source only and makes no hidden retries", async () => {
  const requests = [];
  const extract = quotationExtractor({
    apiKey: key,
    model: "fictional-model",
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return Response.json(
        url.endsWith(":countTokens")
          ? { totalTokens: 17 }
          : {
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    parts: [{ text: '{"records":[],"observations":[]}' }],
                  },
                },
              ],
              usageMetadata: { totalTokenCount: 20 },
            },
      );
    },
  });
  const result = await extract("No quotation is provided.");
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests[0].body.generateContentRequest.contents,
    requests[1].body.contents,
  );
  assert.deepEqual(
    requests[0].body.generateContentRequest.generationConfig,
    requests[1].body.generationConfig,
  );
  assert.ok(!JSON.stringify(requests).includes(key));
  assert.deepEqual(result.output, { records: [], observations: [] });
  assert.equal(result.usage.preflightInputTokens, 17);
});
test("shared extractor distinguishes permanent errors, bounded Retry-After and credential-safe transport failures", async () => {
  for (const [status, header, retryable] of [
    [400, "", false],
    [503, "not-a-delay", true],
    [429, "999", true],
  ]) {
    let calls = 0;
    const extract = quotationExtractor({
      apiKey: key,
      model: "fictional",
      fetch: async () => {
        calls++;
        return new Response("{}", {
          status,
          headers: { "retry-after": header },
        });
      },
    });
    await assert.rejects(
      extract("source"),
      (e) =>
        e.retryable === retryable &&
        Number.isFinite(e.retryAfterMs) &&
        e.retryAfterMs <= 30000,
    );
    assert.equal(calls, 1);
  }
  const extract = quotationExtractor({
    apiKey: key,
    model: "fictional",
    fetch: async () => {
      throw Error("request failed " + key);
    },
  });
  await assert.rejects(
    extract("source"),
    (e) => e.retryable && !e.message.includes(key),
  );
});
test("shared extractor rejects oversized or malformed responses and preserves interrupted transport classification", async () => {
  const oversized = quotationExtractor({
    apiKey: key,
    model: "fictional",
    fetch: async () => new Response(" ".repeat(2097153)),
  });
  await assert.rejects(
    oversized("source"),
    (e) => e.message === "PROVIDER_RESPONSE_TOO_LARGE",
  );
  const malformed = quotationExtractor({
    apiKey: key,
    model: "fictional",
    fetch: async () => new Response("not json"),
  });
  await assert.rejects(
    malformed("source"),
    (e) => e.message === "PROVIDER_RESPONSE_INVALID_JSON",
  );
  const interrupted = quotationExtractor({
    apiKey: key,
    model: "fictional",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("{"));
            c.error(Error(key));
          },
        }),
      ),
  });
  await assert.rejects(
    interrupted("source"),
    (e) => e.message === "PROVIDER_RESPONSE_INTERRUPTED" && e.retryable,
  );
});
