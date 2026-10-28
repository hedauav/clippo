import { isEnabled } from "@/lib/features";
import { ok, route } from "@/lib/http";
import { requireCron } from "@/lib/modules/cron";
import { recomputeStatus } from "@/lib/modules/ladder";

/** Vercel Cron: recompute creator status tiers. A no-op unless FEATURE_STATUS_LADDER is on. */
export const GET = route(async (req: Request) => {
  requireCron(req);
  if (!isEnabled("statusLadder")) return ok({ skipped: true, reason: "FEATURE_STATUS_LADDER is off" });
  return ok(await recomputeStatus());
});
