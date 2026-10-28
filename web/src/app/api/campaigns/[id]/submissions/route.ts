import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageCampaign, getCampaign, type Ctx } from "@/lib/domain";
import { ok, route } from "@/lib/http";

/** Submissions for a campaign. Campaigner/admin see all; a creator sees only their own. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req);
  const c = await getCampaign((await params).id);
  const manage = canManageCampaign(user, c);
  const submissions = await db.submission.findMany({
    where: { campaignId: c.id, ...(manage ? {} : { creatorId: user.id }) },
    orderBy: { createdAt: "desc" },
    include: { verdict: true, creator: { select: { id: true, wallet: true } } },
  });
  return ok({ submissions });
});
