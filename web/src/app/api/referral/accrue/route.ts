import { z } from "zod";
import { requireFeature } from "@/lib/features";
import { ok, readJson, route } from "@/lib/http";
import { requireAdminOrCron } from "@/lib/modules/cron";
import { accrue } from "@/lib/modules/referral";

/** Record referral-driven activity (USDC). Admin session or x-cron-secret. Fraud limits apply. */
export const POST = route(async (req: Request) => {
  requireFeature("referral");
  await requireAdminOrCron(req);
  const { refereeId, activity } = z
    .object({ refereeId: z.string().min(1), activity: z.number().positive().finite() })
    .parse(await readJson(req));
  return ok(await accrue(refereeId, activity));
});
