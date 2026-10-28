import { db } from "../db";
import type { ApiError } from "../http";

export type AuditOutcome =
  | "OK" | "CANCELLED" | "EXPIRED_PROOF" | "PROPOSAL_EXPIRED" | "REPLAYED" | "WRONG_APPROVER" | "SPLIT_CHANGED"
  | "ALREADY_RELEASED" | "ALREADY_APPROVED" | "PROOF_INVALID" | "AGENT_UNVERIFIED" | "AI_REJECTED" | "REFUSED";
export type ProofStatus = "VALID" | "NONE" | "CANCELLED" | "EXPIRED" | "REPLAYED" | "INVALID";

export interface AuditInput {
  campaignId: string;
  proposalId?: string | null;
  actorId?: string | null;
  actorRole?: "AGENT" | "CAMPAIGNER" | "ADMIN" | null;
  event: "DELEGATED" | "PROPOSED" | "APPROVED" | "REFUSED";
  outcome: AuditOutcome;
  code?: string | null;
  detail: string;
  splitHash?: string | null;
  proofStatus?: ProofStatus | null;
  source?: "server" | "client";
}

/** Append one audit row. Never throws: an audit failure must not turn a refusal into a 500 or a success into a failure. */
export async function recordAudit(a: AuditInput): Promise<void> {
  try {
    await db.agentAudit.create({
      data: {
        campaignId: a.campaignId,
        proposalId: a.proposalId ?? null,
        actorId: a.actorId ?? null,
        actorRole: a.actorRole ?? null,
        event: a.event,
        outcome: a.outcome,
        code: a.code ?? null,
        detail: a.detail.slice(0, 500),
        splitHash: a.splitHash ?? null,
        proofStatus: a.proofStatus ?? null,
        source: a.source ?? "server",
      },
    });
  } catch (e) {
    console.error("agent audit write failed", e);
  }
}

/** Map a refused approval to an audit outcome + proof status. A refusal always means the action stayed undone. */
export function classifyRefusal(e: ApiError): { outcome: AuditOutcome; proofStatus: ProofStatus } {
  switch (e.code) {
    case "PROOF_REUSED": return { outcome: "REPLAYED", proofStatus: "REPLAYED" };
    case "WORLD_ID_DENIED": {
      if (/cancel|declin|reject/i.test(e.message)) return { outcome: "CANCELLED", proofStatus: "CANCELLED" };
      if (/expire|timed? ?out/i.test(e.message)) return { outcome: "EXPIRED_PROOF", proofStatus: "EXPIRED" };
      return { outcome: "PROOF_INVALID", proofStatus: "INVALID" };
    }
    case "PROPOSAL_EXPIRED": return { outcome: "PROPOSAL_EXPIRED", proofStatus: "NONE" };
    case "SPLIT_CHANGED": return { outcome: "SPLIT_CHANGED", proofStatus: "NONE" };
    case "ALREADY_RELEASED": return { outcome: "ALREADY_RELEASED", proofStatus: "NONE" };
    case "ALREADY_APPROVED": return { outcome: "ALREADY_APPROVED", proofStatus: "NONE" };
    case "WRONG_APPROVER":
    case "FORBIDDEN": return { outcome: "WRONG_APPROVER", proofStatus: "NONE" };
    case "AGENT_UNVERIFIED":
    case "AGENT_REVOKED": return { outcome: "AGENT_UNVERIFIED", proofStatus: "NONE" };
    default: return { outcome: "REFUSED", proofStatus: "NONE" };
  }
}

type AuditRow = { id: string; campaignId: string; proposalId: string | null; actorRole: string | null; event: string; outcome: string; code: string | null; detail: string; splitHash: string | null; proofStatus: string | null; source: string; createdAt: Date };
export const auditView = (r: AuditRow) => ({ ...r, createdAt: r.createdAt.toISOString() });
