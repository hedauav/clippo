import type { Campaign, Deal, DealTerms, User } from "@prisma/client";
import { shortWallet } from "./agents/ask";
import { negotiableRange, type Band } from "./agents/negotiator";
import { db } from "./db";
import { ApiError } from "./http";

export type DealSide = "creator" | "campaigner";
export interface Offer {
  by: "creator" | "campaigner" | "negotiator";
  rate: number;
  note: string;
  at: string;
}

export const offersOf = (d: Deal) => (Array.isArray(d.offers) ? (d.offers as unknown as Offer[]) : []);
export const latestOffer = (d: Deal) => offersOf(d).at(-1) ?? null;

/** Published band for a campaign, or a default of +-50% around its listed per-view rate. */
export function bandFor(c: Campaign, terms: DealTerms | null): Band {
  if (terms) return { minRate: terms.minRate, maxRate: terms.maxRate, autoAcceptUpTo: terms.autoAcceptUpTo };
  if (c.ratePer1k) return { minRate: Math.round(c.ratePer1k * 50) / 100, maxRate: Math.round(c.ratePer1k * 150) / 100, autoAcceptUpTo: null };
  throw new ApiError(409, "NO_TERMS", "The campaigner has not published a negotiation band for this campaign yet");
}

export const sideOf = (user: User, d: Pick<Deal, "creatorId" | "campaignerId">): DealSide => {
  if (user.id === d.creatorId) return "creator";
  if (user.id === d.campaignerId) return "campaigner";
  throw new ApiError(404, "NOT_FOUND", "Deal not found");
};

/** UI shape (Deal in ui-mocks/ext.ts). The viewer never sees the other side's private limit. */
export async function dealView(d: Deal, c: Campaign, terms: DealTerms | null, viewer: DealSide) {
  const band = bandFor(c, terms);
  const range = negotiableRange(band, viewer === "creator" ? d.creatorMinRate : null);
  const creator = await db.user.findUnique({ where: { id: d.creatorId }, select: { wallet: true } });
  const paid = await db.payout.aggregate({ where: { campaignId: c.id }, _sum: { amount: true } });
  return {
    id: d.id,
    campaignId: d.campaignId,
    status: d.status,
    creator: shortWallet(creator?.wallet ?? ""),
    offers: offersOf(d),
    acceptedBy: { creator: d.creatorAccepted, campaigner: d.campaignerAccepted },
    acceptedRate: d.acceptedRate,
    limits: {
      minRate: range?.floor ?? band.minRate,
      maxRate: band.maxRate,
      poolLeft: Math.max(0, c.poolSize - (paid._sum.amount ?? 0)),
      autoAcceptUpTo: viewer === "campaigner" ? (band.autoAcceptUpTo ?? 0) : 0,
    },
    noOverlap: range === null,
  };
}

export const dealTerms = (campaignId: string) => db.dealTerms.findUnique({ where: { campaignId } });

/** Find the deal the caller means: creators have one per campaign; the campaigner picks `creatorId` (default: latest). */
export async function findDeal(user: User, c: Campaign, creatorId?: string | null): Promise<Deal | null> {
  if (user.role === "CREATOR") return db.deal.findUnique({ where: { campaignId_creatorId: { campaignId: c.id, creatorId: user.id } } });
  if (user.role === "CAMPAIGNER" && c.campaignerId === user.id) {
    return creatorId
      ? db.deal.findUnique({ where: { campaignId_creatorId: { campaignId: c.id, creatorId } } })
      : db.deal.findFirst({ where: { campaignId: c.id }, orderBy: { updatedAt: "desc" } });
  }
  throw new ApiError(403, "FORBIDDEN", "Only the campaign's creators and its campaigner can use deals");
}
