import { OntaveError } from "../core.js";

/** Bound buffered responses and keep transport exceptions out of diagnostics. */
export async function providerJson(
  response: Response,
  model: string,
): Promise<any> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2097152) {
          await reader.cancel().catch(() => {});
          throw new OntaveError(
            "INVALID_MODEL_OUTPUT",
            "Provider response exceeds 2 MiB",
            false,
            { model, outcome: "oversized" },
          );
        }
        chunks.push(chunk.value);
      }
  } catch (error) {
    if (error instanceof OntaveError) throw error;
    throw new OntaveError(
      "MODEL_UNAVAILABLE",
      "Provider response was interrupted; usage is unknown",
      true,
      { model, outcome: "transport_failed" },
    );
  } finally {
    reader?.releaseLock();
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (data === null || typeof data !== "object" || Array.isArray(data))
      throw Error();
    return data;
  } catch {
    throw new OntaveError(
      "INVALID_MODEL_OUTPUT",
      "Provider response is malformed JSON",
      false,
      { model, outcome: "malformed" },
    );
  }
}
