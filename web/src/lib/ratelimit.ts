import { db } from "./db";
import { ApiError } from "./http";

/**
 * Fixed-window rate limiter backed by Postgres (works across serverless instances; no Redis needed for a test deploy).
 * One atomic upsert per check. Keyed by client IP (Vercel sets x-forwarded-for / x-real-ip itself, so it cannot be spoofed
 * through the edge) plus an optional user id.
 *
 * Active when NODE_ENV=production or RATE_LIMIT=1; off in dev/tests unless forced. RATE_LIMIT=0 disables it.
 * Fails OPEN if the database errors (an outage must not turn into a second outage), but logs.
 */
export const rateLimitActive = () => {
  const f = process.env.RATE_LIMIT?.trim();
  if (f === "0") return false;
  return f === "1" || process.env.NODE_ENV === "production";
};

export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export async function rateLimit(req: Request, name: string, limit: number, windowSec: number, userId?: string): Promise<void> {
  if (!rateLimitActive()) return;
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const key = `${name}:${userId ?? clientIp(req)}`.slice(0, 200);
  let count: number;
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"`;
    count = Number(rows[0]?.count ?? 1);
    // opportunistic cleanup (~1% of calls)
    if (Math.random() < 0.01) void db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now - 24 * 3600_000) } } }).catch(() => {});
  } catch (e) {
    console.error("rate limiter unavailable (failing open)", e);
    return;
  }
  if (count > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
    throw new ApiError(429, "RATE_LIMITED", `Too many requests; retry in ${retryAfter}s`);
  }
}
