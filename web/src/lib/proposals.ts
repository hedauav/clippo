import type { Campaign, SplitProposal } from "@prisma/client";
import { db } from "./db";

/** API shape of a HUMAN_SPLIT proposal: status, approvers so far, who is awaited, split hash. */
export function proposalView(p: SplitProposal, c: Pick<Campaign, "id" | "title" | "approver" | "onchainId" | "poolSize">) {
  const twoParty = c.approver === "CAMPAIGNER_AND_ADMIN";
  return {
    id: p.id,
    campaignId: p.campaignId,
    campaignTitle: c.title,
    onchainId: c.onchainId,
    status: p.status,
    splitHash: p.splitHash,
    splits: p.splits,
    total: (p.splits as { amount: number }[]).reduce((n, s) => n + s.amount, 0),
    poolSize: c.poolSize,
    twoParty,
    approvals: { campaigner: !!p.campaignerApprovedAt, admin: !!p.adminApprovedAt },
    approvedAt: { campaigner: p.campaignerApprovedAt?.toISOString() ?? null, admin: p.adminApprovedAt?.toISOString() ?? null },
    awaiting: [
      ...(p.status === "PENDING" && twoParty && !p.campaignerApprovedAt ? ["campaigner"] : []),
      ...(p.status === "PENDING" && twoParty && !p.adminApprovedAt ? ["admin"] : []),
      ...(p.status === "PENDING" && !twoParty && !p.campaignerApprovedAt ? ["campaigner"] : []),
      ...(p.status === "AWAITING_CHAIN" ? ["chain"] : []),
    ],
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Pending (PENDING / AWAITING_CHAIN) proposals, optionally for one campaign or one campaigner. */
export async function pendingProposals(where: { campaignId?: string; campaignerId?: string } = {}) {
  const campaigns = await db.campaign.findMany({
    where: { ...(where.campaignId ? { id: where.campaignId } : {}), ...(where.campaignerId ? { campaignerId: where.campaignerId } : {}) },
    select: { id: true, title: true, approver: true, onchainId: true, poolSize: true },
  });
  const rows = await db.splitProposal.findMany({
    where: { campaignId: { in: campaigns.map((c) => c.id) }, status: { in: ["PENDING", "AWAITING_CHAIN"] } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((p) => proposalView(p, campaigns.find((c) => c.id === p.campaignId)!));
}
