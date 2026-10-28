import { requireUser } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { ok, route } from "@/lib/http";
import { summary } from "@/lib/modules/referral";

export const GET = route(async (req: Request) => {
  requireFeature("referral");
  const user = await requireUser(req, ["CREATOR"]);
  return ok(await summary(user.id));
});
