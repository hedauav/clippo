import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { dealTerms, dealView, findDeal, sideOf } from "@/lib/deals";
import { db } from "@/lib/db";
import { getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { notify } from "@/lib/notify";

const body = z.object({ creatorId: z.string().optional() });

/** Either side declines the negotiation. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CREATOR", "CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  const v = body.parse(await readJson(req).catch(() => ({})));
  const deal = await findDeal(user, c, v.creatorId);
  if (!deal) throw new ApiError(404, "NOT_FOUND", "No deal found");
  const side = sideOf(user, deal);
  if (deal.status === "ACCEPTED" || deal.status === "DECLINED") throw new ApiError(409, "BAD_STATE", `Deal is already ${deal.status}`);
  const updated = await db.deal.update({ where: { id: deal.id }, data: { status: "DECLINED", creatorAccepted: false, campaignerAccepted: false } });
  await notify({
    userId: side === "creator" ? deal.campaignerId : deal.creatorId,
    type: "DEAL_DECLINED",
    title: `Deal declined on "${c.title}"`,
    body: "The other side declined the negotiation.",
    refType: "deal",
    refId: deal.id,
  });
  return ok({ deal: await dealView(updated, c, await dealTerms(c.id), side) });
});
