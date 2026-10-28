import { timingSafeEqual } from "node:crypto";
import { getUser } from "../auth";
import { ApiError } from "../http";

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * True when the request carries CRON_SECRET: `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends) or the legacy
 * `x-cron-secret` header (CRE / scripts). Always false when CRON_SECRET is unset, so an unset secret can never open the door.
 */
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && safeEq(auth.slice(7), secret)) return true;
  const hdr = req.headers.get("x-cron-secret");
  return !!hdr && safeEq(hdr, secret);
}

/** Cron-only (no admin session): used by GET /api/cron/*. */
export function requireCron(req: Request): void {
  if (!isCronRequest(req)) throw new ApiError(401, "UNAUTHENTICATED", "Cron secret required (Authorization: Bearer $CRON_SECRET)");
}

/** Admin session or the cron secret. */
export async function requireAdminOrCron(req: Request) {
  if (isCronRequest(req)) return;
  const user = await getUser(req);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Admin session or cron secret required");
  if (user.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Admin only");
}
