import { getPlatformFees } from "./chain/fees";
import { db } from "./db";
import { latestPerSubmission } from "./snapshots";

export interface CampaignEarning {
  campaignId: string;
  title: string;
  payoutMode: string;
  approvedClips: number;
  views: number;
  /** Estimated USDC before the creator-side platform fee; null for HUMAN_SPLIT (depends on approved split) */
  estimatedEarnings: number | null;
  /** Estimated USDC after the creator-side platform fee (campaign snapshot bps, else current) */
  estimatedNet: number | null;
  creatorFeeBps: number;
}

/** Estimated earnings per campaign for one creator (gross and net of the creator-side platform fee). */
export async function creatorEarnings(userId: string) {
  const fees = await getPlatformFees();
  const snaps = await latestPerSubmission();
  const viewsBySub = new Map(snaps.map((s) => [s.submissionId, s.cumulativeViews]));

  const mine = await db.submission.findMany({
    where: { creatorId: userId, clipStatus: "LIVE", verdict: { result: "APPROVE" }, campaign: { status: { in: ["APPROVED", "CLOSED"] } } },
    select: { id: true, campaignId: true },
  });
  const campaignIds = [...new Set(mine.map((s) => s.campaignId))];
  const campaigns = await db.campaign.findMany({ where: { id: { in: campaignIds } } });
  const all = await db.submission.findMany({
    where: { campaignId: { in: campaignIds }, clipStatus: "LIVE", verdict: { result: "APPROVE" } },
    select: { id: true, campaignId: true, creatorId: true },
  });

  const campaignsOut: CampaignEarning[] = campaigns.map((c) => {
    const inCampaign = all.filter((s) => s.campaignId === c.id);
    const views = (list: { id: string }[]) => list.reduce((n, s) => n + (viewsBySub.get(s.id) ?? 0), 0);
    const myClips = inCampaign.filter((s) => s.creatorId === userId);
    const myViews = views(myClips);
    const totalViews = views(inCampaign);
    // the usable pool is what is left after the campaigner-side fee
    const pool = c.grossFunded != null ? c.grossFunded - (c.campaignerFee ?? 0) : c.poolSize;
    let estimated: number | null = null;
    if (c.payoutMode === "PER_VIEW") {
      const rate = c.ratePer1k ?? 0;
      const raw = (n: number) => (n / 1000) * rate;
      const scale = raw(totalViews) > pool ? pool / raw(totalViews) : 1;
      estimated = raw(myViews) * scale;
    } else if (c.payoutMode === "POOL_SHARE") {
      estimated =
        c.poolShareBasis === "APPROVED_CLIPS"
          ? (pool * myClips.length) / Math.max(1, inCampaign.length)
          : totalViews > 0
            ? (pool * myViews) / totalViews
            : 0;
    }
    const creatorFeeBps = c.creatorFeeBps ?? fees.creatorBps;
    return {
      campaignId: c.id,
      title: c.title,
      payoutMode: c.payoutMode,
      approvedClips: myClips.length,
      views: myViews,
      estimatedEarnings: estimated === null ? null : Math.round(estimated * 100) / 100,
      estimatedNet: estimated === null ? null : Math.round(estimated * (1 - creatorFeeBps / 10_000) * 100) / 100,
      creatorFeeBps,
    };
  });

  const payouts = await db.payout.findMany({ where: { creatorId: userId }, orderBy: { createdAt: "desc" } });
  const pending = payouts.filter((p) => p.status === "PENDING");
  const outstanding = (p: (typeof payouts)[number]) => Math.max(0, p.amount - p.claimedAmount);
  return {
    campaigns: campaignsOut,
    payouts,
    totals: {
      estimated: campaignsOut.reduce((n, c) => n + (c.estimatedEarnings ?? 0), 0),
      estimatedNet: campaignsOut.reduce((n, c) => n + (c.estimatedNet ?? 0), 0),
      /** gross, unfrozen, not yet claimed (PER_VIEW credits may still be inside the retention window: see payout.releaseAt) */
      claimable: pending.filter((p) => !p.frozen).reduce((n, p) => n + outstanding(p), 0),
      /** gross claimed on-chain so far */
      claimed: payouts.reduce((n, p) => n + (p.status === "CLAIMED" ? p.amount : p.claimedAmount), 0),
      /** unclaimed balance held back (deleted clip / fraud review) */
      frozen: pending.filter((p) => p.frozen).reduce((n, p) => n + outstanding(p), 0),
    },
    fees: { creatorBps: fees.creatorBps, source: fees.source, retentionDays: fees.retentionDays },
  };
}
