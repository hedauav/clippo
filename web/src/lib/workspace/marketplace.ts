import type { Campaign } from "@prisma/client";
import { db } from "../db";
import { creatorEarnings } from "../earnings";
import { creatorStatsMap, type CreatorStats } from "./rank";
import { round2 } from "./money";

export const dayOffset = (days: number, from = new Date()) =>
  new Date(from.getTime() - days * 86400_000).toISOString().slice(0, 10);

/** Latest cumulative views per submission (any campaign status; never decreasing), plus views at/before a cutoff day. */
export async function viewsBySubmission(submissionIds: string[], cutoffDay?: string) {
  const latest = new Map<string, number>();
  const base = new Map<string, number>();
  if (submissionIds.length === 0) return { latest, base };
  const snaps = await db.viewSnapshot.findMany({
    where: { submissionId: { in: submissionIds } },
    select: { submissionId: true, day: true, cumulativeViews: true },
  });
  for (const s of snaps) {
    latest.set(s.submissionId, Math.max(latest.get(s.submissionId) ?? 0, s.cumulativeViews));
    if (cutoffDay && s.day <= cutoffDay) {
      base.set(s.submissionId, Math.max(base.get(s.submissionId) ?? 0, s.cumulativeViews));
    }
  }
  return { latest, base };
}

type PayoutCfg = Pick<Campaign, "payoutMode" | "ratePer1k" | "poolSize" | "poolShareBasis">;

/**
 * Estimated earnings per creator for one campaign from its approved clips (before fees).
 * Same formulas as /api/creator/earnings. HUMAN_SPLIT is not estimated here (returns empty).
 */
export function estimateShares(c: PayoutCfg, clips: { creatorId: string; views: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  if (c.payoutMode === "HUMAN_SPLIT") return out;
  const byCreator = new Map<string, { views: number; clips: number }>();
  for (const k of clips) {
    const cur = byCreator.get(k.creatorId) ?? { views: 0, clips: 0 };
    cur.views += k.views;
    cur.clips += 1;
    byCreator.set(k.creatorId, cur);
  }
  const totalViews = clips.reduce((n, k) => n + k.views, 0);
  const raw = (v: number) => (v / 1000) * (c.ratePer1k ?? 0);
  const scale = c.payoutMode === "PER_VIEW" && raw(totalViews) > c.poolSize ? c.poolSize / raw(totalViews) : 1;
  for (const [id, v] of byCreator) {
    let est = 0;
    if (c.payoutMode === "PER_VIEW") est = raw(v.views) * scale;
    else if (c.poolShareBasis === "APPROVED_CLIPS") est = (c.poolSize * v.clips) / Math.max(1, clips.length);
    else est = totalViews > 0 ? (c.poolSize * v.views) / totalViews : 0;
    out.set(id, round2(est));
  }
  return out;
}

export interface ClipRow {
  id: string;
  campaignId: string;
  creatorId: string;
  result: string | null; // verdict
  views: number;
  createdAt: Date;
  link: string;
}

/** Load clips (with verdict result and latest views) for the given campaigns. */
export async function loadClips(campaignIds: string[], cutoffDay?: string) {
  const subs = await db.submission.findMany({
    where: { campaignId: { in: campaignIds } },
    select: {
      id: true,
      campaignId: true,
      creatorId: true,
      createdAt: true,
      link: true,
      verdict: { select: { result: true } },
    },
  });
  const { latest, base } = await viewsBySubmission(
    subs.map((s) => s.id),
    cutoffDay,
  );
  const clips: ClipRow[] = subs.map((s) => ({
    id: s.id,
    campaignId: s.campaignId,
    creatorId: s.creatorId,
    result: s.verdict?.result ?? null,
    views: latest.get(s.id) ?? 0,
    createdAt: s.createdAt,
    link: s.link,
  }));
  return { clips, base };
}

const sumViews = (rows: { views: number }[]) => rows.reduce((n, r) => n + r.views, 0);

// ---------- trending ----------
/** trendScore = views gained in the last `days` days + 100 x approved clips + 25 x submissions made in the window. */
export function trendScore(p: { viewsGained: number; approvedClips: number; recentSubmissions: number }) {
  return p.viewsGained + 100 * p.approvedClips + 25 * p.recentSubmissions;
}

export async function trendingCampaigns(opts: { limit: number; days: number }) {
  const campaigns = await db.campaign.findMany({
    where: { status: "APPROVED" },
    include: { campaigner: { select: { id: true, wallet: true, verified: true } } },
  });
  const cutoff = dayOffset(opts.days);
  const { clips, base } = await loadClips(
    campaigns.map((c) => c.id),
    cutoff,
  );
  const since = new Date(Date.now() - opts.days * 86400_000);
  const rows = campaigns.map((c) => {
    const mine = clips.filter((k) => k.campaignId === c.id);
    const approved = mine.filter((k) => k.result === "APPROVE");
    const viewsGained = approved.reduce((n, k) => n + Math.max(0, k.views - (base.get(k.id) ?? 0)), 0);
    const recentSubmissions = mine.filter((k) => k.createdAt >= since).length;
    const { campaigner, ...rest } = c;
    return {
      campaign: rest,
      campaigner: { id: campaigner.id, wallet: campaigner.wallet, verifiedBadge: campaigner.verified },
      totalViews: sumViews(approved),
      viewsGained,
      approvedClips: approved.length,
      submissions: mine.length,
      trendScore: trendScore({ viewsGained, approvedClips: approved.length, recentSubmissions }),
    };
  });
  rows.sort((a, b) => b.trendScore - a.trendScore || b.campaign.createdAt.getTime() - a.campaign.createdAt.getTime());
  return rows.slice(0, opts.limit).map((r, i) => ({ position: i + 1, ...r }));
}

// ---------- leaderboard ----------
export async function leaderboard(opts: { limit: number; sort: "views" | "earnings" }) {
  const campaigns = await db.campaign.findMany({ where: { status: { in: ["APPROVED", "CLOSED"] } } });
  const { clips } = await loadClips(campaigns.map((c) => c.id));
  const approved = clips.filter((k) => k.result === "APPROVE");
  const payouts = await db.payout.findMany({
    where: { campaignId: { in: campaigns.filter((c) => c.payoutMode === "HUMAN_SPLIT").map((c) => c.id) } },
  });

  const agg = new Map<string, { views: number; clips: number; earnings: number; campaigns: Set<string> }>();
  const get = (id: string) => {
    let a = agg.get(id);
    if (!a) agg.set(id, (a = { views: 0, clips: 0, earnings: 0, campaigns: new Set() }));
    return a;
  };
  for (const c of campaigns) {
    const cc = approved.filter((k) => k.campaignId === c.id);
    for (const k of cc) {
      const a = get(k.creatorId);
      a.views += k.views;
      a.clips += 1;
      a.campaigns.add(c.id);
    }
    for (const [id, e] of estimateShares(c, cc)) get(id).earnings += e;
  }
  for (const p of payouts) get(p.creatorId).earnings += p.amount;

  const ids = [...agg.keys()];
  const [users, profiles, stats] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, wallet: true, verified: true } }),
    db.creatorProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, displayName: true } }),
    creatorStatsMap(ids),
  ]);
  const rows = ids.map((id) => {
    const a = agg.get(id)!;
    const u = users.find((x) => x.id === id);
    const s = stats.get(id) as CreatorStats;
    return {
      creatorId: id,
      wallet: u?.wallet ?? "",
      displayName: profiles.find((p) => p.userId === id)?.displayName ?? null,
      verifiedBadge: u?.verified ?? false,
      tier: s.tier,
      views: a.views,
      approvedClips: a.clips,
      campaigns: a.campaigns.size,
      estimatedEarnings: round2(a.earnings),
    };
  });
  rows.sort((x, y) =>
    opts.sort === "earnings"
      ? y.estimatedEarnings - x.estimatedEarnings || y.views - x.views
      : y.views - x.views || y.estimatedEarnings - x.estimatedEarnings,
  );
  return rows.slice(0, opts.limit).map((r, i) => ({ position: i + 1, ...r }));
}

