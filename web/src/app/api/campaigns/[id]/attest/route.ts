import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { attestationHash } from "@/lib/chain/split";
import { db } from "@/lib/db";
import { getCampaign, proofSchema, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { checkFreshProof, consumeProof } from "@/lib/worldid/fresh";

const body = z.object({ worldIdProof: proofSchema });
const APPROVE_ACTION = "clippo-approve-campaign";

/**
 * Admin human confirmation for approving a FUNDED campaign (mandatory when `campaign.highValue`).
 * Verifies a fresh World ID proof (one use only), stores it, and returns the bytes32 `attestation` to pass on-chain as
 * `approveCampaign(onchainId, attestation)`. Denied / cancelled / expired -> 403 WORLD_ID_DENIED, repeated -> 409 PROOF_REUSED;
 * in all failure cases nothing is recorded.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["ADMIN"]);
  const c = await getCampaign((await params).id);
  if (c.status !== "FUNDED") throw new ApiError(409, "BAD_STATE", `Campaign is ${c.status}, expected FUNDED`);
  const { worldIdProof } = body.parse(await readJson(req));
  const { proofHash, nullifier } = await checkFreshProof(worldIdProof, APPROVE_ACTION, `approve:${c.id}`);
  const attestation = attestationHash({
    kind: "APPROVE",
    campaignKey: c.onchainId ?? c.id,
    wallet: user.wallet,
    nullifier,
    proofHash,
  });
  await db.$transaction(async (tx) => {
    await consumeProof(tx, user, proofHash, APPROVE_ACTION);
    await tx.humanAttestation.create({
      data: { campaignId: c.id, userId: user.id, kind: "APPROVE", attestation, proofHash },
    });
  });
  return ok(
    {
      attestation,
      highValue: c.highValue,
      onchain: c.onchainId ? { functionName: "approveCampaign", args: [c.onchainId, attestation] } : null,
    },
    201,
  );
});
