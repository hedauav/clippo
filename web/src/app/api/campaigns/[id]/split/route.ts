import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { chainMode } from "@/lib/chain/guards";
import { attestationHash, isValidSplitWallets, normalizeSplit, onchainSplitArgs, splitHash } from "@/lib/chain/split";
import { db } from "@/lib/db";
import { canManageCampaign, getCampaign, proofSchema, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { checkFreshProof, consumeProof } from "@/lib/worldid/fresh";
import { pendingProposals } from "@/lib/proposals";
import { classifyRefusal, recordAudit } from "@/lib/agentpass/audit";

const body = z.object({
  splits: z.array(z.object({ creatorWallet: z.string().min(1), amount: z.number().positive() })).min(1),
  /** Fresh World ID (Agent Pass) proof for THIS approver's approval. One use only. */
  worldIdProof: proofSchema,
  /** Agent Pass: the agent's proposal this approval is for. The split must hash-match it. */
  agentProposalId: z.string().optional(),
});

const SPLIT_ACTION = "clippo-approve-split";

/**
 * HUMAN_SPLIT approval. Each approver (campaigner, and admin when `approver = CAMPAIGNER_AND_ADMIN`) calls this with the
 * split and their own fresh World ID proof.
 *  - The split is canonicalised (wallet-sorted, micro-USDC) and hashed like the contract's `pendingSplit` hash.
 *  - CAMPAIGNER_AND_ADMIN: stays PENDING until BOTH approved the IDENTICAL split. A different split replaces the pending
 *    one and clears the other approval (same as the contract).
 *  - Cancelled / expired / invalid proof -> 403 WORLD_ID_DENIED; reused proof -> 409 PROOF_REUSED. Nothing is stored and the
 *    proof is not consumed, so the action is simply undone.
 *  - With a configured chain, finalisation is confirmed by the on-chain `SplitFinalized` event (status AWAITING_CHAIN
 *    until then); each approver must call `approveSplit(id, creators, amounts, attestation)` with the returned values.
 */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const info: AuditCtx = {};
  try {
    return await approve(req, ctx, info);
  } catch (e) {
    // Every refusal is logged (visible in the Agent Pass activity panel) and, by construction, left the action undone.
    if (e instanceof ApiError && info.campaignId && info.audit) {
      const { outcome, proofStatus } = classifyRefusal(e);
      await recordAudit({ campaignId: info.campaignId, proposalId: info.proposalId, actorId: info.actorId, actorRole: info.role, event: "REFUSED", outcome, code: e.code, detail: `${e.message} Nothing was approved.`, splitHash: info.hash, proofStatus });
    }
    throw e;
  }
});

type AuditCtx = { campaignId?: string; audit?: boolean; proposalId?: string; actorId?: string; role?: "CAMPAIGNER" | "ADMIN"; hash?: string };