// ---------- campaigner dashboard ----------
export function costPer1k(spend: number, views: number): number | null {
  return views > 0 ? round2((spend / views) * 1000) : null;
}

export async function campaignerDashboard(campaignerId: string) {
  const campaigns = await db.campaign.findMany({ where: { campaignerId }, orderBy: { createdAt: "desc" } });
  const ids = campaigns.map((c) => c.id);
  const { clips } = await loadClips(ids);
  const payouts = await db.payout.findMany({ where: { campaignId: { in: ids } } });
  const creatorIds = [...new Set(clips.map((k) => k.creatorId))];
  const [users, profiles] = await Promise.all([
    db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, wallet: true, verified: true } }),
    db.creatorProfile.findMany({ where: { userId: { in: creatorIds } }, select: { userId: true, displayName: true } }),
  ]);
  const items = campaigns.map((c) => {
    const mine = clips.filter((k) => k.campaignId === c.id);
    const approved = mine.filter((k) => k.result === "APPROVE");
    const views = sumViews(approved);
    const paid = payouts.filter((p) => p.campaignId === c.id).reduce((n, p) => n + p.amount, 0);
    const accrued = [...estimateShares(c, approved).values()].reduce((n, v) => n + v, 0);
    const spend = round2(c.payoutMode === "HUMAN_SPLIT" ? paid : Math.max(paid, accrued));
    // Server-side per-creator performance. cost: HUMAN_SPLIT = USDC allocated by the approved split; PER_VIEW / POOL_SHARE =
    // estimate from the payout formula over approved clips, never below what is already credited to that creator.
    const est = estimateShares(c, approved);
    const creators = [...new Set(mine.map((k) => k.creatorId))].map((cid) => {
      const theirs = approved.filter((k) => k.creatorId === cid);
      const cViews = sumViews(theirs);
      const theirPayouts = payouts.filter((p) => p.campaignId === c.id && p.creatorId === cid);
      const credited = theirPayouts.reduce((n, p) => n + p.amount, 0);
      const claimed = theirPayouts.reduce((n, p) => n + (p.status === "CLAIMED" ? p.amount : p.claimedAmount), 0);
      const cost = round2(c.payoutMode === "HUMAN_SPLIT" ? credited : Math.max(credited, est.get(cid) ?? 0));
      const u = users.find((x) => x.id === cid);
      return {
        creatorId: cid,
        wallet: u?.wallet ?? "",
        displayName: profiles.find((p) => p.userId === cid)?.displayName ?? null,
        verifiedBadge: u?.verified ?? false,
        views: cViews,
        approvedClips: theirs.length,
        clipsSubmitted: mine.filter((k) => k.creatorId === cid).length,
        cost,
        /** USDC credited to the creator (on-chain payout rows) and the part already claimed; unclaimed = paid - claimed */
        paid: round2(credited),
        claimed: round2(claimed),
        costBasis: c.payoutMode === "HUMAN_SPLIT" ? "allocated" : "estimated",
        costPer1kViews: costPer1k(cost, cViews),
      };
    });
    creators.sort((a, b) => b.views - a.views || b.cost - a.cost);
    return {
      campaignId: c.id,
      title: c.title,
      status: c.status,
      payoutMode: c.payoutMode,
      budget: c.poolSize,
      spend,
      allocated: round2(paid),
      remaining: round2(Math.max(0, c.poolSize - spend)),
      views,
      clips: {
        approved: approved.length,
        rejected: mine.filter((k) => k.result === "REJECT").length,
        pendingReview: mine.filter((k) => k.result === "NEEDS_HUMAN").length,
        total: mine.length,
      },
      costPer1kViews: costPer1k(spend, views),
      creators,
    };
  });
  const t = (f: (i: (typeof items)[number]) => number) => items.reduce((n, i) => n + f(i), 0);
  const views = t((i) => i.views);
  const spend = round2(t((i) => i.spend));
  return {
    campaigns: items,
    totals: {
      campaigns: items.length,
      budget: round2(t((i) => i.budget)),
      spend,
      views,
      approvedClips: t((i) => i.clips.approved),
      rejectedClips: t((i) => i.clips.rejected),
      pendingReviewClips: t((i) => i.clips.pendingReview),
      costPer1kViews: costPer1k(spend, views),
    },
  };
}

