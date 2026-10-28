import { db } from "../db";

/**
 * Creator rank (documented in API.md).
 * Counted over a creator's final verdicts across all campaigns:
 *   approved = verdict APPROVE, rejected = verdict REJECT (NEEDS_HUMAN is not yet decided and ignored)
 *   reliability = approved / (approved + rejected), 0 when nothing is decided
 * Tier (highest whose thresholds are both met):
 *   ELITE >= 25 approved & reliability >= 0.85; PRO >= 10 & >= 0.75; RISING >= 3 & >= 0.6; else NEW.
 * rank = index of the tier (NEW 0 ... ELITE 3).
 * Eligibility "higher-ranked creators only" (HIGHER_RANKED campaigns) = rank >= 1 (tier RISING or better).
 */
export const TIERS = ["NEW", "RISING", "PRO", "ELITE"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_RULES: { tier: Tier; minApproved: number; minReliability: number }[] = [
  { tier: "ELITE", minApproved: 25, minReliability: 0.85 },
  { tier: "PRO", minApproved: 10, minReliability: 0.75 },
  { tier: "RISING", minApproved: 3, minReliability: 0.6 },
];
export const HIGHER_RANKED_MIN_TIER: Tier = "RISING";

export interface CreatorStats {
  approved: number;
  rejected: number;
  pending: number;
  reliability: number;
  tier: Tier;
  rank: number;
}

export function computeStats(approved: number, rejected: number, pending = 0): CreatorStats {
  const decided = approved + rejected;
  const reliability = decided > 0 ? Math.round((approved / decided) * 1000) / 1000 : 0;
  const hit = TIER_RULES.find((r) => approved >= r.minApproved && reliability >= r.minReliability);
  const tier: Tier = hit?.tier ?? "NEW";
  return { approved, rejected, pending, reliability, tier, rank: TIERS.indexOf(tier) };
}

export const isHigherRanked = (s: { rank: number }) => s.rank >= TIERS.indexOf(HIGHER_RANKED_MIN_TIER);

/** Stats for many creators in one query. Creators without verdicts get NEW. */
export async function creatorStatsMap(userIds?: string[]): Promise<Map<string, CreatorStats>> {
  const rows = await db.verdict.findMany({
    where: userIds ? { submission: { creatorId: { in: userIds } } } : {},
    select: { result: true, submission: { select: { creatorId: true } } },
  });
  const acc = new Map<string, { a: number; r: number; p: number }>();
  for (const r of rows) {
    const k = r.submission.creatorId;
    const c = acc.get(k) ?? { a: 0, r: 0, p: 0 };
    if (r.result === "APPROVE") c.a++;
    else if (r.result === "REJECT") c.r++;
    else c.p++;
    acc.set(k, c);
  }
  const out = new Map<string, CreatorStats>();
  for (const id of userIds ?? acc.keys()) {
    const c = acc.get(id) ?? { a: 0, r: 0, p: 0 };
    out.set(id, computeStats(c.a, c.r, c.p));
  }
  return out;
}

export async function creatorStats(userId: string): Promise<CreatorStats> {
  return (await creatorStatsMap([userId])).get(userId)!;
}

/** What the next tier needs, for dashboards. */
export function nextTier(s: CreatorStats): { tier: Tier; needApproved: number; needReliability: number } | null {
  const next = TIERS[s.rank + 1];
  if (!next) return null;
  const rule = TIER_RULES.find((r) => r.tier === next)!;
  return { tier: next, needApproved: Math.max(0, rule.minApproved - s.approved), needReliability: rule.minReliability };
}
