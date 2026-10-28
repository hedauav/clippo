import { requireFeature } from "@/lib/features";
import { ok, route } from "@/lib/http";
import { requireAdminOrCron } from "@/lib/modules/cron";
import { syncProfiles } from "@/lib/modules/profile";

/** Sync opted-in creators' track records. Admin session or x-cron-secret. */
export const POST = route(async (req: Request) => {
  requireFeature("tokenization");
  await requireAdminOrCron(req);
  return ok(await syncProfiles());
});
