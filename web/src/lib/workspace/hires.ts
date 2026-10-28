import { randomBytes } from "node:crypto";
import type { Hire, HireCreator, User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { platformEnum, storySchema } from "../domain";
import { ApiError } from "../http";
import { loadClips } from "./marketplace";
import { budgetTotals, fundAllPlan, priceFromCard, rateCardSchema, round2, type RateCard } from "./money";
import { TIERS, creatorStatsMap, type CreatorStats, type Tier } from "./rank";

export const newToken = () => randomBytes(18).toString("base64url");

export type IdCtx = { params: Promise<{ id: string }> };
export type IdCreatorCtx = { params: Promise<{ id: string; creatorId: string }> };
export type TokenCtx = { params: Promise<{ token: string }> };

// ------------------------------------------------------------------ directory
export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().max(1000).default(""),
  niches: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  rateCard: rateCardSchema,
  listed: z.boolean().default(true),
});

export interface CreatorCard {
  creatorId: string;
  displayName: string;
  bio: string;
  niches: string[];
  rateCard: RateCard;
  verifiedBadge: boolean;
  tier: Tier;
  rank: number;
  approvedClips: number;
  reliability: number;
  platforms: string[]; // verified channel platforms
  lowestRate: number;
}

function toCard(
  p: { userId: string; displayName: string; bio: string; niches: unknown; rateCard: unknown },
  user: Pick<User, "verified">,
  stats: CreatorStats,
  platforms: string[],
): CreatorCard {
  const rateCard = p.rateCard as RateCard;
  return {
    creatorId: p.userId,
    displayName: p.displayName,
    bio: p.bio,
    niches: p.niches as string[],
    rateCard,
    verifiedBadge: user.verified,
    tier: stats.tier,
    rank: stats.rank,
    approvedClips: stats.approved,
    reliability: stats.reliability,
    platforms,
    lowestRate: Math.min(...rateCard.map((r) => r.price)),
  };
}

export interface DirectoryFilters {
  q?: string;
  tier?: Tier; // minimum tier
  niche?: string;
  platform?: string;
  maxRate?: number; // creator has a rate card line <= maxRate
  sort?: "tier" | "rate" | "clips";
  limit?: number;
}

/**
 * Vetted = listed profile + World ID verified user + at least one verified channel.
 */
export async function listCreators(f: DirectoryFilters): Promise<CreatorCard[]> {
  const profiles = await db.creatorProfile.findMany({ where: { listed: true } });
  const ids = profiles.map((p) => p.userId);
  const [users, channels, stats] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids }, verified: true, role: "CREATOR" } }),
    db.channel.findMany({ where: { userId: { in: ids }, verified: true }, select: { userId: true, platform: true } }),
    creatorStatsMap(ids),
  ]);
  let cards: CreatorCard[] = [];
  for (const p of profiles) {
    const u = users.find((x) => x.id === p.userId);
    const platforms = [...new Set(channels.filter((c) => c.userId === p.userId).map((c) => c.platform as string))];
    if (!u || platforms.length === 0) continue;
    cards.push(toCard(p, u, stats.get(p.userId)!, platforms));
  }
  const q = f.q?.trim().toLowerCase();
  if (q) {
    cards = cards.filter((c) => [c.displayName, c.bio, ...c.niches].join(" ").toLowerCase().includes(q));
  }
  if (f.tier) cards = cards.filter((c) => c.rank >= TIERS.indexOf(f.tier!));
  if (f.niche) cards = cards.filter((c) => c.niches.some((n) => n.toLowerCase() === f.niche!.toLowerCase()));
  if (f.platform) cards = cards.filter((c) => c.platforms.includes(f.platform!));
  if (f.maxRate !== undefined) cards = cards.filter((c) => c.lowestRate <= f.maxRate!);
  const sort = f.sort ?? "tier";
  cards.sort((a, b) =>
    sort === "rate"
      ? a.lowestRate - b.lowestRate
      : sort === "clips"
        ? b.approvedClips - a.approvedClips
        : b.rank - a.rank || b.reliability - a.reliability || b.approvedClips - a.approvedClips,
  );
  return cards.slice(0, f.limit ?? 50);
}

export async function getCreatorCard(creatorId: string): Promise<CreatorCard> {
  const p = await db.creatorProfile.findUnique({ where: { userId: creatorId } });
  const u = p ? await db.user.findUnique({ where: { id: creatorId } }) : null;
  if (!p || !u || !p.listed) throw new ApiError(404, "NOT_FOUND", "Creator not found in the directory");
  const channels = await db.channel.findMany({ where: { userId: creatorId, verified: true }, select: { platform: true } });
  const stats = (await creatorStatsMap([creatorId])).get(creatorId)!;
  return toCard(p, u, stats, [...new Set(channels.map((c) => c.platform as string))]);
}

