/* Typed demo data. Everything here is labelled DEMO in the UI. Swap for real endpoints via ./client.ts when API.md lands. */

export type Platform = "youtube" | "x" | "instagram";
export type PayMode = "per_view" | "human_split" | "pool_share";
export type Verdict = "approved" | "rejected" | "needs_human" | "pending";
export type CampaignStatus = "draft" | "awaiting_funds" | "pending_admin" | "live" | "closed" | "rejected";

export type Campaign = {
  id: string;
  serial: string;
  title: string;
  brand: string;
  pitch: string;
  story: string;
  mustSay: string[];
  mustNot: string[];
  disclosure: string;
  platforms: Platform[];
  mode: PayMode;
  shareBy?: "views" | "approved_clips";
  approver?: "me" | "me_and_admin";
  rate: number; // USDC per 1,000 views (per_view)
  pool: number; // USDC
  paid: number; // USDC allocated so far
  views: number;
  creators: number;
  clips: number;
  access: "anyone" | "ranked";
  status: CampaignStatus;
  closesIn: string;
  daily: number[]; // cumulative views, one per day
  hasSource: boolean;
  contentUrl?: string;
  /* chain-sourced, set by the API (absent in sample data) */
  onchainId?: string | null;
  highValue?: boolean;
  campaignerFee?: number | null;
  rejectReason?: string | null;
};

export type Submission = {
  id: string;
  campaignId: string;
  url: string;
  platform: Platform;
  handle: string;
  title: string;
  verdict: Verdict;
  confidence: number;
  reason: string;
  views: number;
  earned: number;
  at: string;
  appeal?: "none" | "open" | "upheld" | "overturned";
  creatorWallet?: string;
};

export type Creator = {
  handle: string;
  verified: boolean;
  views: number;
  est: number;
  approved: number;
  channels: Platform[];
};

export type Payout = {
  id: string;
  campaignId: string;
  campaign: string;
  day: string;
  amount: number;
  claimed: boolean;
  tx?: string;
  /* real-ledger extras (chain mode) */
  outstanding?: number; // gross still owed (amount - claimedAmount)
  frozen?: boolean;
  frozenReason?: string | null;
  releaseAt?: string | null; // retention window end
};

export type Estimate = {
  campaignId: string;
  title: string;
  mode: PayMode;
  approvedClips: number;
  views: number;
  est: number | null;
};

export type EarningsData = {
  payouts: Payout[];
  estimates: Estimate[];
  totals: { estimated: number; claimable: number; claimed: number; frozen?: number };
  fees?: { creatorBps: number; retentionDays: number };
};

export type QueueItem = {
  id: string;
  kind: "campaign" | "clip" | "appeal" | "pattern";
  title: string;
  by: string;
  summary: string;
  rank: number; // assistant's priority 1 = look first
  amount?: number;
  tag: string;
  noteLabel?: string;
  /* real-queue extras: on-chain id and high-value flag for campaigns, flag id for fraud flags */
  onchainId?: string | null;
  highValue?: boolean;
  flagId?: string;
};

const growth = (end: number, days = 14, curve = 1.6) =>
  Array.from({ length: days }, (_, i) => Math.round(end * Math.pow((i + 1) / days, curve)));

