"use client";
/* Data seam between the UI and /api (see web/API.md).
   Every call hits the real endpoint. Only when the network or server is unreachable (fetch throws, or 5xx) do we fall back to
   demo data from src/ui-mocks, and flip the global demo flag so pages say so. 4xx errors are real and are surfaced to the user. */
import { useSyncExternalStore } from "react";
import { upload as blobUpload } from "@vercel/blob/client";
import { connectAndSignIn, hasWallet, loadChain } from "./wallet";
import {
  adminQueue as mockQueue,
  campaigns as mockCampaigns,
  earnings as mockEarnings,
  mySubmissions as mockSubs,
  type Campaign,
  type CampaignStatus,
  type EarningsData,
  type PayMode,
  type Platform,
  type QueueItem,
  type Submission,
  type Verdict,
} from "@/ui-mocks/data";

/* ---------- demo flag ----------
   Production paths never fall back to sample data. Sample data exists only when the build sets NEXT_PUBLIC_DEMO=1
   (screenshots). Without it, an unreachable or unconfigured service is an error the page must show, with retry. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
let demo = false;
const subs = new Set<() => void>();
function setDemo() {
  if (demo) return;
  demo = true;
  subs.forEach((s) => s());
}
export function useDemo() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => demo,
    () => false,
  );
}

/* ---------- transport ---------- */
export const SERVICE_DOWN = "The Clippo service did not answer.";
export const NOT_CONFIGURED = "Not configured on this deployment.";
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
class Unreachable extends Error {}

const NOT_CONFIGURED_CODES = new Set(["CHAIN_NOT_CONFIGURED", "NOT_CONFIGURED", "FEATURE_NOT_CONFIGURED"]);

async function req<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.json !== undefined ? "POST" : "GET",
      ...init,
      headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      credentials: "same-origin",
    });
  } catch {
    throw new Unreachable("network");
  }
  const body = await res.json().catch(() => null);
  const code: string | undefined = body?.error?.code;
  /* A 5xx with no structured error body (proxy page, crash, DB down) means the service is not there. A structured 5xx
     such as 503 CHAIN_NOT_CONFIGURED is the service speaking: surface it as written. */
  if (res.status >= 500 && (!code || code === "INTERNAL")) throw new Unreachable(body?.error?.message ?? "server");
  if (!res.ok) {
    const msg: string = body?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, code ?? "ERROR", code && NOT_CONFIGURED_CODES.has(code) ? `${NOT_CONFIGURED} ${msg}` : msg);
  }
  return body as T;
}

/** Run `real`. If the service is unreachable: in a NEXT_PUBLIC_DEMO=1 build run `fallback` (and mark the page as demo); otherwise throw a 503 the UI shows. */
async function withFallback<T>(real: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  try {
    return await real();
  } catch (e) {
    if (e instanceof Unreachable) {
      if (!DEMO) throw new ApiError(503, "SERVICE_UNAVAILABLE", SERVICE_DOWN);
      setDemo();
      await new Promise((r) => setTimeout(r, 350));
      return fallback();
    }
    throw e;
  }
}

/* ---------- API shapes (subset of API.md) ---------- */
type ApiStory = { summary: string; topic: string; requiredPoints: string[]; prohibitedClaims: string[]; disclosureLabel: string; attribution: string; description?: string };
type ApiCampaign = {
  id: string;
  title: string;
  story: ApiStory;
  contentSource: "UPLOAD" | "LINK" | "AI_GENERATED";
  contentUrl: string | null;
  platforms: ("YOUTUBE" | "X" | "INSTAGRAM")[];
  payoutMode: "PER_VIEW" | "HUMAN_SPLIT" | "POOL_SHARE";
  poolShareBasis: "VIEWS" | "APPROVED_CLIPS" | null;
  approver: "CAMPAIGNER_ONLY" | "CAMPAIGNER_AND_ADMIN" | null;
  poolSize: number;
  ratePer1k: number | null;
  viewTarget: number | null;
  eligibility: "ANYONE_VERIFIED" | "HIGHER_RANKED";
  status: "DRAFT" | "FUNDED" | "APPROVED" | "REJECTED" | "CLOSED";
  rejectReason: string | null;
  onchainId?: string | null;
  highValue?: boolean;
  campaignerFee?: number | null;
  createdAt: string;
  submissionCount?: number;
};
type ApiVerdict = { result: "APPROVE" | "REJECT" | "NEEDS_HUMAN"; confidence: number; reason: string; appealStatus: "NONE" | "PENDING" | "UPHELD" | "OVERTURNED"; flags?: string[] | null };
type ApiSub = {
  id: string;
  campaignId: string;
  link: string;
  metadata?: { title?: string; views?: number } | null;
  createdAt: string;
  verdict?: ApiVerdict | null;
  creator?: { id: string; wallet: string };
  campaign?: { id: string; title: string };
};

const short = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const MODE: Record<ApiCampaign["payoutMode"], PayMode> = { PER_VIEW: "per_view", HUMAN_SPLIT: "human_split", POOL_SHARE: "pool_share" };
const STATUS: Record<ApiCampaign["status"], CampaignStatus> = { DRAFT: "awaiting_funds", FUNDED: "pending_admin", APPROVED: "live", REJECTED: "rejected", CLOSED: "closed" };

export function adaptCampaign(c: ApiCampaign, perf?: { totalViews: number; approvedClips: number }): Campaign {
  const views = perf?.totalViews ?? 0;
  const rate = c.ratePer1k ?? 0;
  const paid = c.payoutMode === "PER_VIEW" ? Math.min(c.poolSize, (views / 1000) * rate) : 0;
  return {
    id: c.id,
    serial: c.id.slice(-4).toUpperCase(),
    title: c.title,
    brand: c.story.topic || "Open campaign",
    pitch: c.story.summary,
    story: c.story.description || c.story.summary,
    mustSay: c.story.requiredPoints,
    mustNot: c.story.prohibitedClaims,
    disclosure: c.story.disclosureLabel,
    platforms: c.platforms.map((p) => p.toLowerCase() as Platform),
    mode: MODE[c.payoutMode],
    shareBy: c.poolShareBasis === "VIEWS" ? "views" : c.poolShareBasis === "APPROVED_CLIPS" ? "approved_clips" : undefined,
    approver: c.approver === "CAMPAIGNER_AND_ADMIN" ? "me_and_admin" : c.approver === "CAMPAIGNER_ONLY" ? "me" : undefined,
    rate,
    pool: c.poolSize,
    paid,
    views,
    creators: 0,
    clips: perf?.approvedClips ?? c.submissionCount ?? 0,
    access: c.eligibility === "HIGHER_RANKED" ? "ranked" : "anyone",
    status: STATUS[c.status],
    closesIn: "",
    daily: [],
    hasSource: c.contentSource === "UPLOAD" && !!c.contentUrl,
    contentUrl: c.contentUrl ?? undefined,
    onchainId: c.onchainId ?? null,
    highValue: !!c.highValue,
    campaignerFee: c.campaignerFee ?? null,
    rejectReason: c.rejectReason,
  };
}

const VERDICT: Record<ApiVerdict["result"], Verdict> = { APPROVE: "approved", REJECT: "rejected", NEEDS_HUMAN: "needs_human" };

export function adaptSub(s: ApiSub): Submission {
  const v = s.verdict;
  return {
    id: s.id,
    campaignId: s.campaignId,
    url: s.link,
    platform: "youtube",
    handle: s.creator ? short(s.creator.wallet) : "you",
    title: s.metadata?.title || s.link.replace(/^https?:\/\/(www\.)?/, ""),
    verdict: v ? VERDICT[v.result] : "pending",
    confidence: v?.confidence ?? 0,
    reason: v?.reason ?? "Queued. The agent is reading the transcript.",
    views: s.metadata?.views ?? 0,
    earned: 0,
    at: day(s.createdAt),
    creatorWallet: s.creator?.wallet,
    appeal: v ? ({ NONE: "none", PENDING: "open", UPHELD: "upheld", OVERTURNED: "overturned" } as const)[v.appealStatus] : "none",
  };
}

/* ---------- session ---------- */
export type ApiUser = { id: string; role: "CAMPAIGNER" | "CREATOR" | "ADMIN"; wallet: string; verified: boolean };
/** Screenshot-only identities (NEXT_PUBLIC_DEMO=1, no wallet installed). Never reachable in a normal build. */
const DEMO_WALLETS = {
  CREATOR: "0x71c9e3b2a4d85f60c1b9a7e3d2f4801b5c6e8e3b",
  CAMPAIGNER: "0xca3b7a1e5d9042c8f6a1b3d7e9c2f4a8b0d6e1f5",
  ADMIN: "0xad00000000000000000000000000000000000001",
} as const;

