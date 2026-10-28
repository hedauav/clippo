/* View models for the creator workspace (PRD 4.9), shaped like the /api/creators, /api/shortlists and /api/hires responses
   (see API.md "Creator workspace"). The demo data below is used only when the service is unreachable and is labelled DEMO in the UI. */

export type Tier = "NEW" | "RISING" | "PRO" | "ELITE";
export type Platform = "youtube" | "x" | "instagram";
export const TIER_LABEL: Record<Tier, string> = { NEW: "New", RISING: "Rising", PRO: "Pro", ELITE: "Elite" };
export const TIER_RULE: Record<Tier, string> = {
  NEW: "Verified, no track record yet",
  RISING: "3+ approved clips, 60%+ pass rate",
  PRO: "10+ approved clips, 75%+ pass rate",
  ELITE: "25+ approved clips, 85%+ pass rate",
};
export const TIER_LIST: Tier[] = ["ELITE", "PRO", "RISING", "NEW"];

export type RateLine = { label: string; platform?: Platform; price: number };

export type DirCreator = {
  id: string;
  serial: string;
  name: string;
  bio: string;
  niches: string[];
  tier: Tier;
  platforms: Platform[];
  approvedClips: number;
  reliability: number; // 0..1
  verified: boolean;
  rates: RateLine[]; // set by the creator
  lowest: number;
};

export type Shortlist = { token: string; title: string; creators: DirCreator[] };

export type Objective = "awareness" | "demo" | "launch";
export const OBJECTIVE: Record<Objective, { t: string; d: string }> = {
  awareness: { t: "Awareness", d: "Name the product, say what it does, link the page. Counted in verified views." },
  demo: { t: "Product demo", d: "Show the product working on a real task, start to finish, on screen." },
  launch: { t: "Launch announcement", d: "One dated announcement with the offer. Posts inside the launch window." },
};
export type Brief = {
  title: string;
  brand: string;
  objective: Objective;
  summary: string;
  mustSay: string[];
  mustNot: string[];
  disclosure: string;
  due: string; // YYYY-MM-DD
  cap: number; // budget cap, USDC. Kept on the campaigner's side only; the API has no cap field.
};

export type Status = "PROPOSED" | "APPROVED" | "REJECTED";
export type Stage = "awaiting" | "funded" | "posted" | "verified" | "paid";
export const STAGES: Stage[] = ["funded", "posted", "verified", "paid"];
export const STAGE_LABEL: Record<Stage, string> = { awaiting: "Not funded", funded: "Funded", posted: "Posted", verified: "Verified", paid: "Paid" };

export type Line = {
  creatorId: string;
  name: string;
  tier: Tier;
  rateLabel: string;
  quantity: number;
  amount: number;
  status: Status;
  clips: { link: string; verdict: string | null; views: number }[];
  approvedClips: number;
  views: number;
  paid: number;
};
export type Workspace = {
  id: string;
  token: string | null; // share token; only the campaigner gets one
  serial: string;
  title: string;
  brief: { summary: string; mustSay: string[]; mustNot: string[]; disclosure: string; due: string; objective: string; brand: string; title?: string } | null;
  cap: number | null;
  status: "OPEN" | "FUNDING";
  campaignId: string | null;
  fundTx?: string;
  approvedTotal: number;
  lines: Line[];
};

export const stageOf = (l: Line, funded: boolean): Stage => {
  if (!funded || l.status !== "APPROVED") return "awaiting";
  if (l.paid > 0) return "paid";
  if (l.approvedClips > 0) return "verified";
  if (l.clips.length > 0) return "posted";
  return "funded";
};

export const emptyBrief = (): Brief => ({
  title: "",
  brand: "",
  objective: "demo",
  summary: "",
  mustSay: [""],
  mustNot: [""],
  disclosure: "#ad or Paid partnership, visible in the first 5 seconds",
  due: "",
  cap: 5000,
});

