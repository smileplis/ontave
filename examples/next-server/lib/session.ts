import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
export const localOwner = Symbol("authenticated local demo owner");
// Explicit single-owner development credential. Replace with the host's real session system.
export function session(request: Request): typeof localOwner | null {
  const expected = process.env.ONTAVE_LOCAL_TOKEN;
  if (!expected || expected.length < 32) return null;
  const supplied = request.headers.get("authorization") ?? "";
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256")
      .update("Bearer " + expected)
      .digest(),
  )
    ? localOwner
    : null;
}
