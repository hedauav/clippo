import { createHash } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { db } from "../db";
import { ApiError } from "../http";
import { getWorldId, isIdkitResult, type WorldIdProof } from "./index";

export const proofHashOf = (p: WorldIdProof) =>
  createHash("sha256")
    .update(isIdkitResult(p) ? JSON.stringify(p.responses.map((r) => [r.identifier, r.nullifier, r.proof])) : `${p.proof}|${p.nullifier_hash}|${p.merkle_root ?? ""}`)
    .digest("hex");

/**
 * Validates a World ID proof for a sensitive action (PRD 6: a fresh proof per approver per action) WITHOUT consuming it.
 * Throws 403 WORLD_ID_DENIED (cancelled/expired/invalid) or 409 PROOF_REUSED (already used / "repeated"); nothing is written.
 * Call `consumeProof` inside the same transaction as the action so a failure leaves the proof unused.
 */
export async function checkFreshProof(proof: WorldIdProof, action: string, signal?: string): Promise<{ proofHash: string; nullifier: string }> {
  const proofHash = proofHashOf(proof);
  if ((await db.usedProof.findUnique({ where: { proofHash } }))) {
    throw new ApiError(409, "PROOF_REUSED", "That World ID proof was already used. Each check works once; nothing was changed.");
  }
  const res = await getWorldId().verify(proof, action, signal);
  if (!res.ok) throw new ApiError(403, "WORLD_ID_DENIED", res.reason);
  return { proofHash, nullifier: res.nullifier };
}

/** Marks the proof used (unique on proofHash: a concurrent replay fails the surrounding transaction). */
export async function consumeProof(tx: Prisma.TransactionClient, user: User, proofHash: string, action: string) {
  try {
    await tx.usedProof.create({ data: { proofHash, userId: user.id, action } });
  } catch {
    throw new ApiError(409, "PROOF_REUSED", "That World ID proof was already used. Each check works once; nothing was changed.");
  }
}
