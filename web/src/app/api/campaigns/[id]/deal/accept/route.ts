import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { checkOffer } from "@/lib/agents/negotiator";
import { bandFor, dealTerms, dealView, findDeal, latestOffer, sideOf } from "@/lib/deals";
import { db } from "@/lib/db";
import { getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { notify } from "@/lib/notify";

const body = z.object({ creatorId: z.string().optional() });

/**
 * Accept the latest offer. A deal becomes ACCEPTED only when BOTH the creator and the campaigner have accepted the same
 * latest offer. Accepting records the agreed rate; it does not move or release any funds.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CREATOR", "CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  const v = body.parse(await readJson(req).catch(() => ({})));
  const deal = await findDeal(user, c, v.creatorId);
  if (!deal) throw new ApiError(404, "NOT_FOUND", "No deal yet; make an offer first");
  const side = sideOf(user, deal);
  if (deal.status === "ACCEPTED" || deal.status === "DECLINED") throw new ApiError(409, "BAD_STATE", `Deal is already ${deal.status}`);
  const last = latestOffer(deal);
  if (!last) throw new ApiError(409, "BAD_STATE", "Nothing to accept");
  const terms = await dealTerms(c.id);
  const check = checkOffer(last.rate, bandFor(c, terms), deal.creatorMinRate);
  if (!check.ok) throw new ApiError(409, check.code, check.message);
  const creatorAccepted = side === "creator" ? true : deal.creatorAccepted;
  const campaignerAccepted = side === "campaigner" ? true : deal.campaignerAccepted;
  const both = creatorAccepted && campaignerAccepted;
  const updated = await db.deal.update({
    where: { id: deal.id },
    data: { creatorAccepted, campaignerAccepted, ...(both ? { status: "ACCEPTED", acceptedRate: last.rate } : {}) },
  });
  await notify({
    userId: side === "creator" ? deal.campaignerId : deal.creatorId,
    type: both ? "DEAL_ACCEPTED" : "DEAL_ACCEPT_PENDING",
    title: both ? `Deal agreed on "${c.title}"` : `Offer accepted on "${c.title}"`,
    body: both ? `Agreed rate: $${last.rate.toFixed(2)} per 1K views.` : `The other side accepted $${last.rate.toFixed(2)} per 1K views; your acceptance completes the deal.`,
    refType: "deal",
    refId: deal.id,
  });
  return ok({ deal: await dealView(updated, c, terms, side) });
});
