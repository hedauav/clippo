import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { STATE } from "@/lib/chain/escrow";
import { assertOnchainState, chainMode } from "@/lib/chain/guards";
import { db } from "@/lib/db";
import { campaignView, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { assertSourceReadyForLaunch } from "@/lib/source";

const body = z.object({ txHash: z.string().max(100).optional() }).default({});

/**
 * Admin approves a FUNDED campaign so creators can join. With a configured chain the on-chain `approveCampaign` must already
 * have happened (optionally pass its `txHash` to index it now). High-value campaigns (pool above the threshold) additionally
 * require a fresh human confirmation: POST /api/campaigns/:id/attest first, then pass the returned attestation on-chain.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  await requireUser(req, ["ADMIN"]);
  const c = await getCampaign((await params).id);
  const raw = await req.text();
  const { txHash } = body.parse(raw ? JSON.parse(raw) : {});
  // AI-generated source: needs rights confirmation + explicit campaigner approval before launch (lib/source.ts)
  if (c.status === "FUNDED") await assertSourceReadyForLaunch(c);

  // the indexer may already have moved the DB state (tx was synced); only treat FUNDED as actionable
  if (chainMode() === "chain") await assertOnchainState(c, STATE.Approved, txHash);
  const cur = await getCampaign(c.id);
  if (cur.status === "APPROVED" && chainMode() === "chain") return ok({ campaign: campaignView(cur) });
  if (cur.status !== "FUNDED") throw new ApiError(409, "BAD_STATE", `Campaign is ${cur.status}, expected FUNDED`);

  if (cur.highValue) {
    const att = await db.humanAttestation.findFirst({ where: { campaignId: cur.id, kind: "APPROVE" }, orderBy: { createdAt: "desc" } });
    if (!att) {
      throw new ApiError(428, "HUMAN_CONFIRMATION_REQUIRED", "High-value campaign: POST /api/campaigns/:id/attest with a fresh World ID proof first");
    }
    if (chainMode() === "chain" && cur.approvalAttestation?.toLowerCase() !== att.attestation.toLowerCase()) {
      throw new ApiError(409, "ATTESTATION_MISMATCH", "The on-chain approval attestation does not match the recorded human confirmation");
    }
  }
  const updated = await db.campaign.update({ where: { id: cur.id }, data: { status: "APPROVED", rejectReason: null, adminReviewReason: null } });
  return ok({ campaign: campaignView(updated) });
});
