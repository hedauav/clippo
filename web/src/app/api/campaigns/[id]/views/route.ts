import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { campaignViewHistory } from "@/lib/workspace/marketplace";

/** Daily cumulative views history (from ViewSnapshot, approved clips) for a visible campaign: [{day, views, dailyViews, clips}]. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const user = await getUser(req);
  const c = await db.campaign.findUnique({ where: { id } });
  const visible = c && (c.status === "APPROVED" || c.status === "CLOSED" || (user && canManageCampaign(user, c)));
  if (!c || !visible) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  const points = await campaignViewHistory(c.id);
  return ok({ campaignId: c.id, points, totalViews: points.at(-1)?.views ?? 0 });
});
