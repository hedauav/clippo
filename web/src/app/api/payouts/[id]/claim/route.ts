import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { publicChainConfig } from "@/lib/chain/config";
import { claimPreview, getPlatformFees } from "@/lib/chain/fees";
import { chainMode } from "@/lib/chain/guards";
import { processReceipt } from "@/lib/chain/indexer";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { assertVerifiedHuman } from "@/lib/worldid/signup";

const body = z.object({ txHash: z.string().max(100).optional() }).default({});

async function loadOwn(req: Request, id: string) {
  const user = await requireUser(req, ["CREATOR"]);
  const p = await db.payout.findUnique({ where: { id }, include: { campaign: true } });
  if (!p || p.creatorId !== user.id) throw new ApiError(404, "NOT_FOUND", "Payout not found");
  return { user, p };
}

/**
 * Claim preview `[creator owner]`: gross, the creator-side platform fee (campaign snapshot, else current), net, whether it is
 * claimable now (PER_VIEW retention window, freeze) and the on-chain call to make (`claim(onchainId)`).
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { p } = await loadOwn(req, (await params).id);
  const fees = await getPlatformFees();
  const creatorBps = p.campaign.creatorFeeBps ?? fees.creatorBps;
  const outstanding = Math.max(0, p.amount - p.claimedAmount);
  const now = Date.now();
  const matured = !p.releaseAt || p.releaseAt.getTime() <= now;
  return ok({
    payout: p,
    preview: claimPreview(outstanding, creatorBps),
    claimable: p.status === "PENDING" && !p.frozen && matured && outstanding > 0,
    frozen: p.frozen,
    frozenReason: p.frozenReason,
    releaseAt: p.releaseAt,
    retentionDays: fees.retentionDays,
    chain: publicChainConfig(),
    onchain: p.campaign.onchainId ? { functionName: "claim", args: [p.campaign.onchainId] } : null,
  });
});

/**
 * Record a claim. With a configured chain, `txHash` is required and verified: the receipt must be successful and contain a
 * `Claimed` event from the escrow for this payout's campaign and the signed-in creator's wallet; amounts come from the event.
 * Frozen payouts (deleted clip / fraud hold) are refused.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { user, p } = await loadOwn(req, (await params).id);
  assertVerifiedHuman(user, "claims");
  const raw = await req.text();
  const { txHash } = body.parse(raw ? JSON.parse(raw) : {});
  if (p.frozen) throw new ApiError(409, "PAYOUT_FROZEN", p.frozenReason ?? "This payout is frozen pending review");
  if (p.status === "CLAIMED") throw new ApiError(409, "BAD_STATE", "Already claimed");

  chainMode();

  if (!txHash) throw new ApiError(400, "BAD_REQUEST", "txHash of the claim transaction is required");
  if (!p.campaign.onchainId) throw new ApiError(409, "NOT_FUNDED_ONCHAIN", "Campaign has no on-chain escrow");
  const { logs } = await processReceipt(txHash);
  const mine = logs.find(
    (l) =>
      l.eventName === "Claimed" &&
      String((l.args as Record<string, unknown>).campaignId) === p.campaign.onchainId &&
      String((l.args as Record<string, unknown>).creator).toLowerCase() === user.wallet,
  );
  if (!mine) throw new ApiError(422, "CLAIM_NOT_VERIFIED", "No Claimed event for your wallet and this campaign in that transaction");
  const updated = await db.payout.findUniqueOrThrow({ where: { id: p.id } });
  return ok({ payout: updated, verified: true });
});
