/**
 * Agent Pass service: delegating the AI split proposer to a campaign, recording its signed proposals, and the activity view.
 *
 * This module (and every route that uses it) may only write AgentIdentity, AgentProposal and AgentAudit. It never touches
 * payouts, split approvals, human attestations or used proofs: releasing needs a human (see the split route).
 * Enforced by guardrail.test.ts.
 */
import { AgentkitPayloadSchema, formatSIWEMessage, validateAgentkitMessage, type AgentkitPayload } from "@worldcoin/agentkit";
import type { AgentIdentity, AgentProposal, Campaign, User } from "@prisma/client";
import { recoverMessageAddress } from "viem";
import { db } from "../db";
import { ApiError } from "../http";
import { DEFAULT_MODEL, getLlm } from "../ai/llm";
import type { Story } from "../ai/verifier";
import { toUnits } from "../chain/units";
import { AGENT_PASS_CHAIN, signProposal } from "./agent";
import { deterministicDraft, proposeWithLlm, type CreatorFacts, type ProposalDraft, type ProposerInput } from "./llm-proposer";
import { auditView, recordAudit } from "./audit";
import { agentPassMode, getAgentAccount, getAgentBook } from "./identity";

export const registerHint = (address: string) => `Register it once with: npx @worldcoin/agentkit-cli register ${address}`;

/** Campaigner delegates the proposer agent to ONE campaign. Refused unless AgentBook resolves the agent wallet to a human. */
export async function delegateAgent(user: User, c: Campaign): Promise<AgentIdentity> {
  const account = getAgentAccount();
  const address = account.address.toLowerCase();
  const humanId = await getAgentBook().lookupHuman(address);
  if (!humanId) {
    await recordAudit({ campaignId: c.id, actorId: user.id, actorRole: "CAMPAIGNER", event: "REFUSED", outcome: "AGENT_UNVERIFIED", code: "AGENT_NOT_REGISTERED", detail: `Agent ${address} is not registered to a human in AgentBook, so it was not delegated.`, proofStatus: "NONE" });
    throw new ApiError(403, "AGENT_NOT_REGISTERED", `The agent wallet ${address} is not registered to a verified human in AgentBook. ${registerHint(address)}`);
  }
  const mode = agentPassMode();
  const row = await db.agentIdentity.upsert({
    where: { campaignId_address: { campaignId: c.id, address } },
    create: { campaignId: c.id, ownerId: user.id, address, humanId, mode },
    update: { status: "ACTIVE", humanId, mode },
  });
  await recordAudit({ campaignId: c.id, actorId: user.id, actorRole: "CAMPAIGNER", event: "DELEGATED", outcome: "OK", detail: `Agent ${address} (${mode === "demo" ? "demo identity" : "AgentBook human-backed"}) delegated to propose splits for this campaign.`, proofStatus: "NONE" });
  return row;
}

/** Checks a signed AgentKit payload the way a resource server would: schema, domain/uri, age, expiry, replayable nonce, signature, split binding. */
export async function verifyAgentPayload(payload: unknown, uri: string, hash: string): Promise<AgentkitPayload> {
  const parsed = AgentkitPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new ApiError(400, "AGENT_PAYLOAD_INVALID", "The agent payload is malformed");
  const p = parsed.data;
  const v = await validateAgentkitMessage(p, uri, { checkNonce: async (n) => !(await db.agentProposal.findUnique({ where: { nonce: n } })) });
  if (!v.valid) throw new ApiError(401, "AGENT_PAYLOAD_INVALID", `Agent payload rejected: ${v.error}`);
  if (p.chainId !== AGENT_PASS_CHAIN || p.type !== "eip191") throw new ApiError(401, "AGENT_PAYLOAD_INVALID", "Unsupported agent signature type");
  if (p.requestId !== hash) throw new ApiError(401, "AGENT_PAYLOAD_INVALID", "The agent signature is not bound to this split");
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: formatSIWEMessage(p, p.address), signature: p.signature as `0x${string}` });
  } catch {
    throw new ApiError(401, "AGENT_PAYLOAD_INVALID", "The agent signature could not be read");
  }
  if (signer.toLowerCase() !== p.address.toLowerCase()) throw new ApiError(401, "AGENT_PAYLOAD_INVALID", "The agent signature does not match its address");
  return p;
}

