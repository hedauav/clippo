import { ok, route } from "@/lib/http";
import { requireAdminOrCron } from "@/lib/modules/cron";
import { refreshSnapshots } from "@/lib/snapshots";

/** Refresh today's view snapshots. Admin session, `Authorization: Bearer $CRON_SECRET` or `x-cron-secret: $CRON_SECRET`. */
export const POST = route(async (req: Request) => {
  await requireAdminOrCron(req);
  return ok(await refreshSnapshots());
});
