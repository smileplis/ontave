import { getRuntime } from "../../../lib/runtime";
import { session } from "../../../lib/session";
import { ingestRoute } from "../../../route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const credential = session(request);
  if (!credential)
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  return ingestRoute(getRuntime(), async () => credential)(request);
}