export type ProposeMode = "llm" | "deterministic";

/** Optional per-creator cap (USDC) the brand can put in the campaign story as `perCreatorCapUsdc`. */
function capMicro(story: unknown): number | null {
  const v = (story as { perCreatorCapUsdc?: unknown } | null)?.perCreatorCapUsdc;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Number(toUnits(v)) : null;
}

/** Everything the proposer may know: eligible creators (approved, live clips) with measured facts, and the net pool in micro-USDC. */
async function planInputs(c: Campaign): Promise<ProposerInput> {
  const subs = await db.submission.findMany({
    where: { campaignId: c.id, clipStatus: "LIVE", verdict: { result: "APPROVE" } },
    orderBy: { createdAt: "asc" },
    select: { transcript: true, metadata: true, creator: { select: { wallet: true } }, verdict: true, snapshots: { select: { cumulativeViews: true } } },
  });
  const by = new Map<string, CreatorFacts>();
  for (const s of subs) {
    const w = s.creator.wallet.toLowerCase();
    const meta = (s.metadata ?? {}) as { title?: unknown; description?: unknown; views?: unknown };
    const snap = s.snapshots.reduce((m, x) => Math.max(m, x.cumulativeViews), 0);
    const f = by.get(w) ?? { creator: w, clips: [] };
    f.clips.push({
      title: typeof meta.title === "string" ? meta.title : "",
      description: typeof meta.description === "string" ? meta.description : "",
      transcript: s.transcript,
      views: snap || (typeof meta.views === "number" ? meta.views : 0),
      verdictConfidence: s.verdict?.confidence ?? 0,
      verdictReason: s.verdict?.reason ?? "",
      verdictFlags: Array.isArray(s.verdict?.flags) ? (s.verdict!.flags as unknown[]).filter((x): x is string => typeof x === "string") : [],
      decidedBy: s.verdict?.decidedBy ?? "AI",
      appealStatus: s.verdict?.appealStatus ?? "NONE",
    });
    by.set(w, f);
  }
  const netPool = c.grossFunded != null ? c.grossFunded - (c.campaignerFee ?? 0) : c.poolSize;
  return {
    story: (c.story ?? {}) as unknown as Story,
    shareBasis: c.poolShareBasis ?? null,
    netPoolMicro: Math.max(0, Number(toUnits(netPool))),
    perCreatorCapMicro: capMicro(c.story),
    creators: [...by.values()],
  };
}

/**
 * The agent proposes a split for the campaign. Signed with the agent wallet, verified, stored, audited. Moves no money:
 * no payout and no split approval is created here.
 */
