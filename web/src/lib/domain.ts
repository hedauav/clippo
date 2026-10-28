import type { Campaign, User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { ApiError } from "./http";

export type Ctx = { params: Promise<{ id: string }> };

export async function getCampaign(id: string): Promise<Campaign> {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  return c;
}

export const isAdmin = (u: User) => u.role === "ADMIN";
export const canManageCampaign = (u: User, c: Campaign) => isAdmin(u) || c.campaignerId === u.id;

export const storySchema = z.object({
  summary: z.string().min(1),
  topic: z.string().min(1),
  requiredPoints: z.array(z.string()).default([]),
  prohibitedClaims: z.array(z.string()).default([]),
  disclosureLabel: z.string().default("#ad"),
  attribution: z.string().default(""),
  description: z.string().optional(),
});

export const platformEnum = z.enum(["YOUTUBE", "X", "INSTAGRAM"]);

/** Public/creator-facing campaign shape. */
export function campaignView(c: Campaign & { _count?: { submissions: number } }) {
  const { _count, ...rest } = c;
  return { ...rest, submissionCount: _count?.submissions ?? undefined };
}

/** Number of approved clips by the creator across all campaigns (used for HIGHER_RANKED eligibility). */
export async function creatorRank(userId: string): Promise<number> {
  return db.verdict.count({ where: { result: "APPROVE", submission: { creatorId: userId } } });
}
export const HIGHER_RANK_MIN_APPROVED = 3;

const legacyProof = z.object({
  nullifier_hash: z.string().min(1),
  merkle_root: z.string().optional(),
  proof: z.string().min(1),
  verification_level: z.string().optional(),
  signal: z.string().optional(),
});
const idkitResult = z.looseObject({
  protocol_version: z.string(),
  nonce: z.string().optional(),
  action: z.string().optional(),
  environment: z.string().optional(),
  responses: z.array(z.looseObject({ identifier: z.string() })).min(1),
});
/** World ID proof: the full IDKit 4.x result (preferred) or the legacy {nullifier_hash, proof, ...} shape. */
export const proofSchema = z.union([idkitResult, legacyProof]);

