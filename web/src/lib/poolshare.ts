import type { Campaign } from "@prisma/client";
import { db } from "./db";
import { latestPerSubmission } from "./snapshots";

export interface PoolShareWeight {
  creatorWallet: string;
  /** Integer weight passed to the escrow: verified views, or approved clips, depending on the campaign's basis. */
  weight: number;
  /** weight / totalWeight, 0..1. */
  share: number;
}

const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

/**
 * PRD 4.4 Pool share: the whole pool is divided at close by each creator's share of VERIFIED VIEWS or of APPROVED CLIPS, as
 * the campaigner chose (`poolShareBasis`). The escrow takes those shares as `setWeights(id, creators[], weights[])`
 * (campaigner or admin wallet; the escrow pays pro rata at close and refunds rounding dust). This computes the weights.
 * Only approved, still-live clips count; clips held by a view-anomaly flag only count up to the day before the flag.
 */
export async function poolShareWeights(c: Pick<Campaign, "id" | "poolShareBasis">) {
  const basis = c.poolShareBasis ?? "VIEWS";
  const subs = await db.submission.findMany({
    where: { campaignId: c.id, clipStatus: "LIVE", verdict: { result: "APPROVE" } },
    select: { id: true, creator: { select: { wallet: true } } },
  });
  const views = new Map((await latestPerSubmission()).filter((s) => s.campaignId === c.id).map((s) => [s.submissionId, s.cumulativeViews]));
  const byWallet = new Map<string, number>();
  for (const s of subs) {
    const add = basis === "APPROVED_CLIPS" ? 1 : (views.get(s.id) ?? 0);
    byWallet.set(s.creator.wallet, (byWallet.get(s.creator.wallet) ?? 0) + add);
  }
  const rows = [...byWallet.entries()].filter(([, w]) => w > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const totalWeight = rows.reduce((n, [, w]) => n + w, 0);
  const weights: PoolShareWeight[] = rows.map(([creatorWallet, weight]) => ({ creatorWallet, weight, share: totalWeight ? weight / totalWeight : 0 }));
  return { basis, weights, totalWeight, skippedNonAddress: weights.filter((w) => !isAddr(w.creatorWallet)).map((w) => w.creatorWallet) };
}
