import { randomBytes } from "node:crypto";
import { db } from "../db";
import { ApiError } from "../http";

export interface ReferralConfig {
  cutBps: number;
  capUsdc: number;
  cooldownMs: number;
}

export function referralConfig(): ReferralConfig {
  const num = (k: string, d: number) => {
    const raw = process.env[k];
    const n = Number(raw);
    return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    cutBps: Math.min(num("REFERRAL_CUT_BPS", 500), 1000), // matches contract MAX_CUT_BPS
    capUsdc: num("REFERRAL_CAP_USDC", 100),
    cooldownMs: num("REFERRAL_COOLDOWN_HOURS", 24) * 3600_000,
  };
}

export type CreditDecision = { credit: number; reason: "OK" | "FROZEN" | "COOLDOWN" | "CAP_REACHED" | "ZERO" };

/** Pure fraud-limit math, mirrors ClippoReferral.recordActivity. */
export function computeCredit(a: {
  activity: number;
  cfg: ReferralConfig;
  credited: number;
  lastCreditAt: Date | null;
  now: Date;
  frozen: boolean;
}): CreditDecision {
  if (a.frozen) return { credit: 0, reason: "FROZEN" };
  if (a.lastCreditAt && a.now.getTime() < a.lastCreditAt.getTime() + a.cfg.cooldownMs) {
    return { credit: 0, reason: "COOLDOWN" };
  }
  const raw = (a.activity * a.cfg.cutBps) / 10_000;
  const room = Math.max(0, a.cfg.capUsdc - a.credited);
  const credit = Math.floor(Math.min(raw, room) * 1e6) / 1e6;
  if (credit <= 0) return { credit: 0, reason: raw <= 0 ? "ZERO" : "CAP_REACHED" };
  return { credit, reason: "OK" };
}

export async function createLink(referrerId: string, campaignId: string) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  if (!campaign || campaign.status !== "APPROVED") throw new ApiError(404, "NOT_FOUND", "Campaign not open for referral");
  const state = await db.referrerState.findUnique({ where: { userId: referrerId } });
  if (state?.frozen) throw new ApiError(403, "REFERRER_FROZEN", "Referrer is frozen");
  const existing = await db.referralLink.findUnique({ where: { referrerId_campaignId: { referrerId, campaignId } } });
  if (existing) return existing;
  return db.referralLink.create({ data: { referrerId, campaignId, code: randomBytes(6).toString("base64url") } });
}

export async function attribute(refereeId: string, code: string) {
  const link = await db.referralLink.findUnique({ where: { code } });
  if (!link || !link.active) throw new ApiError(404, "NOT_FOUND", "Unknown referral code");
  if (link.referrerId === refereeId) throw new ApiError(400, "SELF_REFERRAL", "Cannot refer yourself");
  const referee = await db.user.findUnique({ where: { id: refereeId } });
  if (!referee?.verified || !referee.worldIdNullifier) {
    throw new ApiError(403, "HUMAN_REQUIRED", "Referee must be a verified unique human");
  }
  const referrer = await db.user.findUnique({ where: { id: link.referrerId } });
  if (!referrer || referrer.wallet === referee.wallet) throw new ApiError(400, "SELF_REFERRAL", "Cannot refer yourself");
  if (referrer.worldIdNullifier && referrer.worldIdNullifier === referee.worldIdNullifier) {
    throw new ApiError(400, "SELF_REFERRAL", "Same human");
  }
  const state = await db.referrerState.findUnique({ where: { userId: link.referrerId } });
  if (state?.frozen) throw new ApiError(403, "REFERRER_FROZEN", "Referrer is frozen");
  // No 2-cycles: the referrer must not themselves be referred by the referee.
  const back = await db.referralAttribution.findUnique({ where: { refereeId: link.referrerId } });
  if (back?.referrerId === refereeId) throw new ApiError(400, "SELF_REFERRAL", "Circular referral");
  const prior = await db.referralAttribution.findUnique({ where: { refereeId } });
  if (prior) throw new ApiError(409, "ALREADY_REFERRED", "First attribution wins");
  return db.referralAttribution.create({
    data: { refereeId, referrerId: link.referrerId, linkId: link.id, campaignId: link.campaignId },
  });
}

/** Credit the referrer of `refereeId` for `activity` USDC of activity, subject to fraud limits. */
export async function accrue(refereeId: string, activity: number, now = new Date()) {
  const attr = await db.referralAttribution.findUnique({ where: { refereeId } });
  if (!attr) throw new ApiError(404, "NOT_REFERRED", "Referee has no referrer");
  const state = await db.referrerState.upsert({
    where: { userId: attr.referrerId },
    create: { userId: attr.referrerId },
    update: {},
  });
  const d = computeCredit({
    activity,
    cfg: referralConfig(),
    credited: state.credited,
    lastCreditAt: state.lastCreditAt,
    now,
    frozen: state.frozen,
  });
  if (d.credit <= 0) return { ...d, creditId: null as string | null };
  const [row] = await db.$transaction([
    db.referralCredit.create({
      data: { referrerId: attr.referrerId, refereeId, campaignId: attr.campaignId, activity, amount: d.credit },
    }),
    db.referrerState.update({
      where: { userId: attr.referrerId },
      data: { credited: { increment: d.credit }, lastCreditAt: now },
    }),
  ]);
  return { ...d, creditId: row.id };
}

export async function setFrozen(userId: string, frozen: boolean, reason?: string) {
  const frozenReason = frozen ? (reason ?? null) : null;
  return db.referrerState.upsert({
    where: { userId },
    create: { userId, frozen, frozenReason },
    update: { frozen, frozenReason },
  });
}

export async function summary(userId: string) {
  const [links, referees, state] = await Promise.all([
    db.referralLink.findMany({ where: { referrerId: userId }, orderBy: { createdAt: "desc" } }),
    db.referralAttribution.count({ where: { referrerId: userId } }),
    db.referrerState.findUnique({ where: { userId } }),
  ]);
  const cfg = referralConfig();
  const credited = state?.credited ?? 0;
  return {
    links,
    referees,
    credited,
    remainingCap: Math.max(0, cfg.capUsdc - credited),
    frozen: state?.frozen ?? false,
    config: { cutBps: cfg.cutBps, capUsdc: cfg.capUsdc, cooldownHours: cfg.cooldownMs / 3600_000 },
  };
}