export const campaigns: Campaign[] = [
  {
    id: "c-ledgerlane",
    serial: "0042",
    title: "Ledgerlane: explain the 3-minute close",
    brand: "Ledgerlane",
    pitch: "Accounting software that closes the month in three minutes.",
    story:
      "Ledgerlane reconciles bank feeds against invoices overnight, so a finance lead can close the month before their coffee cools. Clips should show a real close, start to finish, and say what it replaces: a week of spreadsheets.",
    mustSay: ["Month-end close takes 3 minutes in Ledgerlane", "Bank feeds reconcile overnight"],
    mustNot: ["Claims about tax or audit sign-off", "Comparisons naming competitors", "Guaranteed savings figures"],
    disclosure: "#ad or 'Paid partnership' label visible in the first 5 seconds",
    platforms: ["youtube", "x"],
    mode: "per_view",
    rate: 2.4,
    pool: 5000,
    paid: 3260,
    views: 1358000,
    creators: 41,
    clips: 112,
    access: "anyone",
    status: "live",
    closesIn: "9 days",
    daily: growth(1358000),
    hasSource: true,
  },
  {
    id: "c-tidepool",
    serial: "0041",
    title: "Tidepool Coffee, cold brew in 90 seconds",
    brand: "Tidepool",
    pitch: "Cold brew concentrate that is ready before the kettle boils.",
    story:
      "Tidepool ships a concentrate you cut with water. Clips show the pour, the taste test, one honest opinion. No health claims.",
    mustSay: ["Ready in 90 seconds", "Concentrate, cut 1:3 with water"],
    mustNot: ["Health or caffeine-benefit claims", "Giveaway language"],
    disclosure: "'Sponsored' in caption",
    platforms: ["instagram", "youtube"],
    mode: "pool_share",
    shareBy: "approved_clips",
    rate: 0,
    pool: 2000,
    paid: 0,
    views: 402000,
    creators: 19,
    clips: 33,
    access: "anyone",
    status: "live",
    closesIn: "21 days",
    daily: growth(402000, 14, 1.2),
    hasSource: false,
  },
  {
    id: "c-fieldnotes",
    serial: "0040",
    title: "Fieldnotes: why we stopped using slides",
    brand: "Fieldnotes",
    pitch: "A document tool for teams that write before they meet.",
    story: "Fieldnotes replaces the weekly deck with a one-page memo and a comment thread. Clips are talking-head, 30 to 60 seconds, one real story from a team that switched.",
    mustSay: ["One page, not a deck", "Comments replace the meeting"],
    mustNot: ["Pricing claims"],
    disclosure: "'Ad' tag in the on-screen text",
    platforms: ["x", "youtube", "instagram"],
    mode: "human_split",
    approver: "me_and_admin",
    rate: 0,
    pool: 8000,
    paid: 1200,
    views: 221000,
    creators: 12,
    clips: 21,
    access: "ranked",
    status: "live",
    closesIn: "14 days",
    daily: growth(221000, 14, 2),
    hasSource: true,
  },
  {
    id: "c-hexbolt",
    serial: "0039",
    title: "Hexbolt torque wrench: one-handed demo",
    brand: "Hexbolt",
    pitch: "A torque wrench that clicks once, and means it.",
    story: "Show a real tightening job with a Hexbolt wrench. State the torque you set. Keep it practical.",
    mustSay: ["Set the torque, one click, done"],
    mustNot: ["Safety-certification claims"],
    disclosure: "Paid partnership label",
    platforms: ["youtube"],
    mode: "per_view",
    rate: 1.1,
    pool: 1500,
    paid: 1498,
    views: 1362000,
    creators: 27,
    clips: 58,
    access: "anyone",
    status: "live",
    closesIn: "2 days",
    daily: growth(1362000, 14, 1.3),
    hasSource: false,
  },
  {
    id: "c-ninthward",
    serial: "0038",
    title: "Ninth Ward Records: the pressing plant tour",
    brand: "Ninth Ward Records",
    pitch: "Short-run vinyl pressing for independent labels.",
    story: "Clip the plant tour. Show the press, the lacquer, the first test pressing. Credit the source footage.",
    mustSay: ["Short runs from 100 copies"],
    mustNot: ["Delivery date promises"],
    disclosure: "'Ad' in caption",
    platforms: ["instagram", "x"],
    mode: "per_view",
    rate: 3.0,
    pool: 3000,
    paid: 410,
    views: 137000,
    creators: 9,
    clips: 15,
    access: "ranked",
    status: "live",
    closesIn: "26 days",
    daily: growth(137000, 14, 1.8),
    hasSource: true,
  },
];

export const mySubmissions: Submission[] = [
  {
    id: "s-1",
    campaignId: "c-ledgerlane",
    url: "https://youtube.com/shorts/q7Lm2xK",
    platform: "youtube",
    handle: "@mara.reels",
    title: "I closed the month before my coffee cooled",
    verdict: "approved",
    confidence: 0.94,
    reason: "States the 3-minute close, shows bank-feed reconciliation, disclosure label at 0:02. Source attributed.",
    views: 48200,
    earned: 115.68,
    at: "Oct 24",
  },
  {
    id: "s-2",
    campaignId: "c-ledgerlane",
    url: "https://x.com/mara_reels/status/18817",
    platform: "x",
    handle: "@mara.reels",
    title: "Spreadsheets vs this",
    verdict: "rejected",
    confidence: 0.88,
    reason: "Says 'guaranteed to save you 20 hours a week'. Guaranteed savings figures are a prohibited claim. No disclosure label found.",
    views: 3100,
    earned: 0,
    at: "Oct 25",
    appeal: "none",
  },
  {
    id: "s-3",
    campaignId: "c-ledgerlane",
    url: "https://youtube.com/shorts/Zp09aaT",
    platform: "youtube",
    handle: "@mara.reels",
    title: "Month-end, but make it quick",
    verdict: "needs_human",
    confidence: 0.58,
    reason: "On-topic and labelled, but the transcript is 40% music. Message point 2 (bank feeds reconcile overnight) not clearly spoken. Sent to the campaigner.",
    views: 9400,
    earned: 0,
    at: "Oct 26",
  },
  {
    id: "s-4",
    campaignId: "c-ledgerlane",
    url: "https://youtube.com/shorts/new0001",
    platform: "youtube",
    handle: "@mara.reels",
    title: "Reading the feed",
    verdict: "pending",
    confidence: 0,
    reason: "Queued. The agent is reading the transcript.",
    views: 0,
    earned: 0,
    at: "Today",
  },
];

