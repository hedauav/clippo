import { requireFeature } from "@/lib/features";
import { ok, route } from "@/lib/http";
import { requireAdminOrCron } from "@/lib/modules/cron";
import { recomputeStatus } from "@/lib/modules/ladder";

/** Recompute stored tiers for all creators. Admin session or x-cron-secret. */
export const POST = route(async (req: Request) => {
  requireFeature("statusLadder");
  await requireAdminOrCron(req);
  return ok(await recomputeStatus());
});