/** World ID proof exactly as the backend takes it (API.md: POST /worldid/verify, /campaigns/:id/attest, /campaigns/:id/split). */
export type WorldProof = { nullifier_hash: string; proof: string; merkle_root?: string; verification_level?: string; signal?: string; /** the raw IDKit v4 result, for a v4-aware verifier */ idkitResult?: unknown };

/** What goes on the wire: the complete IDKit result when we have one (the backend forwards it to the Developer Portal), else the legacy fields. */
export const wireProof = (p: WorldProof): Record<string, unknown> => (p.idkitResult ? (p.idkitResult as Record<string, unknown>) : { nullifier_hash: p.nullifier_hash, proof: p.proof, merkle_root: p.merkle_root, verification_level: p.verification_level });

export const asApiError = (e: unknown) => {
  const x = e as { code?: string; status?: number; message?: string };
  return x && typeof x.code === "string" && typeof x.status === "number" ? new ApiError(x.status, x.code, x.message ?? "Request failed") : e;
};

export const session = {
  me: () => withFallback(() => req<{ user: ApiUser | null }>("/auth/me").then((r) => r.user), () => null),
  /** Real wallet connect + SIWE (GET /auth/nonce, wallet signature, POST /auth/session). */
  login: async (role?: "CAMPAIGNER" | "CREATOR", asAdmin = false): Promise<ApiUser> => {
    if (DEMO && !hasWallet()) {
      setDemo();
      const r = asAdmin ? "ADMIN" : (role ?? "CREATOR");
      return { id: "demo", wallet: DEMO_WALLETS[r], role: r, verified: false };
    }
    try {
      return (await connectAndSignIn(role)) as ApiUser;
    } catch (e) {
      throw asApiError(e);
    }
  },
  logout: () => withFallback(() => req("/auth/logout", { json: {} }), () => null),
  /** Backend World ID check. Throws ApiError (WORLD_ID_DENIED, ALREADY_USED, ...) and changes nothing on failure. */
  worldVerify: (proof: WorldProof) =>
    withFallback(
      () => req<{ user: ApiUser; mode: "mock" | "real" }>("/worldid/verify", { json: wireProof(proof) }).then((r) => r.user),
      () => ({ id: "demo", wallet: "", role: "CREATOR", verified: true }) as ApiUser,
    ),
};

/* ---------- reads ---------- */
export const api = {
  campaigns: () =>
    withFallback(
      () => req<{ campaigns: ApiCampaign[] }>("/campaigns").then((r) => r.campaigns.map((c) => adaptCampaign(c))),
      () => mockCampaigns,
    ),
  campaign: (id: string) =>
    withFallback(
      async () => {
        try {
          const r = await req<{ campaign: ApiCampaign; performance: { totalViews: number; approvedClips: number } }>(`/campaigns/${id}`);
          return adaptCampaign(r.campaign, r.performance);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }
      },
      () => mockCampaigns.find((c) => c.id === id) ?? null,
    ),
  myCampaigns: () =>
    withFallback(
      () => req<{ campaigns: ApiCampaign[] }>("/campaigns?mine=true").then((r) => r.campaigns.map((c) => adaptCampaign(c))),
      () => mockCampaigns.filter((c) => ["c-ledgerlane", "c-fieldnotes"].includes(c.id)),
    ),
  campaignSubmissions: (id: string) =>
    withFallback(
      () => req<{ submissions: ApiSub[] }>(`/campaigns/${id}/submissions`).then((r) => r.submissions.map(adaptSub)),
      () => mockSubs.filter((s) => s.campaignId === id),
    ),
  needsHuman: () =>
    withFallback(
      async () => {
        const { campaigns } = await req<{ campaigns: ApiCampaign[] }>("/campaigns?mine=true");
        const all = await Promise.all(campaigns.filter((c) => c.status === "APPROVED").map((c) => req<{ submissions: ApiSub[] }>(`/campaigns/${c.id}/submissions`)));
        return all.flatMap((r) => r.submissions).map(adaptSub).filter((s) => s.verdict === "needs_human");
      },
      () => mockSubs.filter((s) => s.verdict === "needs_human"),
    ),
  earnings: () =>
    withFallback(
      async (): Promise<EarningsData> => {
        const r = await req<{
          campaigns: { campaignId: string; title: string; payoutMode: ApiCampaign["payoutMode"]; approvedClips: number; views: number; estimatedEarnings: number | null }[];
          payouts: { id: string; campaignId: string; amount: number; claimedAmount?: number; status: "PENDING" | "CLAIMED"; claimTxHash: string | null; createdAt: string; frozen?: boolean; frozenReason?: string | null; releaseAt?: string | null }[];
          totals: { estimated: number; claimable: number; claimed: number; frozen?: number };
          fees?: { creatorBps: number; retentionDays: number };
        }>("/creator/earnings");
        const name = new Map(r.campaigns.map((c) => [c.campaignId, c.title]));
        return {
          payouts: r.payouts.map((p) => ({
            id: p.id,
            campaignId: p.campaignId,
            campaign: name.get(p.campaignId) ?? "Campaign",
            day: day(p.createdAt),
            amount: p.amount,
            claimed: p.status === "CLAIMED",
            tx: p.claimTxHash ?? undefined,
            outstanding: Math.max(0, p.amount - (p.claimedAmount ?? 0)),
            frozen: !!p.frozen,
            frozenReason: p.frozenReason ?? null,
            releaseAt: p.releaseAt ?? null,
          })),
          estimates: r.campaigns.map((c) => ({ campaignId: c.campaignId, title: c.title, mode: MODE[c.payoutMode], approvedClips: c.approvedClips, views: c.views, est: c.estimatedEarnings })),
          totals: r.totals,
          fees: r.fees,
        };
      },
      () => mockEarnings,
    ),
  adminQueue: () =>
    withFallback(
      async (): Promise<QueueItem[]> => {
        const r = await req<{
          pendingCampaigns: ApiCampaign[];
          flaggedSubmissions: ApiSub[];
          appeals: ApiSub[];
          fraudFlags?: { id: string; kind: "VIEW_ANOMALY" | "CLIP_DELETED"; campaignId: string; submissionId: string; day: string; details: Record<string, number | string> }[];
        }>("/admin/queue");
        const out: Omit<QueueItem, "rank">[] = [
          ...r.pendingCampaigns.map((c) => ({ id: c.id, kind: "campaign" as const, title: `${c.title}, ${c.poolSize.toLocaleString("en-US")} USDC pool${c.highValue ? " (high value)" : ""}`, by: "campaigner", amount: c.poolSize, tag: c.highValue ? "High-value campaign" : "Campaign", noteLabel: "Brief summary", summary: c.story.summary, onchainId: c.onchainId ?? null, highValue: !!c.highValue })),
          ...r.appeals.map((s) => ({ id: s.id, kind: "appeal" as const, title: `Appeal: ${s.metadata?.title || s.link}`, by: s.creator ? short(s.creator.wallet) : "creator", tag: "Appeal", noteLabel: "Agent reason", summary: s.verdict?.reason ?? "" })),
          ...r.flaggedSubmissions.map((s) => ({ id: s.id, kind: "clip" as const, title: `Flagged: ${s.metadata?.title || s.link}`, by: s.creator ? short(s.creator.wallet) : "creator", tag: "Flagged clip", noteLabel: "Agent note", summary: `${s.verdict?.reason ?? ""}${s.verdict?.flags?.length ? ` Flags: ${s.verdict.flags.join(", ")}.` : ""}` })),
          ...(r.fraudFlags ?? []).map((f) => ({
            id: f.id,
            flagId: f.id,
            kind: "pattern" as const,
            title: f.kind === "CLIP_DELETED" ? "Clip deleted or made private" : "Unusual view growth",
            by: f.day,
            tag: f.kind === "CLIP_DELETED" ? "Deleted clip" : "View pattern",
            noteLabel: "Detector",
            summary:
              f.kind === "CLIP_DELETED"
                ? `Video ${String(f.details.videoId ?? "")} is no longer readable. The creator's unclaimed payouts in this campaign are frozen until you decide.`
                : `Daily growth of ${Number(f.details.delta ?? 0).toLocaleString("en-US")} views against a threshold of ${Number(f.details.threshold ?? 0).toLocaleString("en-US")} (${Number(f.details.ratio ?? 0).toFixed(1)}x baseline). Views stay held until you decide.`,
          })),
        ];
        return out.map((x, i) => ({ ...x, rank: i + 1 }));
      },
      () => mockQueue,
    ),
};