// ------------------------------------------------------------------ hires
export async function getHire(id: string): Promise<Hire> {
  const h = await db.hire.findUnique({ where: { id } });
  if (!h) throw new ApiError(404, "NOT_FOUND", "Hire not found");
  return h;
}

export function assertOwner(user: User, hire: Hire) {
  if (user.role !== "ADMIN" && hire.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your hire");
}

export function assertOpen(hire: Hire) {
  if (hire.status !== "OPEN") throw new ApiError(409, "BAD_STATE", "Hire is already funded; creators are locked");
}

export const addCreatorSchema = z.object({
  creatorId: z.string().min(1),
  rateLabel: z.string().min(1),
  quantity: z.number().int().positive().max(100).default(1),
});

/** Price from the creator's own rate card (campaigners cannot override creator-set rates). */
export async function priceFor(creatorId: string, rateLabel: string, quantity: number): Promise<number> {
  const p = await db.creatorProfile.findUnique({ where: { userId: creatorId } });
  if (!p || !p.listed) throw new ApiError(404, "NOT_FOUND", "Creator not found in the directory");
  try {
    return priceFromCard(p.rateCard as RateCard, rateLabel, quantity);
  } catch (e) {
    throw new ApiError(400, "BAD_RATE", e instanceof Error ? e.message : "Bad rate");
  }
}

/** Full read-only picture of a hire: brief, creators with status, live budget, per-creator tracking. */
export async function hireView(hire: Hire, opts: { includeToken: boolean }) {
  const rows: HireCreator[] = await db.hireCreator.findMany({ where: { hireId: hire.id }, orderBy: { createdAt: "asc" } });
  const ids = rows.map((r) => r.creatorId);
  const [users, profiles, brief, campaign, stats] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, wallet: true, verified: true } }),
    db.creatorProfile.findMany({ where: { userId: { in: ids } } }),
    hire.briefId ? db.hireBrief.findUnique({ where: { id: hire.briefId } }) : null,
    hire.campaignId ? db.campaign.findUnique({ where: { id: hire.campaignId } }) : null,
    creatorStatsMap(ids),
  ]);

  const clips = campaign ? (await loadClips([campaign.id])).clips : [];
  const payouts = campaign ? await db.payout.findMany({ where: { campaignId: campaign.id } }) : [];

  const creators = rows.map((r) => {
    const u = users.find((x) => x.id === r.creatorId);
    const mine = clips.filter((k) => k.creatorId === r.creatorId);
    const paid = payouts.filter((p) => p.creatorId === r.creatorId);
    return {
      creatorId: r.creatorId,
      wallet: u?.wallet ?? "",
      displayName: profiles.find((p) => p.userId === r.creatorId)?.displayName ?? null,
      verifiedBadge: u?.verified ?? false,
      tier: stats.get(r.creatorId)?.tier ?? "NEW",
      rateLabel: r.rateLabel,
      quantity: r.quantity,
      amount: r.amount,
      status: r.status,
      tracking: {
        clips: mine.map((k) => ({ submissionId: k.id, link: k.link, verdict: k.result, views: k.views })),
        approvedClips: mine.filter((k) => k.result === "APPROVE").length,
        rejectedClips: mine.filter((k) => k.result === "REJECT").length,
        pendingReviewClips: mine.filter((k) => k.result === "NEEDS_HUMAN").length,
        views: mine.filter((k) => k.result === "APPROVE").reduce((n, k) => n + k.views, 0),
        paid: round2(paid.reduce((n, p) => n + p.amount, 0)),
        claimed: round2(paid.filter((p) => p.status === "CLAIMED").reduce((n, p) => n + p.amount, 0)),
      },
    };
  });

  return {
    hire: {
      id: hire.id,
      title: hire.title,
      status: hire.status,
      campaignId: hire.campaignId,
      campaignStatus: campaign?.status ?? null,
      createdAt: hire.createdAt,
      ...(opts.includeToken ? { shareToken: hire.shareToken } : {}),
    },
    brief: brief && {
      id: brief.id,
      title: brief.title,
      story: brief.story,
      deliverables: brief.deliverables,
      platforms: brief.platforms,
      deadline: brief.deadline,
      notes: brief.notes,
    },
    // live rollup over every creator on the hire
    budget: { ...budgetTotals(rows), currency: "USDC", poolSize: campaign?.poolSize ?? null },
    creators,
  };
}

/** Creators who may see a hire: they are on it (any status except ones never shown to them: all statuses shown). */
export async function isParticipant(userId: string, hireId: string) {
  return !!(await db.hireCreator.findFirst({ where: { hireId, creatorId: userId } }));
}

/**
 * Fund-all: ONE HUMAN_SPLIT campaign covering every APPROVED creator.
 * Mapping: poolSize = sum(approved amounts), payoutMode = HUMAN_SPLIT, approver = CAMPAIGNER_ONLY,
 * the hire's brief becomes the campaign story, eligibility = ANYONE_VERIFIED (submissions are restricted to
 * the approved creators by the submissions route). The preset amounts become the split (see presetSplit).
 */
