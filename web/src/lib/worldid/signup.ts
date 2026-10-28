import { Prisma, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { type WorldIdProof, type WorldIdVerifier, worldIdAction } from "./index";

/** Nullifiers are compared as text; hex casing must never create a second "human". */
export const normalizeNullifier = (n: string) => (/^0x[0-9a-f]+$/i.test(n.trim()) ? n.trim().toLowerCase() : n.trim());

/** Gate for creator features (channel proof, deals, submissions, claims): the account must hold a verified unique human. */
export function assertVerifiedHuman(user: Pick<User, "verified">, what = "this") {
  if (!user.verified) throw new ApiError(403, "NOT_VERIFIED", `Verify with World ID before you use ${what}. Open Account and press "Verify with World ID".`);
}

/**
 * Sign-up proof of human. The verifier (Developer Portal /api/v4/verify, or a test double) decides validity; we then enforce
 * one human = one account: the nullifier (scoped to the sign-up action) is unique in the DB. Nothing changes on any refusal.
 */
export async function completeSignup(user: User, proof: WorldIdProof, wid: WorldIdVerifier) {
  const result = await wid.verify(proof, worldIdAction());
  if (!result.ok) throw new ApiError(403, "WORLD_ID_DENIED", result.reason);
  const nullifier = normalizeNullifier(result.nullifier);
  const taken = () => new ApiError(409, "ALREADY_USED", "This World ID is already linked to another Clippo account");
  const clash = await db.user.findUnique({ where: { worldIdNullifier: nullifier } });
  if (clash && clash.id !== user.id) throw taken();
  // Same human always yields the same nullifier for this action; a different one means a different person on a verified account.
  if (user.verified && user.worldIdNullifier && user.worldIdNullifier !== nullifier) {
    throw new ApiError(409, "ACCOUNT_ALREADY_VERIFIED", "This account is already verified with a different World ID");
  }
  try {
    return await db.user.update({ where: { id: user.id }, data: { worldIdNullifier: nullifier, verified: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw taken(); // concurrent second account
    throw e;
  }
}