/* ---------- writes ---------- */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Suggest = { title: string; story: ApiStory; suggestions: { label: string; poolSize: number; ratePer1k: number | null; viewTarget: number }[] };
export type NewCampaign = {
  title: string;
  story: ApiStory;
  contentSource: "UPLOAD" | "LINK" | "AI_GENERATED";
  contentUrl?: string;
  platforms: string[];
  payoutMode: "PER_VIEW" | "HUMAN_SPLIT" | "POOL_SHARE";
  poolShareBasis?: "VIEWS" | "APPROVED_CLIPS";
  approver?: "CAMPAIGNER_ONLY" | "CAMPAIGNER_AND_ADMIN";
  poolSize: number;
  ratePer1k?: number;
  viewTarget: number;
  eligibility: "ANYONE_VERIFIED" | "HIGHER_RANKED";
};

/** Net pool a split may spend (API: EXCEEDS_POOL is checked against the pool minus the campaigner-side fee). */
export const netPool = (c: { pool: number; campaignerFee?: number | null }) => Math.max(0, c.pool - (c.campaignerFee ?? 0));

export type SplitPlan = { splits: { creatorWallet: string; amount: number }[]; clips: number };
export type SplitProposal = {
  id: string;
  status: "PENDING" | "AWAITING_CHAIN" | "FINALIZED" | "SUPERSEDED";
  splitHash: string;
  twoParty?: boolean;
  approvals: { campaigner: boolean; admin: boolean };
  awaiting: string[];
};

/* ---------- Agent Pass (World AgentKit): the AI proposes, a human with a fresh World ID check approves ---------- */
export type AgentProposalView = {
  id: string;
  splitHash: string;
  splits: { creatorWallet: string; amount: number; reason?: string }[];
  total: number;
  rationale: string;
  /** "llm" = AI-written (advisory); "deterministic" = the non-AI pro-rata planner. */
  source?: "llm" | "deterministic";
  confidence?: number | null;
  flags?: string[];
  fallback?: { code: string; violations: string[] } | null;
  status: "PROPOSED" | "APPROVED" | "SUPERSEDED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
  agent: { address: string; mode: "agentbook" | "demo"; status: string; humanId: string } | null;
  approval?: { status: string; campaigner: boolean; admin: boolean } | null;
  campaignId?: string;
  campaignTitle?: string;
  twoParty?: boolean;
};
export type AuditEntry = {
  id: string;
  campaignId: string;
  campaignTitle?: string;
  proposalId: string | null;
  actorRole: string | null;
  event: "DELEGATED" | "PROPOSED" | "APPROVED" | "REFUSED";
  outcome: string;
  code: string | null;
  detail: string;
  splitHash: string | null;
  proofStatus: "VALID" | "NONE" | "CANCELLED" | "EXPIRED" | "REPLAYED" | "INVALID" | null;
  source: "server" | "client";
  createdAt: string;
};
export type AgentActivity = {
  mode: "agentbook" | "demo";
  agents?: { id: string; address: string; mode: string; status: string; humanId: string }[];
  proposals: AgentProposalView[];
  audit: AuditEntry[];
};

const DEMO_AGENT = { address: "0xa9e17000000000000000000000000000000d3m0", mode: "demo" as const, status: "ACTIVE", humanId: "demo-human…" };
export const agentPass = {
  /** Campaigner delegates the AI proposer (a World AgentKit agent wallet) to this campaign. Refused unless AgentBook resolves it to a human. */
  delegate: (campaignId: string) =>
    withFallback(() => req<{ agent: { address: string } }>(`/campaigns/${campaignId}/agent`, { json: {} }), () => ({ agent: { address: DEMO_AGENT.address } })),
  /** The agent proposes a split. Proposes only: nothing is payable until a human approves. */
  propose: (campaignId: string, mode: "llm" | "deterministic" = "llm") =>
    withFallback(
      () => req<{ proposal: AgentProposalView }>(`/campaigns/${campaignId}/split/propose`, { json: { mode } }).then((r) => r.proposal),
      (): AgentProposalView => ({ id: "demo-proposal", splitHash: "0xdemo", splits: [{ creatorWallet: DEMO_WALLETS.CREATOR, amount: 100 }], total: 100, rationale: "Demo proposal.", status: "PROPOSED", expiresAt: new Date(Date.now() + 1800_000).toISOString(), createdAt: new Date().toISOString(), agent: DEMO_AGENT }),
    ),
  activity: (campaignId: string) =>
    withFallback(() => req<AgentActivity>(`/campaigns/${campaignId}/agent`), (): AgentActivity => ({ mode: "demo", proposals: [], audit: [] })),
  /** Admin bench feed across campaigns. */
  feed: () => withFallback(() => req<AgentActivity>("/admin/agent-pass"), (): AgentActivity => ({ mode: "demo", proposals: [], audit: [] })),
  /** A check that ended in the widget (cancelled / expired / failed): log it. Best effort, never blocks the UI. */
  reportCheck: (campaignId: string, kind: "CANCELLED" | "EXPIRED" | "FAILED", proposalId?: string, splitHash?: string, message?: string) =>
    req(`/campaigns/${campaignId}/split/audit`, { json: { kind, proposalId, splitHash, message } }).catch(() => null),
};

export const actions = {
  suggest: (body: { idea: string; contentSource?: string; platforms?: string[]; payoutMode?: string; poolShareBasis?: string; approver?: string; eligibility?: string }) =>
    withFallback(
      () => req<Suggest>("/wizard/suggest", { json: body }),
      async (): Promise<Suggest> => {
        const t = body.idea.trim().replace(/.$/, "");
        const per = body.payoutMode === "PER_VIEW";
        return {
          title: t.length > 60 ? `${t.slice(0, 57)}…` : t,
          story: {
            summary: `${t}. Creators show the real thing in use, in their own voice, in 30 to 60 seconds.`,
            topic: t.split(/s+/).slice(0, 3).join(" "),
            requiredPoints: ["Name the product in the first 10 seconds", "State one concrete benefit you actually saw"],
            prohibitedClaims: ["Guaranteed results", "Health or financial claims", "Naming competitors"],
            disclosureLabel: "#ad or Paid partnership, visible in the first 5 seconds",
            attribution: "Credit the source footage",
          },
          suggestions: [
            { label: "Test run", poolSize: 1000, ratePer1k: per ? 2 : null, viewTarget: 500000 },
            { label: "Standard", poolSize: 5000, ratePer1k: per ? 2.4 : null, viewTarget: 2000000 },
            { label: "Push", poolSize: 15000, ratePer1k: per ? 3 : null, viewTarget: 5000000 },
          ],
        };
      },
    ),
  createCampaign: (c: NewCampaign) =>
    withFallback(
      () => req<{ campaign: ApiCampaign }>("/campaigns", { json: c }).then((r) => r.campaign.id),
      () => "c-new",
    ),
  /** Attach the source to a DRAFT campaign: an uploaded file, a link-a-video URL or an approved AI video job (API.md: POST /campaigns/:id/source). */
  setSource: (id: string, src: { uploadId: string } | { url: string } | { jobId: string }) =>
    withFallback(
      () => req(`/campaigns/${id}/source`, { json: src }),
      () => null,
    ),
  appeal: (submissionId: string, note: string) =>
    withFallback(() => req(`/submissions/${submissionId}/appeal`, { json: { note } }), () => pause(400)),
  verdict: (submissionId: string, result: "APPROVE" | "REJECT", reason: string) =>
    withFallback(() => req(`/submissions/${submissionId}/verdict`, { json: { result, reason } }), () => pause(300)),
  /** Admin: DISMISS = false alarm (restores the clip/unfreezes payouts), CONFIRM = fraud (clip stays excluded). */
  flag: (id: string, action: "DISMISS" | "CONFIRM") =>
    withFallback(() => req(`/admin/flags/${id}`, { method: "PATCH", json: { action } }), () => pause(300)),
  /** Admin: fresh single-use World ID proof for approving a (high-value) FUNDED campaign. Returns the attestation to pass to approveCampaign. */
  attest: (id: string, worldIdProof: WorldProof) =>
    withFallback(
      () => req<{ attestation: `0x${string}`; highValue: boolean; onchain: { functionName: "approveCampaign"; args: unknown[] } | null }>(`/campaigns/${id}/attest`, { json: { worldIdProof: wireProof(worldIdProof) } }),
      () => ({ attestation: ("0x" + "0".repeat(64)) as `0x${string}`, highValue: true, onchain: null }),
    ),
  /* API-only legs: used when the escrow chain is not configured (the server then decides) or after the on-chain tx, via lib/chain/client.ts */
  approveCampaign: (id: string, txHash?: string) => withFallback(() => req(`/campaigns/${id}/approve`, { json: txHash ? { txHash } : {} }), () => pause(300)),
  rejectCampaign: (id: string, reason: string, txHash?: string) => withFallback(() => req(`/campaigns/${id}/reject`, { json: { reason, txHash } }), () => pause(300)),
  closeCampaign: (id: string, txHash?: string) => withFallback(() => req(`/campaigns/${id}/close`, { json: txHash ? { txHash } : {} }), () => pause(300)),
  /** The split both approvers must submit identically: one share per creator, by approved clips, of the NET pool, floored to cents. */
  splitPlan: (campaign: { id: string; pool: number; campaignerFee?: number | null }) =>
    withFallback(
      async (): Promise<SplitPlan> => {
        const { submissions } = await req<{ submissions: ApiSub[] }>(`/campaigns/${campaign.id}/submissions`);
        const approved = submissions.map(adaptSub).filter((x) => x.verdict === "approved" && x.creatorWallet);
        if (approved.length === 0) throw new ApiError(400, "NOTHING_TO_SPLIT", "No approved clips yet, so there is nobody to pay.");
        const counts = new Map<string, number>();
        approved.forEach((x) => counts.set(x.creatorWallet!, (counts.get(x.creatorWallet!) ?? 0) + 1));
        const net = netPool(campaign);
        const total = approved.length;
        return { clips: total, splits: [...counts].map(([creatorWallet, n]) => ({ creatorWallet, amount: Math.floor((net * n * 100) / total) / 100 })) };
      },
      () => ({ clips: 1, splits: [{ creatorWallet: DEMO_WALLETS.CREATOR, amount: campaign.pool }] }),
    ),
  /** Fiat on-ramp: the backend creates the provider (Transak) session and returns the URL to open. */
  onrampSession: (campaignId: string | null, amount: number) =>
    req<{ url?: string; sessionUrl?: string; widgetUrl?: string }>("/onramp/session", { json: { campaignId, amount, currency: "USDC" } }).then((r) => {
      const url = r.url ?? r.sessionUrl ?? r.widgetUrl;
      if (!url) throw new ApiError(502, "BAD_ONRAMP", "The on-ramp answered without a session address.");
      return url;
    }),
  channels: () =>
    withFallback(
      () => req<{ channels: { id: string; platform: string; handle: string; verified: boolean }[] }>("/channels").then((r) => r.channels),
      () => [
        { id: "m1", platform: "YOUTUBE", handle: "@mara.reels", verified: true },
        { id: "m2", platform: "YOUTUBE", handle: "@mara.clips", verified: true },
      ],
    ),
};

