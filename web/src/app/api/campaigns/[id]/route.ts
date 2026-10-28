import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaignView, canManageCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { latestPerSubmission } from "@/lib/snapshots";

export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const user = await getUser(req);
  const c = await db.campaign.findUnique({
    where: { id },
    include: { _count: { select: { submissions: true } }, campaigner: { select: { id: true, wallet: true, verified: true } } },
  });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  const visible = c.status === "APPROVED" || c.status === "CLOSED" || (user && canManageCampaign(user, c));
  if (!visible) throw new ApiError(404, "NOT_FOUND", "Campaign not found");

  const snaps = (await latestPerSubmission()).filter((s) => s.campaignId === c.id);
  const totalViews = snaps.reduce((n, s) => n + s.cumulativeViews, 0);
  const approvedClips = await db.verdict.count({ where: { result: "APPROVE", submission: { campaignId: c.id } } });
  const { campaigner, ...rest } = c;
  return ok({
    campaign: campaignView(rest),
    campaigner,
    performance: { totalViews, approvedClips, viewTarget: c.viewTarget },
  });
});