/* ---------- demo directory ---------- */
const c = (n: string, serial: string, bio: string, niches: string[], tier: Tier, platforms: Platform[], approvedClips: number, reliability: number, rates: RateLine[]): DirCreator => ({
  id: `cr-${serial}`, serial, name: n, bio, niches, tier, platforms, approvedClips, reliability, verified: true, rates, lowest: Math.min(...rates.map((r) => r.price)),
});

export const demoCreators: DirCreator[] = [
  c("@mara.reels", "0117", "Plain-spoken explainers on small-business books. Screen recordings, one take, no music.", ["Finance"], "ELITE", ["youtube", "instagram"], 142, 0.97, [{ label: "Short clip, up to 60s", price: 450 }, { label: "Long-form video, 5 to 12 min", price: 1900 }, { label: "Sponsored integration", price: 1100 }]),
  c("@chainnotes", "0148", "Wallet and settlement walkthroughs. Declines anything that promises returns.", ["Crypto"], "ELITE", ["youtube", "x"], 119, 0.96, [{ label: "Short clip, up to 60s", price: 520 }, { label: "Long-form video, 5 to 12 min", price: 2200 }, { label: "Sponsored integration", price: 1300 }]),
  c("@tomasbuilds", "0121", "Developer tools walked through on a real repo. Keeps the terminal on screen the whole time.", ["Software"], "PRO", ["youtube", "x"], 58, 0.93, [{ label: "Short clip, up to 60s", price: 280 }, { label: "Long-form video, 5 to 12 min", price: 1200 }, { label: "Sponsored integration", price: 700 }]),
  c("@nia.eats", "0124", "Weeknight cooking for two. Only features products she has bought herself first.", ["Food"], "PRO", ["instagram", "youtube"], 41, 0.95, [{ label: "Short clip, up to 60s", price: 220 }, { label: "Sponsored integration", price: 540 }]),
  c("@pixelwren", "0142", "Interface critiques with markup on screen. Honest about what she would change.", ["Design"], "PRO", ["youtube", "x"], 47, 0.94, [{ label: "Short clip, up to 60s", price: 300 }, { label: "Long-form video, 5 to 12 min", price: 1350 }, { label: "Sponsored integration", price: 760 }]),
  c("@sol.runs", "0133", "Marathon training logs. Four-week test periods before any review goes up.", ["Fitness"], "PRO", ["youtube", "instagram", "x"], 33, 0.91, [{ label: "Short clip, up to 60s", price: 260 }, { label: "Long-form video, 5 to 12 min", price: 980 }]),
  c("@ines.abroad", "0139", "Rail trips across Europe, shot vertical. Pays for her own tickets and says so.", ["Travel"], "RISING", ["instagram", "youtube"], 19, 0.89, [{ label: "Short clip, up to 60s", price: 120 }, { label: "Sponsored integration", price: 300 }]),
  c("@fiscalfern", "0156", "Bookkeeping for freelancers, in 45 seconds. Asks for the invoice data she will use up front.", ["Finance"], "RISING", ["instagram", "x"], 22, 0.9, [{ label: "Short clip, up to 60s", price: 140 }, { label: "Sponsored integration", price: 330 }]),
  c("@kellan.plays", "0130", "Strategy and city-builder streams cut down to clips. Reads the disclosure aloud.", ["Gaming"], "RISING", ["youtube"], 14, 0.86, [{ label: "Short clip, up to 60s", price: 90 }, { label: "Long-form video, 5 to 12 min", price: 380 }]),
  c("@dev.dani", "0151", "Short how-tos for first-year engineers. Clean captions, accurate transcripts.", ["Software"], "NEW", ["youtube", "instagram"], 0, 0, [{ label: "Short clip, up to 60s", price: 70 }, { label: "Sponsored integration", price: 180 }]),
];
export const NICHES = ["Finance", "Software", "Gaming", "Food", "Fitness", "Travel", "Design", "Crypto"];