type WalletishError = { code?: number | string; name?: string; shortMessage?: string; message?: string; cause?: WalletishError };
const rejected = (e: WalletishError | undefined): boolean => !!e && (e.code === 4001 || e.code === "ACTION_REJECTED" || e.name === "UserRejectedRequestError" || rejected(e.cause));
export const isUnavailable = (e: unknown) => e instanceof ApiError && e.code === "SERVICE_UNAVAILABLE";
export const isNotConfigured = (e: unknown) => e instanceof ApiError && e.message.startsWith(NOT_CONFIGURED);

/** User-facing text for any thrown value: backend errors as written, wallet rejections and network failures in plain words. */
export const errText = (e: unknown, fallback = "Something went wrong. Nothing was changed.") => {
  if (e instanceof ApiError) return e.message;
  if (rejected(e as WalletishError)) return "You closed the wallet prompt. Nothing was changed.";
  if (e instanceof TypeError) return `${SERVICE_DOWN} Nothing was changed.`;
  const x = e as WalletishError;
  if (x?.shortMessage) return x.shortMessage;
  return e instanceof Error && e.message ? e.message : fallback;
};

/* =====================================================================================================================
   EXT SECTION (UI): X/Instagram proof, source upload, AI video jobs, assistants, negotiator deals.
   Paths follow the "Platforms, source content, AI video, assistants, appeals" section of web/API.md. Only a NEXT_PUBLIC_DEMO=1
   build may answer from the demo store in src/ui-mocks/ext.ts; otherwise failures surface to the page.
   ===================================================================================================================== */
import {
  demoAnomalies,
  demoDisputes,
  demoLimits,
  demoMatches,
  seedDeal,
  type AiJob,
  type AppealRec,
  type Anomaly,
  type BriefExplain,
  type Deal,
  type DealOffer,
  type Dispute,
  type Match,
  type Risk,
  type SourceFile,
} from "@/ui-mocks/ext";

export type LinkPlatform = "youtube" | "x" | "instagram" | "other";
export function detectPlatform(link: string): LinkPlatform {
  const h = link.trim().toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, "");
  if (/^(youtube\.com|youtu\.be)\//.test(h)) return "youtube";
  if (/^(x\.com|twitter\.com)\//.test(h)) return "x";
  if (/^instagram\.com\//.test(h)) return "instagram";
  return "other";
}

/** Real call; in a demo build a 404/405 (route absent) also falls to the demo store. Production surfaces the error. */
async function extReq<T>(path: string, real: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  return withFallback(
    async () => {
      try {
        return await real();
      } catch (e) {
        if (DEMO && e instanceof ApiError && (e.status === 404 || e.status === 405)) throw new Unreachable(path);
        throw e;
      }
    },
    fallback,
  );
}

/* ---------- uploads (XHR so we get real progress) ---------- */
export const MAX_UPLOAD = 200 * 1024 * 1024; /* server default SOURCE_MAX_BYTES; the server enforces its own limit and says so (413 FILE_TOO_LARGE) */
/* On Vercel a function request body is capped at 4.5 MB, so larger clips go browser -> Vercel Blob with a server-issued token
   (GET /api/uploads/direct says whether this deployment does that), then POST /api/uploads/complete registers them. */
const DIRECT_MIN = 4_000_000;
let directCfg: Promise<boolean> | null = null;
const directEnabled = () =>
  (directCfg ??= fetch("/api/uploads/direct", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { direct: false }))
    .then((j: { direct?: boolean }) => !!j.direct)
    .catch(() => false));

async function uploadDirect(file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<SourceFile> {
  const me = (await (await fetch("/api/auth/me", { credentials: "include" })).json().catch(() => null)) as { user?: { id?: string } } | null;
  const owner = (me?.user?.id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "anon";
  const ext = file.type === "video/webm" ? "webm" : file.type === "video/quicktime" ? "mov" : "mp4";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  const key = `${owner}/${rand}.${ext}`;
  try {
    await blobUpload(key, file, {
      access: "private",
      handleUploadUrl: "/api/uploads/direct",
      multipart: file.size > 20 * 1024 * 1024,
      contentType: file.type,
      abortSignal: signal,
      onUploadProgress: (e) => onProgress(Math.round(e.percentage)),
    });
  } catch (e) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    throw new ApiError(502, "UPLOAD_FAILED", e instanceof Error ? e.message : "Upload to storage failed");
  }
  const r = await fetch("/api/uploads/complete", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, name: file.name }) });
  const body = (await r.json().catch(() => null)) as { upload?: Partial<SourceFile> & { id?: string }; error?: { code?: string; message?: string } } | null;
  if (!r.ok || !body?.upload?.url) throw new ApiError(r.status, body?.error?.code ?? "ERROR", body?.error?.message ?? `Upload failed (${r.status})`);
  onProgress(100);
  const u = body.upload;
  return { name: u.name ?? file.name, size: u.size ?? file.size, mime: u.mime ?? file.type, url: u.url!, local: false, uploadId: u.id };
}

export async function uploadSource(file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<SourceFile> {
  if (!DEMO && file.size > DIRECT_MIN && (await directEnabled())) return uploadDirect(file, onProgress, signal);
  return uploadViaRoute(file, onProgress, signal);
}

function uploadViaRoute(file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<SourceFile> {
  const demoUpload = async (): Promise<SourceFile> => {
    setDemo();
    for (let p = 0; p <= 100; p += 10) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      onProgress(p);
      await pause(110);
    }
    return { name: file.name, size: file.size, mime: file.type, url: URL.createObjectURL(file), local: true };
  };
  return new Promise<SourceFile>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/uploads");
    x.withCredentials = true;
    x.upload.onprogress = (ev) => ev.lengthComputable && onProgress(Math.round((ev.loaded / ev.total) * 100));
    x.onerror = () => (DEMO ? demoUpload().then(resolve, reject) : reject(new ApiError(503, "SERVICE_UNAVAILABLE", SERVICE_DOWN)));
    x.onabort = () => reject(new DOMException("aborted", "AbortError"));
    x.onload = () => {
      let body: { upload?: Partial<SourceFile>; url?: string; error?: { code?: string; message?: string } } | null = null;
      try {
        body = JSON.parse(x.responseText);
      } catch {}
      if (DEMO && (x.status === 404 || x.status === 405 || x.status >= 500)) return demoUpload().then(resolve, reject);
      if (x.status >= 500 && !body?.error?.code) return reject(new ApiError(503, "SERVICE_UNAVAILABLE", SERVICE_DOWN));
      if (x.status >= 400) return reject(new ApiError(x.status, body?.error?.code ?? "ERROR", body?.error?.message ?? `Upload failed (${x.status})`));
      const u: Partial<SourceFile> = body?.upload ?? { url: body?.url };
      const url = u.url;
      if (!url) return reject(new ApiError(502, "BAD_UPLOAD", "The server accepted the file but returned no address for it."));
      onProgress(100);
      resolve({ name: u.name ?? file.name, size: u.size ?? file.size, mime: u.mime ?? file.type, url, local: false, uploadId: u.uploadId ?? (u as { id?: string }).id });
    };
    signal?.addEventListener("abort", () => x.abort());
    const fd = new FormData();
    fd.append("file", file);
    x.send(fd);
  });
}