// ---------- creator dashboard ----------
export async function creatorDashboard(userId: string) {
  const [earn, stats, subs, hires, user] = await Promise.all([
    creatorEarnings(userId),
    creatorStatsMap([userId]).then((m) => m.get(userId)!),
    db.submission.findMany({ where: { creatorId: userId }, select: { id: true, verdict: { select: { result: true } } } }),
    db.hireCreator.count({ where: { creatorId: userId, status: "APPROVED" } }),
    db.user.findUnique({ where: { id: userId }, select: { verified: true } }),
  ]);
  const { latest } = await viewsBySubmission(subs.filter((s) => s.verdict?.result === "APPROVE").map((s) => s.id));
  return {
    verifiedBadge: user?.verified ?? false,
    rank: stats,
    totals: {
      views: [...latest.values()].reduce((n, v) => n + v, 0),
      clipsSubmitted: subs.length,
      approvedClips: stats.approved,
      rejectedClips: stats.rejected,
      pendingReviewClips: stats.pending,
      activeHires: hires,
      ...earn.totals,
    },
    campaigns: earn.campaigns,
    payouts: earn.payouts,
  };
}

// ---------- campaign view history ----------
/**
 * Daily cumulative views for a campaign from ViewSnapshot: per day, the sum over approved clips of each clip's latest
 * cumulative views up to that day (carried forward when a clip has no snapshot that day; never decreasing per clip).
 */
export async function campaignViewHistory(campaignId: string) {
  const snaps = await db.viewSnapshot.findMany({
    where: { campaignId, submission: { verdict: { result: "APPROVE" } } },
    select: { submissionId: true, day: true, cumulativeViews: true },
    orderBy: { day: "asc" },
  });
  const days = [...new Set(snaps.map((s) => s.day))].sort();
  const lastBySub = new Map<string, number>();
  const bySubDay = new Map<string, number>();
  for (const s of snaps) bySubDay.set(`${s.submissionId}|${s.day}`, s.cumulativeViews);
  const subs = [...new Set(snaps.map((s) => s.submissionId))];
  let prev = 0;
  const points = days.map((day) => {
    for (const sid of subs) {
      const v = bySubDay.get(`${sid}|${day}`);
      if (v !== undefined) lastBySub.set(sid, Math.max(lastBySub.get(sid) ?? 0, v));
    }
    const views = [...lastBySub.values()].reduce((n, v) => n + v, 0);
    const p = { day, views, dailyViews: Math.max(0, views - prev), clips: lastBySub.size };
    prev = views;
    return p;
  });
  return points;
}