async function approve(req: Request, { params }: Ctx, info: AuditCtx): Promise<Response> {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const c = await getCampaign((await params).id);
  info.campaignId = c.id;
  info.actorId = user.id;
  info.role = user.id === c.campaignerId ? "CAMPAIGNER" : "ADMIN";
  info.audit = c.payoutMode === "HUMAN_SPLIT";
  if (!canManageCampaign(user, c)) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  if (c.payoutMode !== "HUMAN_SPLIT") throw new ApiError(409, "BAD_STATE", "Campaign is not HUMAN_SPLIT");
  if (c.status !== "APPROVED") throw new ApiError(409, "BAD_STATE", `Campaign is ${c.status}, expected APPROVED`);
  const v = body.parse(await readJson(req));
  info.proposalId = v.agentProposalId;
  const mode = chainMode();

  const split = normalizeSplit(v.splits);
  if (mode === "chain" && !isValidSplitWallets(split)) throw new ApiError(400, "BAD_RECIPIENT", "Recipients must be valid 0x wallet addresses");
  const usablePool = c.grossFunded != null ? c.grossFunded - (c.campaignerFee ?? 0) : c.poolSize;
  const total = split.reduce((n, s) => n + s.amount, 0);
  const existing = await db.payout.aggregate({ where: { campaignId: c.id }, _sum: { amount: true } });
  if (total + (existing._sum.amount ?? 0) > usablePool + 1e-9) {
    throw new ApiError(400, "EXCEEDS_POOL", "Splits exceed the campaign pool");
  }
  const creators = await db.user.findMany({
    where: { wallet: { in: split.map((s) => s.creatorWallet) } },
    include: { submissions: { where: { campaignId: c.id, clipStatus: "LIVE", verdict: { result: "APPROVE" } }, select: { id: true } } },
  });
  for (const s of split) {
    const cr = creators.find((x) => x.wallet === s.creatorWallet);
    if (!cr || cr.submissions.length === 0) throw new ApiError(400, "BAD_RECIPIENT", `${s.creatorWallet} has no approved clip in this campaign`);
  }

  const role = info.role!;
  const twoParty = c.approver === "CAMPAIGNER_AND_ADMIN";
  const hash = splitHash(split);
  info.hash = hash;

  // Cheap pre-checks that never touch the proof (each leaves everything undone).
  // 1. Wrong approver: with a single approver (the campaigner) an admin cannot stand in.
  if (!twoParty && role !== "CAMPAIGNER") throw new ApiError(403, "WRONG_APPROVER", "This campaign is approved by the campaigner only");
  // 2. Agent Pass: the split must be the agent's proposal, unexpired, from a still-delegated agent, byte-for-byte (hash).
  let agentProposal: Awaited<ReturnType<typeof db.agentProposal.findUnique>> = null;
  if (v.agentProposalId) {
    agentProposal = await db.agentProposal.findUnique({ where: { id: v.agentProposalId } });
    if (!agentProposal || agentProposal.campaignId !== c.id) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "No such agent proposal for this campaign");
    const agent = await db.agentIdentity.findUnique({ where: { id: agentProposal.agentId } });
    if (!agent || agent.status !== "ACTIVE") throw new ApiError(409, "AGENT_REVOKED", "The agent that made this proposal is no longer delegated to the campaign");
    if (agentProposal.expiresAt.getTime() < Date.now()) {
      if (agentProposal.status === "PROPOSED") await db.agentProposal.update({ where: { id: agentProposal.id }, data: { status: "EXPIRED" } });
      throw new ApiError(410, "PROPOSAL_EXPIRED", "The agent's proposal expired. Ask the agent for a fresh proposal.");
    }
    if (agentProposal.splitHash !== hash) throw new ApiError(409, "SPLIT_CHANGED", "This split is not what the agent proposed (hash mismatch). Approve the agent's exact proposal.");
    if (agentProposal.status === "SUPERSEDED" || agentProposal.status === "EXPIRED") throw new ApiError(409, "PROPOSAL_EXPIRED", "That agent proposal was replaced by a newer one");
  }
  // 3. Already released (approvals complete, waiting on or confirmed by the chain).
  const released = await db.splitProposal.findFirst({ where: { campaignId: c.id, splitHash: hash, status: { in: ["AWAITING_CHAIN", "FINALIZED"] } } });
  if (released) throw new ApiError(409, "ALREADY_RELEASED", "This exact split was already approved by everyone and sent to the escrow");
  // 4. Same approver re-approving the same pending split.
  const active = await db.splitProposal.findFirst({ where: { campaignId: c.id, status: { in: ["PENDING", "AWAITING_CHAIN"] } }, orderBy: { createdAt: "desc" } });
  if (active && active.splitHash === hash) {
    const done = role === "CAMPAIGNER" ? active.campaignerApprovedAt : active.adminApprovedAt;
    if (done) throw new ApiError(409, "ALREADY_APPROVED", `The ${role.toLowerCase()} already approved this exact split`);
  }

  const { proofHash, nullifier } = await checkFreshProof(v.worldIdProof, SPLIT_ACTION, `split:${c.id}:${hash}`);
  const attestation = attestationHash({ kind: "SPLIT", campaignKey: c.onchainId ?? c.id, wallet: user.wallet, nullifier, proofHash, splitHash: hash });

  const result = await db.$transaction(async (tx) => {
    await consumeProof(tx, user, proofHash, SPLIT_ACTION);
    await tx.humanAttestation.create({ data: { campaignId: c.id, userId: user.id, kind: "SPLIT", splitHash: hash, attestation, proofHash } });

    let proposal = await tx.splitProposal.findFirst({ where: { campaignId: c.id, status: { in: ["PENDING", "AWAITING_CHAIN"] } }, orderBy: { createdAt: "desc" } });
    if (proposal && proposal.splitHash !== hash) {
      await tx.splitProposal.update({ where: { id: proposal.id }, data: { status: "SUPERSEDED" } });
      proposal = null;
    }
    const now = new Date();
    const approval =
      role === "CAMPAIGNER"
        ? { campaignerApprovedAt: now, campaignerAttestation: attestation }
        : { adminApprovedAt: now, adminAttestation: attestation, adminId: user.id };
    proposal = proposal
      ? await tx.splitProposal.update({ where: { id: proposal.id }, data: approval })
      : await tx.splitProposal.create({
          data: {
            campaignId: c.id,
            splitHash: hash,
            splits: split.map((s) => ({ creatorWallet: s.creatorWallet, amount: s.amount, units: s.units.toString() })),
            ...approval,
          },
        });

    const complete = twoParty ? !!(proposal.campaignerApprovedAt && proposal.adminApprovedAt) : true;
    const payouts: Awaited<ReturnType<typeof tx.payout.create>>[] = [];
    if (complete) {
      proposal = await tx.splitProposal.update({ where: { id: proposal.id }, data: { status: "AWAITING_CHAIN" } });
      if (agentProposal) await tx.agentProposal.update({ where: { id: agentProposal.id }, data: { status: "APPROVED" } });
    }
    return { proposal, payouts };
  });
  await recordAudit({
    campaignId: c.id,
    proposalId: v.agentProposalId,
    actorId: user.id,
    actorRole: role,
    event: "APPROVED",
    outcome: "OK",
    detail: `${role === "CAMPAIGNER" ? "Campaigner" : "Admin"} approved ${agentProposal ? "the agent's proposal" : "a human-built split"} with a fresh World ID proof (valid, single use). ${result.proposal.status === "AWAITING_CHAIN" ? "All approvals are in; waiting for the escrow to confirm." : "Waiting for the other approver."}`,
    splitHash: hash,
    proofStatus: "VALID",
  });

  const p = result.proposal;
  return ok(
    {
      payouts: result.payouts,
      proposal: {
        id: p.id,
        status: p.status,
        splitHash: p.splitHash,
        twoParty,
        approvals: { campaigner: !!p.campaignerApprovedAt, admin: !!p.adminApprovedAt },
        awaiting: [
          ...(twoParty && !p.campaignerApprovedAt ? ["campaigner"] : []),
          ...(twoParty && !p.adminApprovedAt ? ["admin"] : []),
          ...(p.status === "AWAITING_CHAIN" ? ["chain"] : []),
        ],
      },
      attestation,
      onchain: c.onchainId
        ? { functionName: "approveSplit", args: { id: c.onchainId, ...onchainSplitArgs(split), attestation } }
        : null,
    },
    201,
  );
}

/** Pending split proposals of this campaign: status, approvers so far, who is awaited (campaigner/admin/chain), split hash. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const c = await getCampaign((await params).id);
  if (!canManageCampaign(user, c)) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  return ok({ proposals: await pendingProposals({ campaignId: c.id }) });
});
