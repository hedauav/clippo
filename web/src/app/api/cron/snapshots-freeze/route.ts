import { ok, route } from "@/lib/http";
import { requireCron } from "@/lib/modules/cron";
import { frozenSnapshot, refreshSnapshots } from "@/lib/snapshots";

/**
 * Daily ~00:10 UTC (before the CRE schedule): refresh the new day's views, then compute the frozen snapshot of the last completed
 * UTC day. The frozen feed is derived deterministically from stored snapshots (GET /api/snapshots/daily), so nothing else needs persisting;
 * this returns its day, hash and row count for the cron log.
 */
export const GET = route(async (req: Request) => {
  requireCron(req);
  const refresh = await refreshSnapshots();
  const snap = await frozenSnapshot();
  return ok({ refresh, frozen: { day: snap.day, hash: snap.hash, rows: snap.rows.length } });
});
