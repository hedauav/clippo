import type { Campaign, User } from "@prisma/client";
import { db } from "../db";
import { ApiError } from "../http";
import { HIGHER_RANKED_MIN_TIER, creatorStats, isHigherRanked } from "./rank";

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  rule: Campaign["eligibility"];
  requiredTier: string | null;
  creatorTier: string;
  restrictedToHiredCreators: boolean;
}

/** Eligibility for submitting: verified human, HIGHER_RANKED tier rule, and hired-creator allowlist if the campaign came from a hire. */
export async function campaignEligibility(user: User, c: Campaign): Promise<Eligibility> {
  const reasons: string[] = [];
  const stats = await creatorStats(user.id);
  if (!user.verified) reasons.push("NOT_VERIFIED");
  if (c.eligibility === "HIGHER_RANKED" && !isHigherRanked(stats)) reasons.push("NOT_ELIGIBLE");
  const hire = await db.hire.findUnique({ where: { campaignId: c.id } });
  if (hire) {
    const row = await db.hireCreator.findFirst({ where: { hireId: hire.id, creatorId: user.id, status: "APPROVED" } });
    if (!row) reasons.push("NOT_HIRED");
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    rule: c.eligibility,
    requiredTier: c.eligibility === "HIGHER_RANKED" ? HIGHER_RANKED_MIN_TIER : null,
    creatorTier: stats.tier,
    restrictedToHiredCreators: !!hire,
  };
}

/** Throws the 403s used by POST /api/submissions (NOT_VERIFIED is checked there already). */
export async function assertCanSubmit(user: User, c: Campaign) {
  const e = await campaignEligibility(user, c);
  if (e.reasons.includes("NOT_ELIGIBLE")) {
    throw new ApiError(403, "NOT_ELIGIBLE", `Requires tier ${HIGHER_RANKED_MIN_TIER} or higher (3+ approved clips, reliability >= 0.6)`);
  }
  if (e.reasons.includes("NOT_HIRED")) {
    throw new ApiError(403, "NOT_HIRED", "This campaign is restricted to the creators approved on its hire");
  }
}