/* Rows for the landing "live ledger" exhibit */
export const exhibitRows: (Submission & { who: string })[] = [
  { ...mySubmissions[0], who: "@mara.reels", views: 48200, earned: 115.68 },
  { ...mySubmissions[1], id: "x-2", who: "@duskpilot", handle: "@duskpilot", verdict: "approved", confidence: 0.91, views: 31750, earned: 76.2, reason: "On brief." },
  { ...mySubmissions[1], id: "x-3", who: "@numbers.nina", handle: "@numbers.nina", verdict: "rejected", confidence: 0.88, views: 3100, earned: 0, reason: "Guaranteed savings claim. No disclosure label." },
  { ...mySubmissions[2], id: "x-4", who: "@oakline", handle: "@oakline", verdict: "needs_human", confidence: 0.58, views: 9400, earned: 0, reason: "Transcript mostly music." },
];

export const leaderboard: Creator[] = [
  { handle: "@mara.reels", verified: true, views: 612000, est: 1468.8, approved: 31, channels: ["youtube", "x"] },
  { handle: "@duskpilot", verified: true, views: 540300, est: 1296.7, approved: 24, channels: ["youtube"] },
  { handle: "@oakline", verified: true, views: 388900, est: 933.4, approved: 19, channels: ["instagram", "youtube"] },
  { handle: "@numbers.nina", verified: true, views: 301200, est: 722.9, approved: 17, channels: ["x"] },
  { handle: "@kiln.and.keys", verified: true, views: 244000, est: 585.6, approved: 12, channels: ["instagram"] },
  { handle: "@tolliver", verified: true, views: 190500, est: 457.2, approved: 11, channels: ["youtube", "x"] },
  { handle: "@brightwork", verified: true, views: 133800, est: 321.1, approved: 8, channels: ["x"] },
];

export const earnings: EarningsData = {
  payouts: [
    { id: "e-1", campaignId: "c-ledgerlane", campaign: "Ledgerlane", day: "Oct 26", amount: 33.84, claimed: false },
    { id: "e-2", campaignId: "c-ledgerlane", campaign: "Ledgerlane", day: "Oct 25", amount: 28.32, claimed: false },
    { id: "e-3", campaignId: "c-hexbolt", campaign: "Hexbolt", day: "Oct 25", amount: 24.64, claimed: false },
    { id: "e-4", campaignId: "c-ledgerlane", campaign: "Ledgerlane", day: "Oct 24", amount: 22.32, claimed: true, tx: "0x4f1c…a90e" },
    { id: "e-5", campaignId: "c-hexbolt", campaign: "Hexbolt", day: "Oct 23", amount: 20.79, claimed: true, tx: "0x9be2…17d4" },
  ],
  estimates: [
    { campaignId: "c-ledgerlane", title: "Ledgerlane: explain the 3-minute close", mode: "per_view", approvedClips: 3, views: 61200, est: 146.88 },
    { campaignId: "c-fieldnotes", title: "Fieldnotes: why we stopped using slides", mode: "human_split", approvedClips: 1, views: 8400, est: null },
  ],
  totals: { estimated: 146.88, claimable: 86.8, claimed: 43.11 },
};

export const adminQueue: QueueItem[] = [
  { id: "q-1", kind: "campaign", rank: 1, title: "Orchard Labs: sleep tracker, 10,000 USDC pool", by: "orchardlabs.eth", amount: 10000, tag: "Campaign", summary: "Funded in full. Story makes the claim 'clinically proven to improve sleep'. Prohibited list is empty. Assistant suggests asking for the claim to be removed or sourced before approval." },
  { id: "q-2", kind: "pattern", rank: 2, title: "Views on @quickdraw3 jumped 11x overnight", by: "Hexbolt", tag: "View pattern", summary: "Clip had 2,100 views at 20:00, 23,900 at 06:00. Growth is flat across hours, the usual curve is front-loaded. Retention hold applied to 24.64 USDC." },
  { id: "q-3", kind: "appeal", rank: 3, title: "Appeal: 'Spreadsheets vs this'", by: "@mara.reels", amount: 0, tag: "Appeal", summary: "Creator says 'guaranteed' was in a quoted competitor ad. Transcript at 0:14 supports that. Assistant leans: overturn the prohibited-claim reason, keep the missing-label reason." },
  { id: "q-4", kind: "clip", rank: 4, title: "Flagged: near-duplicate of an approved clip", by: "@oakline", tag: "Flagged clip", summary: "92% transcript overlap with an approved clip from @duskpilot, different video. Could be a re-cut of the same source file." },
  { id: "q-5", kind: "campaign", rank: 5, title: "Tidepool Coffee refill, 1,200 USDC pool", by: "tidepool.eth", amount: 1200, tag: "Campaign", summary: "Funded. Same brand as an approved campaign. Story and disclosure label unchanged. Low risk." },
];

export const myCampaignIds = ["c-ledgerlane", "c-fieldnotes"];
