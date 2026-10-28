import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { publicChainConfig } from "@/lib/chain/config";
import { fundPreview, getPlatformFees } from "@/lib/chain/fees";
import { chainMode } from "@/lib/chain/guards";
import { metadataUriFor, processReceipt } from "@/lib/chain/indexer";
import { toUnits } from "@/lib/chain/units";
import { campaignView, getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";

const MODE_INDEX = { PER_VIEW: 0, HUMAN_SPLIT: 1, POOL_SHARE: 2 } as const;
const DEFAULT_DEADLINE_DAYS = 30;

async function ownedDraftOrFunded(req: Request, id: string) {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const c = await getCampaign(id);
  if (c.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  return { user, c };
}

/**
 * Fund preview `[campaigner, owner]`: platform fee, net pool, high-value flag and the exact arguments for
 * the on-chain `approve USDC` + `createCampaign` calls (see lib/chain/client.ts).
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { c } = await ownedDraftOrFunded(req, (await params).id);
  const fees = await getPlatformFees();
  const preview = fundPreview(c.poolSize, fees.campaignerBps, fees.highValueThresholdUsdc);
  const cfg = publicChainConfig();
  return ok({
    campaign: campaignView(c),
    preview,
    fees,
    chain: cfg,
    createCampaignArgs: {
      mode: MODE_INDEX[c.payoutMode],
      ratePer1kViews: toUnits(c.ratePer1k ?? 0).toString(),
      poolAmount: toUnits(c.poolSize).toString(),
      deadline: Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_DAYS * 86400,
      requireAdminApproval: c.approver === "CAMPAIGNER_AND_ADMIN",
      metadataURI: metadataUriFor(c.id),
    },
  });
});

const body = z.object({
  txHash: z.string().max(100).optional(),
});

/**
 * Record funding (DRAFT -> FUNDED). With a configured chain this does NOT trust the client: it loads the transaction
 * receipt, requires a successful `CampaignCreated` from the escrow whose metadataURI is this campaign, whose funder is the
 * campaign owner's wallet and whose amount equals the pool size, and takes the on-chain id/fees/high-value flag from the event.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { c } = await ownedDraftOrFunded(req, (await params).id);
  const v = body.parse(await readJson(req));
  chainMode(); // 503 NOT_CONFIGURED without an escrow

  if (!v.txHash) throw new ApiError(400, "BAD_REQUEST", "txHash of the createCampaign transaction is required");
  if (c.status === "FUNDED" && c.fundTxHash?.toLowerCase() === v.txHash.toLowerCase()) {
    return ok({ campaign: campaignView(c), verified: true }); // idempotent replay
  }
  if (c.status !== "DRAFT") throw new ApiError(409, "BAD_STATE", `Campaign is ${c.status}, expected DRAFT`);
  const { logs, outcomes } = await processReceipt(v.txHash);
  const created = logs.filter((l) => l.eventName === "CampaignCreated");
  if (created.length === 0) throw new ApiError(422, "FUND_NOT_VERIFIED", "No CampaignCreated event from the escrow in that transaction");
  const fresh = await getCampaign(c.id);
  if (fresh.status !== "FUNDED" || fresh.fundTxHash?.toLowerCase() !== v.txHash.toLowerCase()) {
    const reason = outcomes.find((o) => o.event === "CampaignCreated")?.reason ?? "not applied";
    throw new ApiError(422, "FUND_NOT_VERIFIED", `Funding transaction does not match this campaign: ${reason}`);
  }
  return ok({ campaign: campaignView(fresh), verified: true });
});
