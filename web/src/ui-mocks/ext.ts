/* Typed demo data for the extension screens (sources, AI video, assistants, deals). Shapes follow the section appended to web/API.md;
   until that lands these are the contract. Every screen that renders them says "demo" when the service did not answer. */

export type SourceFile = { name: string; size: number; mime: string; url: string; local: boolean; uploadId?: string };

export type AiJobStatus = "queued" | "rendering" | "ready" | "failed" | "approved";
export type AiJob = {
  id: string;
  status: AiJobStatus;
  progress: number; // 0..100
  prompt: string;
  videoUrl: string | null; // null when nothing was rendered (demo)
  label: "AI-GENERATED";
  rightsConfirmed: boolean;
  error?: string;
};

export type Risk = { level: "block" | "warn" | "note"; text: string; rule: string };
export type BriefExplain = { plain: string; doList: string[]; avoidList: string[]; label: string };
export type Match = { campaignId: string; title: string; fit: number; why: string; pays: string; platform: string };

export type Dispute = {
  id: string;
  title: string;
  creator: string;
  verdictReason: string;
  appealNote: string;
  summary: string;
  recommend: "overturn" | "uphold" | "review";
  confidence: number;
  rank: number;
  rankWhy: string;
};

export type Anomaly = {
  id: string;
  campaign: string;
  creator: string;
  link: string;
  daily: number[]; // views added per day
  baseline: number; // typical daily gain for comparable clips
  note: string;
  held: boolean;
};

export type DealStatus = "PROPOSED" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
export type DealOffer = { by: "creator" | "campaigner" | "negotiator"; rate: number; note: string; at: string };
export type Deal = {
  id: string;
  campaignId: string;
  status: DealStatus;
  creator: string;
  offers: DealOffer[]; // newest last
  acceptedBy: { creator: boolean; campaigner: boolean };
  limits: { minRate: number; maxRate: number; poolLeft: number; autoAcceptUpTo: number };
};

export const demoLimits = { minRate: 1.2, maxRate: 3.6, poolLeft: 1740, autoAcceptUpTo: 2.8 };

export const demoMatches: Match[] = [
  { campaignId: "c-ledgerlane", title: "Ledgerlane: explain the 3-minute close", fit: 0.92, why: "Your last two approved clips were finance explainers under 60 seconds.", pays: "$2.40 per 1K views", platform: "YouTube" },
  { campaignId: "c-fieldnotes", title: "Fieldnotes: paper that syncs", fit: 0.74, why: "You post on X, which this brief allows. Needs a desk shot, which your channel already uses.", pays: "$3,000 pool, shared by views", platform: "X" },
  { campaignId: "c-ledgerlane", title: "Ledgerlane: month-end horror story", fit: 0.61, why: "Same product, looser format. Fewer required points to hit.", pays: "$1.80 per 1K views", platform: "Instagram" },
];

export const demoDisputes: Dispute[] = [
  {
    id: "s-901",
    title: "Appeal: Close the books before coffee",
    creator: "0x71c9…8e3b",
    verdictReason: "Clip never says the required point about overnight bank-feed reconciliation.",
    appealNote: "I say it at 0:34 over the screen recording. The agent read the captions, which are auto-generated and drop the sentence.",
    summary: "Transcript from captions omits 0:31 to 0:38. The clip audio, checked against the page text on screen, does mention reconciliation. Disclosure label present at 0:02.",
    recommend: "overturn",
    confidence: 0.84,
    rank: 1,
    rankWhy: "Rejected clip with 61,000 views, and the cause is a caption gap, not the creator.",
  },
  {
    id: "s-902",
    title: "Appeal: 3 minutes? Try 30 seconds",
    creator: "0x9be2…41cd",
    verdictReason: "Clip names a competitor and quotes a savings figure.",
    appealNote: "The competitor name is in a screenshot, I never say it.",
    summary: "Competitor name is spoken at 0:12 and shown on screen. A savings figure ($12,000 a year) is stated at 0:41. Both are on the prohibited list.",
    recommend: "uphold",
    confidence: 0.93,
    rank: 2,
    rankWhy: "Clear rule breach. Low urgency, 2,100 views.",
  },
  {
    id: "s-903",
    title: "Flagged: month end in a minute",
    creator: "0x4f10…77a0",
    verdictReason: "Needs human: transcript 91% similar to an earlier approved clip.",
    appealNote: "",
    summary: "Near-duplicate of a clip by another verified creator, posted 3 hours earlier. Same script, different voice. Could be a shared template from the brief.",
    recommend: "review",
    confidence: 0.55,
    rank: 3,
    rankWhy: "Duplicates affect payout split. Needs a person to compare the two.",
  },
];

export const demoAnomalies: Anomaly[] = [
  {
    id: "a-1",
    campaign: "Ledgerlane: explain the 3-minute close",
    creator: "0x4f10…77a0",
    link: "youtube.com/shorts/Zk3v9",
    daily: [320, 410, 380, 29800, 31400, 402],
    baseline: 380,
    note: "Two days at about 80 times the baseline, then back to normal. Pattern fits purchased views. 61,200 of 62,900 views arrived in 48 hours.",
    held: true,
  },
  {
    id: "a-2",
    campaign: "Fieldnotes: paper that syncs",
    creator: "0x9be2…41cd",
    link: "x.com/9be2/status/178",
    daily: [90, 140, 210, 1900, 450, 380],
    baseline: 180,
    note: "One 10x day, tapering. Could be a repost by a large account. Not conclusive.",
    held: false,
  },
];

export function seedDeal(campaignId: string): Deal {
  return {
    id: `d-${campaignId}`,
    campaignId,
    status: "COUNTERED",
    creator: "0x71c9…8e3b",
    offers: [
      { by: "creator", rate: 3.2, note: "Three finance clips live, 140K views each.", at: "Mon 09:12" },
      { by: "negotiator", rate: 2.6, note: "Counter on behalf of the campaigner. Inside the 1.20 to 3.60 band, above the 2.40 listed rate.", at: "Mon 09:12" },
    ],
    acceptedBy: { creator: false, campaigner: false },
    limits: demoLimits,
  };
}

export type AppealRec = {
  id: string;
  submissionId: string;
  stage: "CAMPAIGNER" | "ADMIN";
  status: "OPEN" | "UPHELD" | "OVERTURNED";
  dueAt: string;
  overdue: boolean;
  resolution: string | null;
};