export async function fundAll(hire: Hire, opts: { onchainId?: string; txHash?: string }) {
  assertOpen(hire);
  if (!hire.briefId) throw new ApiError(409, "BRIEF_REQUIRED", "Attach a brief before funding");
  const brief = await db.hireBrief.findUnique({ where: { id: hire.briefId } });
  if (!brief) throw new ApiError(409, "BRIEF_REQUIRED", "Attach a brief before funding");
  const rows = await db.hireCreator.findMany({ where: { hireId: hire.id, status: "APPROVED" } });
  if (rows.length === 0) throw new ApiError(409, "NO_APPROVED_CREATORS", "Approve at least one creator first");
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.creatorId) } }, select: { id: true, wallet: true } });
  const plan = fundAllPlan(rows.map((r) => ({ wallet: users.find((u) => u.id === r.creatorId)!.wallet, amount: r.amount, status: r.status })));

  const [campaign, updated] = await db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        campaignerId: hire.campaignerId,
        title: hire.title,
        story: brief.story as object,
        contentSource: "LINK",
        platforms: brief.platforms as string[],
        payoutMode: "HUMAN_SPLIT",
        approver: "CAMPAIGNER_ONLY",
        poolSize: plan.poolSize,
        eligibility: "ANYONE_VERIFIED",
        status: opts.onchainId ? "FUNDED" : "DRAFT",
        onchainId: opts.onchainId,
        fundTxHash: opts.txHash,
      },
    });
    const updated = await tx.hire.update({ where: { id: hire.id }, data: { status: "FUNDING", campaignId: campaign.id } });
    return [campaign, updated] as const;
  });
  return {
    campaign,
    hire: updated,
    fundingIntent: {
      campaignId: campaign.id,
      currency: "USDC",
      poolSize: plan.poolSize,
      payoutMode: "HUMAN_SPLIT",
      presetSplits: plan.splits,
      next: opts.onchainId
        ? "Funded. Admin approves the campaign, creators submit clips, then POST /api/campaigns/:id/split with presetSplits."
        : "Escrow poolSize on-chain, then POST /api/campaigns/:id/fund {onchainId, txHash}.",
    },
  };
}

/** Split body (minus the World ID proof) for approved creators who now have an approved clip and are not yet paid. */
export async function presetSplit(hire: Hire) {
  if (!hire.campaignId) throw new ApiError(409, "BAD_STATE", "Hire has not been funded yet");
  const rows = await db.hireCreator.findMany({ where: { hireId: hire.id, status: "APPROVED" } });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.creatorId) } }, select: { id: true, wallet: true } });
  const approvedClips = await db.verdict.findMany({
    where: { result: "APPROVE", submission: { campaignId: hire.campaignId } },
    select: { submission: { select: { creatorId: true } } },
  });
  const paid = await db.payout.findMany({ where: { campaignId: hire.campaignId } });
  const ready: { creatorWallet: string; amount: number }[] = [];
  const waiting: { creatorWallet: string; amount: number; reason: string }[] = [];
  for (const r of rows) {
    const wallet = users.find((u) => u.id === r.creatorId)!.wallet;
    if (paid.some((p) => p.creatorId === r.creatorId)) continue;
    if (approvedClips.some((v) => v.submission.creatorId === r.creatorId)) ready.push({ creatorWallet: wallet, amount: r.amount });
    else waiting.push({ creatorWallet: wallet, amount: r.amount, reason: "no approved clip yet" });
  }
  return { campaignId: hire.campaignId, splits: ready, waiting };
}

// ------------------------------------------------------------------ briefs
export const briefSchema = z.object({
  title: z.string().trim().min(1).max(200),
  story: storySchema,
  deliverables: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  platforms: z.array(platformEnum).min(1).default(["YOUTUBE"]),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).default(""),
});

// ------------------------------------------------------------------ shortlists
export async function getShortlist(id: string) {
  const s = await db.shortlist.findUnique({ where: { id } });
  if (!s) throw new ApiError(404, "NOT_FOUND", "Shortlist not found");
  return s;
}

export async function shortlistView(s: { id: string; title: string; shareToken: string; createdAt: Date }, includeToken: boolean) {
  const items = await db.shortlistItem.findMany({ where: { shortlistId: s.id }, orderBy: { createdAt: "asc" } });
  const creators: (CreatorCard & { note: string })[] = [];
  for (const it of items) {
    try {
      creators.push({ ...(await getCreatorCard(it.creatorId)), note: it.note });
    } catch {
      /* creator unlisted since; hide */
    }
  }
  return { shortlist: { id: s.id, title: s.title, createdAt: s.createdAt, ...(includeToken ? { shareToken: s.shareToken } : {}) }, creators };
}
