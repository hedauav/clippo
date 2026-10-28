import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { STATE } from "@/lib/chain/escrow";
import { assertOnchainState, chainMode } from "@/lib/chain/guards";
import { db } from "@/lib/db";
import { campaignView, canManageCampaign, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";

const body = z.object({ txHash: z.string().max(100).optional() }).default({});

/**
 * Campaigner (or admin) closes an APPROVED campaign; unspent funds are reclaimed on-chain by the escrow.
 * With a configured chain the on-chain `closeCampaign` must already have happened (optionally pass its `txHash`).
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const c = await getCampaign((await params).id);
  if (!canManageCampaign(user, c)) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  const raw = await req.text();
  const { txHash } = body.parse(raw ? JSON.parse(raw) : {});
  if (c.status !== "APPROVED" && !(c.status === "CLOSED" && chainMode() === "chain")) {
    throw new ApiError(409, "BAD_STATE", `Campaign is ${c.status}, expected APPROVED`);
  }
  if (c.onchainId) await assertOnchainState(c, STATE.Closed, txHash);
  const updated = await db.campaign.update({ where: { id: c.id }, data: { status: "CLOSED" } });
  return ok({ campaign: campaignView(updated) });
});
