// Explicit opt-in, fictional input, one provider request maximum.
import { mkdir, writeFile } from "node:fs/promises";
import { gemini } from "../dist/models/gemini.js";
import { groq } from "../dist/models/groq.js";
import { starter } from "../dist/index.js";
import { validateExtraction } from "../dist/core.js";
process.loadEnvFile(".env");
const provider = process.argv.includes("--groq") ? "groq" : "gemini";
const model =
  provider === "groq"
    ? groq({ apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL })
    : gemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
      });
const text = "Rahul Sharma. Email: rahul.sharma@example.test.";
try {
  const start = Date.now();
  const result = await model.extract({
    text,
    ontology: starter,
    candidates: [],
    signal: AbortSignal.timeout(45000),
  });
  await writeFile(
    `artifacts/live-provider-raw-${provider}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  const extraction = validateExtraction(result.output, text, starter);
  const report = {
    mode: "one-call live provider smoke check; not a semantic release trial",
    model: result.model,
    durationMs: Date.now() - start,
    usage: result.usage,
    extraction,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    `artifacts/live-smoke-${provider}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: true,
      model: result.model,
      entities: extraction.entities.length,
      observations: extraction.observations.length,
      usage: result.usage,
    }),
  );
} catch (e) {
  const report = {
    ok: false,
    code: e.code ?? "OPERATION_FAILED",
    message: e.message,
  };
  await writeFile(
    `artifacts/live-smoke-${provider}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  process.exitCode = 1;
}