export async function proposeSplit(user: User, c: Campaign, uri: string, mode: ProposeMode = "llm"): Promise<AgentProposal> {
  // No mock fallback: the AI path needs a real key (GEMINI_API_KEY or ANTHROPIC_API_KEY, see getLlm()). 503 NOT_CONFIGURED before anything is written. The non-AI planner is an explicit choice.
  const llm = mode === "llm" ? getLlm() : null;
  const account = getAgentAccount();
  const address = account.address.toLowerCase();
  const agent = await db.agentIdentity.findUnique({ where: { campaignId_address: { campaignId: c.id, address } } });
  if (!agent || agent.status !== "ACTIVE") throw new ApiError(409, "AGENT_NOT_DELEGATED", "Delegate the agent to this campaign first");
  const humanId = await getAgentBook().lookupHuman(address);
  if (!humanId) {
    await recordAudit({ campaignId: c.id, actorId: user.id, actorRole: "AGENT", event: "REFUSED", outcome: "AGENT_UNVERIFIED", code: "AGENT_NOT_REGISTERED", detail: `Agent ${address} is no longer registered to a human; its proposal was refused.`, proofStatus: "NONE" });
    throw new ApiError(403, "AGENT_NOT_REGISTERED", `The agent wallet is not registered to a verified human in AgentBook. ${registerHint(address)}`);
  }

  const input = await planInputs(c);
  const plan: ProposalDraft = llm && input.creators.length > 0 ? await proposeWithLlm(input, llm, { model: llm.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL }) : deterministicDraft(input);
  if (plan.split.length === 0) throw new ApiError(400, "NOTHING_TO_SPLIT", "No approved clips yet, so there is nothing to propose");

  const payload = await verifyAgentPayload(await signProposal({ account, uri, hash: plan.hash }), uri, plan.hash);
  const row = await db.$transaction(async (tx) => {
    await tx.agentProposal.updateMany({ where: { campaignId: c.id, status: "PROPOSED" }, data: { status: "SUPERSEDED" } });
    return tx.agentProposal.create({
      data: {
        campaignId: c.id,
        agentId: agent.id,
        splitHash: plan.hash,
        splits: plan.split.map((s) => ({ creatorWallet: s.creatorWallet, amount: s.amount, units: s.units.toString(), reason: plan.reasons[s.creatorWallet] ?? "" })),
        rationale: plan.rationale,
        meta: { source: plan.source, model: plan.model ?? null, confidence: plan.confidence, flags: plan.flags, fallback: plan.fallback ?? null },
        nonce: payload.nonce,
        payload,
        expiresAt: new Date(payload.expirationTime ?? Date.now() + 30 * 60_000),
      },
    });
  });
  if (plan.fallback) {
    await recordAudit({ campaignId: c.id, proposalId: row.id, actorId: user.id, actorRole: "AGENT", event: "REFUSED", outcome: "AI_REJECTED", code: plan.fallback.code, detail: `The AI proposal was not used (${plan.fallback.code}): ${plan.fallback.violations.join("; ")}. The non-AI planner's split was proposed instead.`, splitHash: plan.hash, proofStatus: "NONE" });
  }
  await recordAudit({ campaignId: c.id, proposalId: row.id, actorId: user.id, actorRole: "AGENT", event: "PROPOSED", outcome: "OK", detail: `Agent ${address} proposed a ${plan.source === "llm" ? "AI-written" : "non-AI (deterministic)"} split for ${plan.split.length} creator(s). Nothing is payable until a human approves with a fresh World ID check.`, splitHash: plan.hash, proofStatus: "NONE" });
  return row;
}

type Splits = { creatorWallet: string; amount: number; units: string; reason?: string }[];
type Meta = { source?: "llm" | "deterministic"; model?: string | null; confidence?: number | null; flags?: string[]; fallback?: { code: string; violations: string[] } | null };

export function proposalView(p: AgentProposal, agent: Pick<AgentIdentity, "address" | "humanId" | "mode" | "status"> | undefined) {
  const expired = p.status === "PROPOSED" && p.expiresAt.getTime() < Date.now();
  return {
    id: p.id,
    campaignId: p.campaignId,
    splitHash: p.splitHash,
    splits: p.splits as Splits,
    total: (p.splits as Splits).reduce((n, s) => n + s.amount, 0),
    rationale: p.rationale,
    source: (p.meta as Meta | null)?.source ?? "deterministic",
    confidence: (p.meta as Meta | null)?.confidence ?? null,
    flags: (p.meta as Meta | null)?.flags ?? [],
    fallback: (p.meta as Meta | null)?.fallback ?? null,
    status: expired ? "EXPIRED" : p.status,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    agent: agent ? { address: agent.address, mode: agent.mode, status: agent.status, humanId: `${agent.humanId.slice(0, 10)}…` } : null,
  };
}

/** Everything the "Agent Pass activity" panel shows for one campaign: who the agent is, what it proposed, who approved with what proof, and every refusal. */
export async function campaignActivity(campaignId: string) {
  const [agents, proposals, audit, approvals] = await Promise.all([
    db.agentIdentity.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" } }),
    db.agentProposal.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.agentAudit.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" }, take: 40 }),
    db.splitProposal.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return {
    mode: agentPassMode(),
    agents: agents.map((a) => ({ id: a.id, address: a.address, mode: a.mode, status: a.status, humanId: `${a.humanId.slice(0, 10)}…`, createdAt: a.createdAt.toISOString() })),
    proposals: proposals.map((p) => ({
      ...proposalView(p, agents.find((a) => a.id === p.agentId)),
      approval: approvals.find((a) => a.splitHash === p.splitHash)
        ? (() => {
            const a = approvals.find((x) => x.splitHash === p.splitHash)!;
            return { status: a.status, campaigner: !!a.campaignerApprovedAt, admin: !!a.adminApprovedAt };
          })()
        : null,
    })),
    audit: audit.map(auditView),
  };
}
