import "server-only";
import type { Ontave } from "ontave";

/** Wire these dependencies from your own authenticated server modules. */
export function ingestRoute(
  runtime: Ontave,
  getSession: (request: Request) => Promise<unknown | null>,
) {
  return async function POST(request: Request): Promise<Response> {
    const session = await getSession(request);
    if (!session)
      return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
    }
    if (
      !body ||
      Object.keys(body).some(
        (key) =>
          !["source", "idempotencyKey", "payload", "metadata"].includes(key),
      )
    ) {
      return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
    }
    // runtime.authorize must independently resolve this server session's grants.
    try {
      const receipt = await runtime.ingest(session, body);
      return Response.json(receipt, { status: 202 });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "INVALID_INPUT";
      const status =
        code === "IDEMPOTENCY_CONFLICT"
          ? 409
          : code === "FORBIDDEN"
            ? 403
            : 400;
      return Response.json({ code }, { status });
    }
  };
}
