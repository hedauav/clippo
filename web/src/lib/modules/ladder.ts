import { db } from "../db";
import { latestPerSubmission } from "../snapshots";

export const TIERS = ["VERIFIED", "RISING", "PARTNER", "TOP"] as const;
export type Tier = (typeof TIERS)[number];

export interface LadderMetrics {
  approvedClips: number;
  reviewedClips: number; // approved + rejected
  approveRate: number; // 0..1, 0 when nothing reviewed
  fraudFlags: number;
  verifiedViews: number; // platform-verified views on approved clips
}

/** Entry requirements per tier. Follower count is deliberately absent. */
export const REQUIREMENTS: Record<Tier, { approvedClips: number; approveRate: number; verifiedViews: number }> = {
  VERIFIED: { approvedClips: 0, approveRate: 0, verifiedViews: 0 },
  RISING: { approvedClips: 5, approveRate: 0.7, verifiedViews: 1_000 },
  PARTNER: { approvedClips: 20, approveRate: 0.85, verifiedViews: 50_000 },
  TOP: { approvedClips: 50, approveRate: 0.92, verifiedViews: 500_000 },
};

const FRAUD_FLAGS = ["duplicate", "injection", "fraud", "fake_views", "botted"];

/** Pure tier computation. Fraud flags cap the creator at VERIFIED. Unverified humans have no tier. */
export function computeTier(verified: boolean, m: LadderMetrics): Tier | null {
  if (!verified) return null;
  if (m.fraudFlags > 0) return "VERIFIED";
  let tier: Tier = "VERIFIED";
  for (const t of TIERS) {
    const r = REQUIREMENTS[t];
    if (m.approvedClips >= r.approvedClips && m.approveRate >= r.approveRate && m.verifiedViews >= r.verifiedViews) {
      tier = t;
    }
  }
  return tier;
}

export function countFraudFlags(flags: unknown): number {
  if (!Array.isArray(flags)) return 0;
  return flags.filter((f) => typeof f === "string" && FRAUD_FLAGS.includes(f.toLowerCase())).length;
}

const emptyMetrics = (): LadderMetrics => ({
  approvedClips: 0,
  reviewedClips: 0,
  approveRate: 0,
  fraudFlags: 0,
  verifiedViews: 0,
});

/** Metrics for the given creators (all creators when ids omitted). */
export async function loadMetrics(userIds?: string[]): Promise<Map<string, LadderMetrics>> {
  const subs = await db.submission.findMany({
    where: { ...(userIds ? { creatorId: { in: userIds } } : {}), verdict: { isNot: null } },
    select: { id: true, creatorId: true, verdict: { select: { result: true, flags: true } } },
  });
  const views = new Map<string, number>();
  for (const s of await latestPerSubmission()) views.set(s.submissionId, s.cumulativeViews);

  const out = new Map<string, LadderMetrics>();
  for (const s of subs) {
    const m = out.get(s.creatorId) ?? emptyMetrics();
    const r = s.verdict?.result;
    if (r === "APPROVE") {
      m.approvedClips++;
      m.reviewedClips++;
      m.verifiedViews += views.get(s.id) ?? 0;
    } else if (r === "REJECT") m.reviewedClips++;
    m.fraudFlags += countFraudFlags(s.verdict?.flags);
    out.set(s.creatorId, m);
  }
  for (const m of out.values()) m.approveRate = m.reviewedClips ? m.approvedClips / m.reviewedClips : 0;
  return out;
}

export async function recomputeStatus(userIds?: string[]) {
  const users = await db.user.findMany({
    where: { role: "CREATOR", ...(userIds ? { id: { in: userIds } } : {}) },
    select: { id: true, verified: true },
  });
  const metrics = await loadMetrics(users.map((u) => u.id));
  let updated = 0;
  for (const u of users) {
    const m = metrics.get(u.id) ?? emptyMetrics();
    const data = { tier: computeTier(u.verified, m), metrics: m as unknown as object, computedAt: new Date() };
    await db.creatorStatus.upsert({ where: { userId: u.id }, create: { userId: u.id, ...data }, update: data });
    updated++;
  }
  return { updated };
}

export async function statusFor(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { verified: true } });
  const m = (await loadMetrics([userId])).get(userId) ?? emptyMetrics();
  const tier = computeTier(!!user?.verified, m);
  const idx = tier ? TIERS.indexOf(tier) : -1;
  const next = idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
  return { tier, metrics: m, nextTier: next, nextRequirements: next ? REQUIREMENTS[next] : null };
}
