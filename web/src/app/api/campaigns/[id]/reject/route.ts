import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { STATE } from "@/lib/chain/escrow";
import { assertOnchainState, chainMode } from "@/lib/chain/guards";
import { db } from "@/lib/db";
import { campaignView, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";

const body = z.object({ reason: z.string().min(1).max(1000), txHash: z.string().max(100).optional() });

/**
 * Admin rejects a DRAFT/FUNDED campaign. A funded campaign is refunded IN FULL (pool + campaigner fee) by the escrow's
 * `rejectCampaign`; with a configured chain that on-chain call must already have happened (optionally pass its `txHash`).
 * A DRAFT (never funded) is rejected in the database only.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  await requireUser(req, ["ADMIN"]);
  const c = await getCampaign((await params).id);
  const { reason, txHash } = body.parse(await readJson(req));
  if (c.status !== "FUNDED" && c.status !== "DRAFT" && !(c.status === "REJECTED" && chainMode() === "chain")) {
    throw new ApiError(409, "BAD_STATE", `Campaign is ${c.status}, expected FUNDED or DRAFT`);
  }
  if (c.onchainId) await assertOnchainState(c, STATE.Rejected, txHash);
  const updated = await db.campaign.update({ where: { id: c.id }, data: { status: "REJECTED", rejectReason: reason } });
  return ok({
    campaign: campaignView(updated),
    refund: c.onchainId ? { amount: c.grossFunded ?? c.poolSize, includesFee: true, onchain: chainMode() === "chain" } : null,
  });
});
