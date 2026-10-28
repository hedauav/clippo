import { requireFeature } from "@/lib/features";
import { ok, route } from "@/lib/http";
import { REQUIREMENTS, TIERS } from "@/lib/modules/ladder";

export const GET = route(async () => {
  requireFeature("statusLadder");
  return ok({ tiers: TIERS.map((t) => ({ tier: t, requirements: REQUIREMENTS[t] })) });
});
