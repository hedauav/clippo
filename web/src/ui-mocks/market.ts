/* Typed demo data for the marketplace views. Used only when the service is unreachable; the UI says so. */
import type { Campaign } from "./data";

export type TierName = "NEW" | "RISING" | "PRO" | "ELITE" | "VERIFIED" | "PARTNER" | "TOP";

export type StandingRow = {
  position: number;
  creatorId: string;
  handle: string;
  verified: boolean;
  tier: TierName | null;
  views: number;
  approved: number;
  campaigns: number;
  est: number;
};

export type TrendRow = { position: number; campaign: Campaign; viewsGained: number; trendScore: number; windowDays: number; verified: boolean };

export type DeskCampaign = {
  campaignId: string;
  title: string;
  status: string;
  mode: string;
  budget: number;
  spend: number;
  allocated: number;
  remaining: number;
  views: number;
  approved: number;
  rejected: number;
  pending: number;
  cpm1k: number | null;
};
export type DeskData = {
  campaigns: DeskCampaign[];
  totals: { campaigns: number; budget: number; spend: number; views: number; approved: number; rejected: number; pending: number; cpm1k: number | null };
};

export type DailyPoint = { day: string; views: number };
export type CreatorPerf = { creator: string; verified: boolean; tier: TierName | null; clips: number; approved: number; rejected: number; views: number; paid: number; cpm1k: number | null };

export type CreatorDash = {
  verified: boolean;
  rank: { approved: number; rejected: number; pending: number; reliability: number; tier: TierName; rank: number };
  totals: { views: number; submitted: number; approved: number; rejected: number; pending: number; hires: number; estimated: number; claimable: number; claimed: number };
  campaigns: { campaignId: string; title: string; mode: string; approvedClips: number; views: number; est: number | null }[];
};

export type Fees = { campaignerBps: number; creatorBps: number; source: "api" | "default" };

const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 9, 27 - n));
  return d.toISOString().slice(0, 10);
};
export const mockDaily = (): DailyPoint[] => [4200, 5100, 4800, 6900, 8800, 8100, 9600, 12400, 11200, 10800, 13900, 15200, 14100, 16800].map((v, i, a) => ({ day: day(a.length - 1 - i), views: v }));

export const mockBoard: StandingRow[] = [
  { position: 1, creatorId: "d1", handle: "0x71c9…8e3b", verified: true, tier: "ELITE", views: 1_284_000, approved: 31, campaigns: 4, est: 3120.4 },
  { position: 2, creatorId: "d2", handle: "0x9a02…c41d", verified: true, tier: "PRO", views: 902_400, approved: 14, campaigns: 3, est: 2208.0 },
  { position: 3, creatorId: "d3", handle: "0x44be…0a77", verified: true, tier: "PRO", views: 611_900, approved: 11, campaigns: 2, est: 1544.6 },
  { position: 4, creatorId: "d4", handle: "0xb803…19ef", verified: true, tier: "RISING", views: 240_300, approved: 5, campaigns: 2, est: 610.2 },
  { position: 5, creatorId: "d5", handle: "0x1fd6…7a92", verified: false, tier: "NEW", views: 18_200, approved: 1, campaigns: 1, est: 42.5 },
];

export const mockDeskTotals = (campaigns: DeskCampaign[]): DeskData["totals"] => {
  const t = campaigns.reduce(
    (a, c) => ({ budget: a.budget + c.budget, spend: a.spend + c.spend, views: a.views + c.views, approved: a.approved + c.approved, rejected: a.rejected + c.rejected, pending: a.pending + c.pending }),
    { budget: 0, spend: 0, views: 0, approved: 0, rejected: 0, pending: 0 },
  );
  return { campaigns: campaigns.length, ...t, cpm1k: t.views ? (t.spend / t.views) * 1000 : null };
};

export const mockCreators: CreatorPerf[] = [
  { creator: "0x71c9…8e3b", verified: true, tier: "ELITE", clips: 9, approved: 8, rejected: 1, views: 612_000, paid: 1468.8, cpm1k: 2.4 },
  { creator: "0x9a02…c41d", verified: true, tier: "PRO", clips: 6, approved: 4, rejected: 2, views: 301_400, paid: 723.4, cpm1k: 2.4 },
  { creator: "0x1fd6…7a92", verified: false, tier: "NEW", clips: 3, approved: 1, rejected: 2, views: 28_000, paid: 67.2, cpm1k: 2.4 },
];
