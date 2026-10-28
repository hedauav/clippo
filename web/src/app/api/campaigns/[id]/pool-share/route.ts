import { requireUser } from "@/lib/auth";
import { canManageCampaign, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { poolShareWeights } from "@/lib/poolshare";

/**
 * POOL_SHARE weights `[campaigner owner|admin]`: each creator's share of verified views or of approved clips (the campaigner's
 * `poolShareBasis`) and the exact `setWeights` arguments for the escrow. A human wallet sends that transaction; nothing here
 * moves money. The whole pool is then divided pro rata by `closeCampaign`.
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const c = await getCampaign((await params).id);
  if (!canManageCampaign(user, c)) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  if (c.payoutMode !== "POOL_SHARE") throw new ApiError(409, "BAD_STATE", "Campaign is not POOL_SHARE");
  if (c.status !== "APPROVED") throw new ApiError(409, "BAD_STATE", `Campaign is ${c.status}, expected APPROVED`);
  const w = await poolShareWeights(c);
  const valid = w.weights.filter((x) => !w.skippedNonAddress.includes(x.creatorWallet));
  return ok({
    campaignId: c.id,
    basis: w.basis,
    totalWeight: w.totalWeight,
    weights: w.weights,
    onchain: c.onchainId
      ? { functionName: "setWeights", args: { id: c.onchainId, creators: valid.map((x) => x.creatorWallet), weights: valid.map((x) => String(x.weight)) } }
      : null,
  });
});
