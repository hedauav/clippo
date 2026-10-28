import { requireUser } from "@/lib/auth";
import { getCampaign, type Ctx } from "@/lib/domain";
import { ok, route } from "@/lib/http";
import { campaignEligibility } from "@/lib/workspace/eligibility";

/** Can the signed-in creator submit to this campaign? Explains why not. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CREATOR"]);
  const c = await getCampaign((await params).id);
  return ok(await campaignEligibility(user, c));
});
