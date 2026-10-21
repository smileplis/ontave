import { getRuntime } from "../../../../lib/runtime";
import { session } from "../../../../lib/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const credential = session(request);
  if (!credential)
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const job = await getRuntime().jobs.get(credential, (await params).id);
    return Response.json({
      jobId: job.id,
      state: job.state,
      bundleId: job.bundle_id,
      error: job.error,
    });
  } catch {
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  }
}