/* ---------- AI video jobs ---------- */
/** The service serves rendered video at /ai-video/jobs/:id/video; use it when the job carries no address of its own. */
const jobNorm = (j: AiJob): AiJob => (j.videoUrl || (j.status !== "ready" && j.status !== "approved") ? j : { ...j, videoUrl: `/api/ai-video/jobs/${j.id}/video` });
const jobStore = new Map<string, { at: number; job: AiJob; approved: boolean }>();
const jobView = (id: string): AiJob => {
  const r = jobStore.get(id)!;
  const t = (Date.now() - r.at) / 1000;
  const status: AiJob["status"] = r.approved ? "approved" : t < 2 ? "queued" : t < 9 ? "rendering" : "ready";
  return { ...r.job, status, progress: status === "queued" ? 0 : status === "rendering" ? Math.round(((t - 2) / 7) * 100) : 100 };
};

/* ---------- deals ---------- */
const dealStore = new Map<string, Deal>();
const dealFor = (cid: string) => {
  if (!dealStore.has(cid)) dealStore.set(cid, seedDeal(cid));
  return dealStore.get(cid)!;
};
/** Backend offers carry ISO timestamps; the panel shows a short local one. */
const niceDeal = (d: Deal | null): Deal | null =>
  d && { ...d, offers: d.offers.map((o) => (/^d{4}-dd-ddT/.test(o.at) ? { ...o, at: new Date(o.at).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) } : o)) };
