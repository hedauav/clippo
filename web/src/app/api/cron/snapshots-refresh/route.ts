import { ok, route } from "@/lib/http";
import { requireCron } from "@/lib/modules/cron";
import { refreshSnapshots } from "@/lib/snapshots";

/**
 * Vercel Cron (GET + `Authorization: Bearer $CRON_SECRET`). Refreshes today's view snapshots. The view-anomaly (fraud) flags and
 * the deleted-clip checks run inside refreshSnapshots, so this one job is also the anomaly/fraud job.
 */
export const GET = route(async (req: Request) => {
  requireCron(req);
  return ok(await refreshSnapshots());
});