const stamp = () => new Date().toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export const extActions = {
  /* appeals: the record behind a rejected clip (campaigner first, then optional admin escalation) */
  appealFor: (submissionId: string) =>
    extReq(
      "/appeals",
      async (): Promise<AppealRec | null> => {
        const r = await req<{ appeals: AppealRec[] }>("/appeals");
        return r.appeals.find((a) => a.submissionId === submissionId) ?? null;
      },
      () => null,
    ),
  escalate: (appealId: string) =>
    extReq(
      `/appeals/${appealId}/escalate`,
      () => req(`/appeals/${appealId}/escalate`, { json: {} }),
      () => pause(300),
    ),
  /* channel proof for any supported platform. `review: true` means the platform could not be read automatically. */
  channelAdd: (platform: LinkPlatform, handle: string) =>
    extReq(
      "/channels",
      () => req<{ channel: { id: string; verificationCode: string; verified: boolean; handle: string } }>("/channels", { json: { platform: platform.toUpperCase(), handle } }).then((r) => r.channel),
      () => ({ id: "demo-ch", handle, verified: false, verificationCode: `CLP-${handle.replace(/\W/g, "").slice(0, 3).toUpperCase().padEnd(3, "X")}-7K3Q` }),
    ),
  channelVerify: (id: string, platform: LinkPlatform, attempt: number) =>
    extReq(
      `/channels/${id}/verify`,
      async () => {
        const r = await req<{ channel?: { verified?: boolean; status?: string }; review?: boolean; status?: string }>(`/channels/${id}/verify`, { json: {} });
        const review = r.review === true || r.status === "NEEDS_HUMAN" || r.channel?.status === "NEEDS_HUMAN" || (r.channel?.verified === false && platform !== "youtube");
        return { review };
      },
      async () => {
        await pause(600);
        if (platform !== "youtube") return { review: true };
        if (attempt < 2) throw new ApiError(422, "CODE_NOT_FOUND", "Code not found in the bio yet.");
        return { review: false };
      },
    ),
  /* link submit for YouTube, X and Instagram. X/Instagram that cannot be read come back NEEDS_HUMAN, never auto-approved. */
  submitLink: (campaignId: string, link: string) =>
    extReq(
      "/submissions",
      async (): Promise<Submission> => {
        const platform = detectPlatform(link);
        const { channels } = await req<{ channels: { id: string; verified: boolean; platform?: string }[] }>("/channels");
        const ch = channels.find((c) => c.verified && (c.platform ?? "YOUTUBE").toLowerCase() === platform);
        if (!ch) throw new ApiError(403, "CHANNEL_UNVERIFIED", `Prove a ${platform === "x" ? "X" : platform === "instagram" ? "Instagram" : "YouTube"} channel first. Your account has none verified.`);
        const r = await req<{ submission: ApiSub }>("/submissions", { json: { campaignId, channelId: ch.id, link } });
        return { ...adaptSub(r.submission), platform: platform === "other" ? "youtube" : platform };
      },
      async (): Promise<Submission> => {
        const platform = detectPlatform(link);
        if (platform === "other") throw new ApiError(400, "BAD_LINK", "That link is not YouTube, X or Instagram.");
        await pause(500);
        const readable = platform === "youtube";
        return {
          id: `n-${link.length}-${Date.now()}`,
          campaignId,
          url: link,
          platform,
          handle: "you",
          title: link.replace(/^https?:\/\/(www\.)?/, ""),
          verdict: readable ? "pending" : "needs_human",
          confidence: 0,
          reason: readable ? "Queued. The agent is reading the transcript." : "Could not read this post automatically. A person will review it, usually within a day.",
          views: 0,
          earned: 0,
          at: "Just now",
        };
      },
    ),

  /* AI-generated video: create, poll, approve. */
  aiCreate: (prompt: string, rightsConfirmed: boolean) =>
    extReq(
      "/ai-video/jobs",
      () => req<{ job: AiJob }>("/ai-video/jobs", { json: { prompt, rightsConfirmed } }).then((r) => jobNorm(r.job)),
      () => {
        const id = `job-${Date.now()}`;
        jobStore.set(id, { at: Date.now(), approved: false, job: { id, status: "queued", progress: 0, prompt, videoUrl: null, label: "AI-GENERATED", rightsConfirmed } });
        return jobView(id);
      },
    ),
  aiStatus: (id: string) =>
    extReq(
      `/ai-video/jobs/${id}`,
      () => req<{ job: AiJob }>(`/ai-video/jobs/${id}`).then((r) => jobNorm(r.job)),
      () => (jobStore.has(id) ? jobView(id) : Promise.reject(new ApiError(404, "NOT_FOUND", "That job no longer exists."))),
    ),
  aiApprove: (id: string) =>
    extReq(
      `/ai-video/jobs/${id}/approve`,
      () => req<{ job: AiJob }>(`/ai-video/jobs/${id}/approve`, { json: {} }).then((r) => jobNorm(r.job)),
      async () => {
        const r = jobStore.get(id);
        if (!r) throw new ApiError(404, "NOT_FOUND", "That job no longer exists.");
        await pause(250);
        r.approved = true;
        return jobView(id);
      },
    ),

  /* creator assistant */
  explainBrief: (campaignId: string, brief: { story: string; mustSay: string[]; mustNot: string[]; disclosure: string }) =>
    extReq(
      "/assistant/creator/explain",
      () => req<{ explanation: BriefExplain }>("/assistant/creator/explain", { json: { campaignId } }).then((r) => r.explanation),
      async (): Promise<BriefExplain> => {
        await pause(450);
        return {
          plain: `${brief.story.split(". ")[0].replace(/\.$/, "")}. Make one short clip that shows it, say the required points in your own words, and show the label early.`,
          doList: brief.mustSay,
          avoidList: brief.mustNot,
          label: brief.disclosure,
        };
      },
    ),
  riskCheck: (campaignId: string, input: { link: string; caption: string }, brief: { mustSay: string[]; mustNot: string[]; disclosure: string }) =>
    extReq(
      "/assistant/creator/check",
      () => req<{ risks: Risk[] }>("/assistant/creator/check", { json: { campaignId, ...input } }).then((r) => r.risks),
      async (): Promise<Risk[]> => {
        await pause(500);
        const out: Risk[] = [];
        const cap = input.caption.toLowerCase();
        const platform = detectPlatform(input.link);
        if (input.link && platform === "other") out.push({ level: "block", text: "This link is not YouTube, X or Instagram. It cannot be submitted.", rule: "Platforms" });
        if (input.link && platform !== "youtube" && platform !== "other") out.push({ level: "note", text: "This platform cannot be read automatically. Expect a human review, not an instant verdict.", rule: "Review" });
        const label = brief.disclosure.split(/\bor\b|,/i).map((x) => x.replace(/['"#]/g, "").trim().toLowerCase()).filter((x) => x.length > 1);
        if (input.caption && !label.some((l) => l.split(/\s+/)[0] && cap.includes(l.split(/\s+/)[0]))) out.push({ level: "block", text: `The caption has no disclosure label. The brief requires: ${brief.disclosure}.`, rule: "Disclosure" });
        brief.mustNot.forEach((m) => {
          const k = m.toLowerCase().split(/\s+/).find((w) => w.length > 6);
          if (k && cap.includes(k)) out.push({ level: "block", text: `Mentions "${k}", which falls under a prohibited claim: ${m}.`, rule: "Must not say" });
        });
        brief.mustSay.forEach((m) => {
          const k = m.toLowerCase().split(/\s+/).find((w) => w.length > 5);
          if (input.caption && k && !cap.includes(k)) out.push({ level: "warn", text: `Caption does not touch: ${m}. Say it out loud in the clip, since the agent reads the transcript.`, rule: "Must say" });
        });
        if (out.length === 0) out.push({ level: "note", text: "No obvious problems in what you pasted. The agent still reads the clip itself.", rule: "Clear" });
        return out;
      },
    ),
  matches: () =>
    extReq(
      "/assistant/creator/matches",
      () => req<{ matches: Match[] }>("/assistant/creator/matches").then((r) => r.matches),
      async () => {
        await pause(400);
        return demoMatches;
      },
    ),

  /* admin assistant */
  disputes: () =>
    extReq(
      "/assistant/admin/disputes",
      () => req<{ disputes: Dispute[] }>("/assistant/admin/disputes").then((r) => r.disputes),
      async () => {
        await pause(450);
        return demoDisputes;
      },
    ),
  growth: () =>
    extReq(
      "/assistant/admin/growth",
      () => req<{ anomalies: Anomaly[] }>("/assistant/admin/growth").then((r) => r.anomalies),
      async () => {
        await pause(450);
        return demoAnomalies;
      },
    ),
  setHold: (id: string, held: boolean) =>
    extReq(
      `/assistant/admin/growth/${id}/hold`,
      () => req(`/assistant/admin/growth/${id}/hold`, { json: { held } }),
      () => pause(250),
    ),

  /* negotiator deals */
  deal: (campaignId: string) =>
    extReq(
      `/campaigns/${campaignId}/deal`,
      async (): Promise<Deal | null> => {
        const r = await req<{ deal: Deal | null }>(`/campaigns/${campaignId}/deal`);
        return niceDeal(r.deal);
      },
      async (): Promise<Deal | null> => {
        await pause(350);
        return dealFor(campaignId);
      },
    ),
  propose: (campaignId: string, by: "creator" | "campaigner", rate: number, note: string) =>
    extReq(
      `/campaigns/${campaignId}/deal`,
      () => req<{ deal: Deal }>(`/campaigns/${campaignId}/deal`, { json: { rate, note } }).then((r) => niceDeal(r.deal)!),
      async (): Promise<Deal> => {
        await pause(400);
        const d = dealFor(campaignId);
        const lim = d.limits ?? demoLimits;
        if (rate < lim.minRate || rate > lim.maxRate) throw new ApiError(400, "OUTSIDE_LIMITS", `Offers must sit between $${lim.minRate.toFixed(2)} and $${lim.maxRate.toFixed(2)} per 1K views.`);
        const offer: DealOffer = { by, rate, note, at: stamp() };
        d.offers.push(offer);
        d.acceptedBy = { creator: false, campaigner: false };
        d.status = "COUNTERED";
        if (by === "creator" && rate <= lim.autoAcceptUpTo) {
          d.offers.push({ by: "negotiator", rate, note: `Inside the auto-accept limit of $${lim.autoAcceptUpTo.toFixed(2)}. Accepted for the campaigner. You still confirm.`, at: stamp() });
          d.acceptedBy.campaigner = true;
        }
        return d;
      },
    ),
  accept: (campaignId: string, side: "creator" | "campaigner") =>
    extReq(
      `/campaigns/${campaignId}/deal/accept`,
      () => req<{ deal: Deal }>(`/campaigns/${campaignId}/deal/accept`, { json: {} }).then((r) => niceDeal(r.deal)!),
      async (): Promise<Deal> => {
        await pause(350);
        const d = dealFor(campaignId);
        d.acceptedBy[side] = true;
        if (d.acceptedBy.creator && d.acceptedBy.campaigner) d.status = "ACCEPTED";
        return d;
      },
    ),
  decline: (campaignId: string) =>
    extReq(
      `/campaigns/${campaignId}/deal/decline`,
      () => req<{ deal: Deal }>(`/campaigns/${campaignId}/deal/decline`, { json: {} }).then((r) => niceDeal(r.deal)!),
      async (): Promise<Deal> => {
        await pause(300);
        const d = dealFor(campaignId);
        d.status = "DECLINED";
        return d;
      },
    ),
};

/* ---------- creator workspace (PRD 4.9) ----------
   Real calls: /creators, /shortlists, /briefs, /hires (API.md "Creator workspace"). When the service is unreachable the
   same view models come from the demo store (src/components/workspace/mockStore.ts) and the demo flag flips. */
import { OBJECTIVE, TIER_LABEL, type Brief, type DirCreator, type Line, type Platform as WsPlatform, type Shortlist, type Status, type Tier, type Workspace } from "@/ui-mocks/workspace";
import * as wsMock from "./workspace/mockStore";

type ApiCard = {
  creatorId: string; displayName: string; bio: string; niches: string[]; rateCard: { label: string; platform?: string; price: number }[];
  verifiedBadge: boolean; tier: Tier; approvedClips: number; reliability: number; platforms: string[]; lowestRate: number;
};
type ApiHireView = {
  hire: { id: string; title: string; status: "OPEN" | "FUNDING"; campaignId: string | null; campaignStatus?: ApiCampaign["status"] | null; createdAt: string; shareToken?: string };
  brief: { title: string; story: ApiStory; deliverables: string[]; deadline: string | null } | null;
  budget: { approvedTotal: number };
  creators: {
    creatorId: string; displayName: string | null; tier: Tier; rateLabel: string; quantity: number; amount: number; status: Status;
    tracking: { clips: { link: string; verdict: string | null; views: number }[]; approvedClips: number; views: number; paid: number };
  }[];
};
const capKey = (id: string) => `clippo-ws-cap-${id}`;
const lc = (p: string) => p.toLowerCase() as WsPlatform;

export const adaptCard = (c: ApiCard): DirCreator => ({
  id: c.creatorId, serial: c.creatorId.slice(-4).toUpperCase(), name: c.displayName, bio: c.bio, niches: c.niches, tier: c.tier,
  platforms: c.platforms.map(lc), approvedClips: c.approvedClips, reliability: c.reliability, verified: c.verifiedBadge,
  rates: c.rateCard.map((r) => ({ label: r.label, platform: r.platform ? lc(r.platform) : undefined, price: r.price })), lowest: c.lowestRate,
});

function adaptHire(v: ApiHireView): Workspace {
  let cap: number | null = null;
  try {
    const raw = localStorage.getItem(capKey(v.hire.id));
    cap = raw ? Number(raw) : null;
  } catch {
    /* storage blocked */
  }
  const lines: Line[] = v.creators.map((c) => ({
    creatorId: c.creatorId, name: c.displayName ?? short(c.creatorId), tier: c.tier, rateLabel: c.rateLabel, quantity: c.quantity, amount: c.amount, status: c.status,
    clips: c.tracking.clips, approvedClips: c.tracking.approvedClips, views: c.tracking.views, paid: c.tracking.paid,
  }));
  const s = v.brief?.story;
  return {
    id: v.hire.id, token: v.hire.shareToken ?? null, serial: v.hire.id.slice(-4).toUpperCase(), title: v.hire.title,
    brief: v.brief && s ? { title: v.brief.title, summary: s.summary, mustSay: s.requiredPoints, mustNot: s.prohibitedClaims, disclosure: s.disclosureLabel, due: v.brief.deadline ?? "", objective: v.brief.deliverables[0] ?? "", brand: s.topic } : null,
    cap: cap && cap > 0 ? cap : null, /* a campaign that exists but is still DRAFT is not funded: the hire stays fundable (retry) */ status: v.hire.status === "FUNDING" && v.hire.campaignStatus === "DRAFT" ? "OPEN" : v.hire.status, campaignId: v.hire.campaignId, approvedTotal: v.budget.approvedTotal, lines,
  };
}
const notFound = <T,>(e: unknown, v: T) => {
  if (e instanceof ApiError && e.status === 404) return v;
  throw e;
};

/** Demo records (ids/tokens made by the demo store) never go to the service. */
const demoOr = <T,>(isDemo: boolean, real: () => Promise<T>, mock: () => T): Promise<T> =>
  DEMO && isDemo ? (setDemo(), pause(300).then(mock)) : withFallback(real, mock);

export const ws = {
  directory: () =>
    withFallback(
      () => req<{ creators: ApiCard[] }>("/creators?limit=200").then((r) => r.creators.map(adaptCard)),
      () => wsMock.mockDirectory(),
    ),
  createList: (title: string, ids: string[]) =>
    demoOr(ids.some(wsMock.isDemoId),
      async (): Promise<Shortlist> => {
        const r = await req<{ shortlist: { title: string; shareToken: string }; creators: ApiCard[] }>("/shortlists", { json: { title, creatorIds: ids } });
        return { token: r.shortlist.shareToken, title: r.shortlist.title, creators: r.creators.map(adaptCard) };
      },
      () => wsMock.mockCreateList(title, ids),
    ),
  list: (token: string) =>
    demoOr(wsMock.isDemoId(token),
      async (): Promise<Shortlist | null> => {
        try {
          const r = await req<{ shortlist: { title: string }; creators: ApiCard[] }>(`/shortlists/shared/${encodeURIComponent(token)}`);
          return { token, title: r.shortlist.title, creators: r.creators.map(adaptCard) };
        } catch (e) {
          return notFound(e, null);
        }
      },
      () => wsMock.mockGetList(token),
    ),
  createWorkspace: (brief: Brief, picks: { creatorId: string; rateLabel: string; quantity: number }[]) =>
    demoOr(picks.some((p) => wsMock.isDemoId(p.creatorId)),
      async (): Promise<Workspace> => {
        const { brief: b } = await req<{ brief: { id: string } }>("/briefs", {
          json: {
            title: brief.title,
            story: { summary: brief.summary, topic: brief.brand, requiredPoints: brief.mustSay, prohibitedClaims: brief.mustNot, disclosureLabel: brief.disclosure, attribution: `Credit ${brief.brand}` },
            deliverables: [OBJECTIVE[brief.objective].t],
            deadline: brief.due,
          },
        });
        const h = await req<ApiHireView>("/hires", { json: { title: brief.title, briefId: b.id } });
        for (const p of picks) await req(`/hires/${h.hire.id}/creators`, { json: p });
        try {
          localStorage.setItem(capKey(h.hire.id), String(brief.cap));
        } catch {
          /* storage blocked: the cap simply is not shown next visit */
        }
        return adaptHire(await req<ApiHireView>(`/hires/${h.hire.id}`));
      },
      () => wsMock.mockCreateWorkspace(brief, picks),
    ),
  workspace: (id: string) =>
    demoOr(wsMock.isDemoId(id),
      async (): Promise<Workspace | null> => {
        try {
          return adaptHire(await req<ApiHireView>(`/hires/${id}`));
        } catch (e) {
          return notFound(e, null);
        }
      },
      () => wsMock.mockGetWorkspace(id),
    ),
  shared: (token: string) =>
    demoOr(wsMock.isDemoId(token),
      async (): Promise<Workspace | null> => {
        try {
          return adaptHire(await req<ApiHireView>(`/hires/shared/${encodeURIComponent(token)}`));
        } catch (e) {
          return notFound(e, null);
        }
      },
      () => wsMock.mockGetShared(token),
    ),
  /** Per-creator approval. The server returns the live budget total. */
  setStatus: (w: Workspace, creatorId: string, status: Status) =>
    demoOr(wsMock.isDemoId(w.id),
      async () => {
        const r = await req<ApiHireView>(`/hires/${w.id}/creators/${creatorId}`, { method: "PATCH", json: { status } });
        return adaptHire(r);
      },
      () => wsMock.mockSetStatus(w, creatorId, status),
    ),
  /** Step 1 of "fund all": the backend creates ONE HUMAN_SPLIT campaign (DRAFT) for the approved creators. Returns its id. Idempotent for retries. */
  createFunding: async (w: Workspace): Promise<string> => {
    if (w.campaignId) return w.campaignId;
    return withFallback(
      async () => (await req<{ campaign: { id: string } }>(`/hires/${w.id}/fund`, { json: {} })).campaign.id,
      () => "demo-campaign",
    );
  },
  /** Step 3: after the on-chain fund (useEscrow().fund(campaignId)), reload the workspace from the server. */
  reload: (w: Workspace, tx?: string) =>
    demoOr(wsMock.isDemoId(w.id),
      async () => {
        const next = adaptHire(await req<ApiHireView>(`/hires/${w.id}`));
        return { ...next, fundTx: tx };
      },
      () => wsMock.mockFund(w, tx ?? "0xdemo"),
    ),
};
export const tierName = (t: Tier) => TIER_LABEL[t];

/* ---------- marketplace views (standing, trending, desk + ledger dashboards, fees, optional modules) ----------
   Reads /marketplace/trending, /leaderboard, /dashboard/*; optional modules are probed and treated as absent unless the
   endpoint answers 200 (disabled modules return 404 FEATURE_DISABLED). Demo fallbacks live in src/ui-mocks/market.ts. */
import {
  mockBoard as mockStanding,
  mockCreators,
  mockDaily,
  mockDeskTotals,
  type CreatorDash,
  type CreatorPerf,
  type DailyPoint,
  type DeskCampaign,
  type DeskData,
  type Fees,
  type StandingRow,
  type TierName,
  type TrendRow,
} from "@/ui-mocks/market";

const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const nn = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const tierOf = (v: unknown): TierName | null => (typeof v === "string" ? (v.toUpperCase() as TierName) : null);

/** Returns null when the module is off (404 FEATURE_DISABLED) or the service is down; the caller then renders nothing.
    Other API errors, such as 401 when no one is signed in, are thrown so the page can say what to do. */
async function probe<T>(path: string): Promise<T | null> {
  try {
    return await req<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status !== 404) throw e;
    return null;
  }
}

export const mk = {
  trending: (days = 7) =>
    withFallback(
      async (): Promise<TrendRow[]> => {
        const r = await req<{
          windowDays: number;
          campaigns: { position: number; campaign: ApiCampaign; campaigner?: { verifiedBadge?: boolean }; totalViews: number; viewsGained: number; approvedClips: number; submissions: number; trendScore: number }[];
        }>(`/marketplace/trending?days=${days}&limit=40`);
        return r.campaigns.map((t) => ({
          position: t.position,
          campaign: adaptCampaign(t.campaign, { totalViews: t.totalViews, approvedClips: t.approvedClips }),
          viewsGained: t.viewsGained,
          trendScore: t.trendScore,
          windowDays: r.windowDays,
          verified: !!t.campaigner?.verifiedBadge,
        }));
      },
      () =>
        [...mockCampaigns]
          .filter((c) => c.status === "live")
          .sort((a, b) => b.views - a.views)
          .map((campaign, i) => ({ position: i + 1, campaign, viewsGained: Math.round(campaign.views * 0.08), trendScore: Math.round(campaign.views * 0.08) + 100 * campaign.clips, windowDays: days, verified: i % 2 === 0 })),
    ),

  leaderboard: (sort: "views" | "earnings") =>
    withFallback(
      async (): Promise<StandingRow[]> => {
        const r = await req<{
          creators: { position: number; creatorId: string; wallet: string; displayName: string | null; verifiedBadge: boolean; tier: string | null; views: number; approvedClips: number; campaigns: number; estimatedEarnings: number | null }[];
        }>(`/leaderboard?sort=${sort}&limit=25`);
        return r.creators.map((c) => ({ position: c.position, creatorId: c.creatorId, handle: c.displayName || short(c.wallet), verified: c.verifiedBadge, tier: tierOf(c.tier), views: n0(c.views), approved: n0(c.approvedClips), campaigns: n0(c.campaigns), est: n0(c.estimatedEarnings) }));
      },
      () => [...mockStanding].sort((a, b) => (sort === "views" ? b.views - a.views : b.est - a.est)).map((r, i) => ({ ...r, position: i + 1 })),
    ),

  deskDash: () =>
    withFallback(
      async (): Promise<DeskData> => {
        const r = await req<{
          campaigns: { campaignId: string; title: string; status: string; payoutMode: string; budget: number; spend: number; allocated: number; remaining: number; views: number; clips: { approved: number; rejected: number; pendingReview: number }; costPer1kViews: number | null }[];
          totals: { campaigns: number; budget: number; spend: number; views: number; approvedClips: number; rejectedClips: number; pendingReviewClips: number; costPer1kViews: number | null };
        }>("/dashboard/campaigner");
        return {
          campaigns: r.campaigns.map((c) => ({ campaignId: c.campaignId, title: c.title, status: c.status, mode: c.payoutMode, budget: n0(c.budget), spend: n0(c.spend), allocated: n0(c.allocated), remaining: n0(c.remaining), views: n0(c.views), approved: n0(c.clips?.approved), rejected: n0(c.clips?.rejected), pending: n0(c.clips?.pendingReview), cpm1k: nn(c.costPer1kViews) })),
          totals: { campaigns: n0(r.totals.campaigns), budget: n0(r.totals.budget), spend: n0(r.totals.spend), views: n0(r.totals.views), approved: n0(r.totals.approvedClips), rejected: n0(r.totals.rejectedClips), pending: n0(r.totals.pendingReviewClips), cpm1k: nn(r.totals.costPer1kViews) },
        };
      },
      (): DeskData => {
        const rows: DeskCampaign[] = mockCampaigns
          .filter((c) => ["c-ledgerlane", "c-fieldnotes"].includes(c.id))
          .map((c) => ({ campaignId: c.id, title: c.title, status: "APPROVED", mode: c.mode, budget: c.pool, spend: c.paid, allocated: c.paid, remaining: c.pool - c.paid, views: c.views, approved: c.clips, rejected: Math.ceil(c.clips / 4), pending: 1, cpm1k: c.views ? (c.paid / c.views) * 1000 : null }));
        return { campaigns: rows, totals: mockDeskTotals(rows) };
      },
    ),

  /** Views per day for one campaign: GET /campaigns/:id/views (snapshot history of approved clips). An empty list means no snapshots yet. */
  daily: (id: string) =>
    withFallback(
      async (): Promise<DailyPoint[]> => {
        const r = await req<{ points: { day: string; views: number; dailyViews: number; clips: number }[] }>(`/campaigns/${id}/views`);
        /* points carry cumulative views and the day's gain; the bar chart wants the gain */
        return r.points.map((d) => ({ day: String(d.day).slice(0, 10), views: n0(d.dailyViews) }));
      },
      () => mockDaily(),
    ),

  /** Per-creator performance, grouped from the campaign's submissions (the campaigner owner sees all of them). */
  creators: (id: string, rate: number) =>
    withFallback(
      async (): Promise<CreatorPerf[]> => {
        const { submissions } = await req<{ submissions: (ApiSub & { creator?: { id: string; wallet: string; verifiedBadge?: boolean; tier?: string | null } })[] }>(`/campaigns/${id}/submissions`);
        const by = new Map<string, CreatorPerf>();
        for (const s of submissions) {
          const key = s.creator?.id ?? "unknown";
          const row = by.get(key) ?? { creator: s.creator ? short(s.creator.wallet) : "unknown", verified: !!s.creator?.verifiedBadge, tier: tierOf(s.creator?.tier), clips: 0, approved: 0, rejected: 0, views: 0, paid: 0, cpm1k: rate || null };
          row.clips += 1;
          if (s.verdict?.result === "APPROVE") {
            row.approved += 1;
            row.views += n0(s.metadata?.views);
          } else if (s.verdict?.result === "REJECT") row.rejected += 1;
          by.set(key, row);
        }
        return [...by.values()].map((r) => ({ ...r, paid: rate ? (r.views / 1000) * rate : 0 })).sort((a, b) => b.views - a.views);
      },
      () => mockCreators,
    ),

  creatorDash: () =>
    withFallback(
      async (): Promise<CreatorDash> => {
        const r = await req<{
          verifiedBadge: boolean;
          rank: { approved: number; rejected: number; pending: number; reliability: number; tier: string; rank: number };
          totals: { views: number; clipsSubmitted: number; approvedClips: number; rejectedClips: number; pendingReviewClips: number; activeHires: number; estimated: number; claimable: number; claimed: number };
          campaigns: { campaignId: string; title: string; payoutMode: string; approvedClips: number; views: number; estimatedEarnings: number | null }[];
        }>("/dashboard/creator");
        return {
          verified: r.verifiedBadge,
          rank: { ...r.rank, tier: tierOf(r.rank.tier) ?? "NEW" },
          totals: { views: n0(r.totals.views), submitted: n0(r.totals.clipsSubmitted), approved: n0(r.totals.approvedClips), rejected: n0(r.totals.rejectedClips), pending: n0(r.totals.pendingReviewClips), hires: n0(r.totals.activeHires), estimated: n0(r.totals.estimated), claimable: n0(r.totals.claimable), claimed: n0(r.totals.claimed) },
          campaigns: r.campaigns.map((c) => ({ campaignId: c.campaignId, title: c.title, mode: c.payoutMode, approvedClips: c.approvedClips, views: c.views, est: c.estimatedEarnings })),
        };
      },
      (): CreatorDash => ({
        verified: true,
        rank: { approved: 8, rejected: 2, pending: 1, reliability: 0.8, tier: "PRO", rank: 2 },
        totals: { views: 69_600, submitted: 11, approved: 8, rejected: 2, pending: 1, hires: 0, estimated: 155.2, claimable: 86.8, claimed: 43.11 },
        campaigns: mockEarnings.estimates.map((e) => ({ campaignId: e.campaignId, title: e.title, mode: e.mode, approvedClips: e.approvedClips, views: e.views, est: e.est })),
      }),
    ),

  /** The creator's own submissions with verdicts. */
  mySubmissions: () =>
    withFallback(
      async () => {
        const r = await req<{ submissions: ApiSub[] }>("/submissions");
        return r.submissions.map((s) => ({ ...adaptSub(s), campaign: s.campaign?.title ?? "Campaign" }));
      },
      () => mockSubs.map((s) => ({ ...s, campaign: mockCampaigns.find((c) => c.id === s.campaignId)?.title ?? "Campaign" })),
    ),

  /** Join = ask the server whether this creator may submit here (and why not). Joining is free; clips are the commitment.
      If the visitor arrived through a referral link (?ref=code) and is eligible, the code is attributed (module may be off: then ignored). */
  join: async (campaignId: string, ref?: string | null) => {
    const r = await withFallback(
      () => req<{ eligible: boolean; reasons: string[]; requiredTier: string | null; creatorTier: string | null; restrictedToHiredCreators?: boolean }>(`/campaigns/${campaignId}/eligibility`),
      () => ({ eligible: true, reasons: [] as string[], requiredTier: null, creatorTier: "NEW" }),
    );
    let referral: "attributed" | "already" | "refused" | "off" | null = null;
    if (r.eligible && ref) {
      try {
        await req("/referral/attribute", { json: { code: ref } });
        referral = "attributed";
      } catch (e) {
        referral = e instanceof ApiError ? (e.code === "ALREADY_REFERRED" ? "already" : e.status === 404 ? "off" : "refused") : "off";
      }
    }
    return { ...r, referral };
  },

  /** Per-side platform fees from GET /api/chain/config (read off the escrow, 0.25% per side by default). Rejects when the service does not say. */
  fees: (): Promise<Fees> =>
    loadChain().then((i) => {
      if (!i.fees) {
        if (DEMO) return { campaignerBps: 25, creatorBps: 25, source: "default" as const };
        throw new ApiError(503, "SERVICE_UNAVAILABLE", SERVICE_DOWN);
      }
      return { campaignerBps: n0(i.fees.campaignerBps), creatorBps: n0(i.fees.creatorBps), source: "api" as const };
    }),
};

/* optional modules: each call resolves to null unless the module is enabled server-side */
export type LadderInfo = { tiers: { tier: string; requirements: { approvedClips: number; approveRate: number; verifiedViews: number } }[] };
export type StatusMe = {
  tier: string | null;
  metrics: { approvedClips: number; reviewedClips: number; approveRate: number; fraudFlags: number; verifiedViews: number };
  nextTier: string | null;
  nextRequirements: { approvedClips: number; approveRate: number; verifiedViews: number } | null;
};
export type RefSummary = { links: { id: string; code: string; campaignId: string; active: boolean }[]; referees: number; credited: number; remainingCap: number; frozen: boolean; config: { cutBps: number; capUsdc: number; cooldownHours: number } };
export type ChainProfile = {
  profile: { optedIn: boolean; payloadHash: string | null; syncedAt: string | null; txHash: string | null } | null;
  preview: { tier: number; approvedClips: number; rejectedClips: number; totalViews: number; totalEarnedUsdc: number };
};

export const modules = {
  ladder: () => probe<LadderInfo>("/status/ladder"),
  statusMe: () => probe<StatusMe>("/status/me"),
  referral: () => probe<RefSummary>("/referral/summary"),
  referralLink: (campaignId: string) => req<{ link: { code: string; campaignId: string } }>("/referral/links", { json: { campaignId } }).then((r) => r.link),
  profile: () => probe<ChainProfile>("/creator/onchain-profile"),
  profileOptIn: (optIn: boolean) => req<{ profile: ChainProfile["profile"] }>("/creator/onchain-profile", { json: { optIn } }).then((r) => r.profile),
};
