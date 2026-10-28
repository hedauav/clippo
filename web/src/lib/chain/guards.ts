import type { Campaign } from "@prisma/client";
import { ApiError } from "../http";
import { getOverride, notConfigured } from "../config";
import { chainEnabled } from "./config";
import { STATE } from "./escrow";
import { processReceipt, syncChain } from "./indexer";
import { liveReader } from "./reader";

/**
 * Money movement is ALWAYS verified against the escrow. Without ESCROW_ADDRESS every chain-dependent endpoint fails
 * loudly (503 NOT_CONFIGURED); there is no mirrored/trusted mode.
 */
export function chainMode(): "chain" {
  if (!chainEnabled()) throw notConfigured("The escrow chain", "ESCROW_ADDRESS", "ARC_RPC_URL");
  return "chain";
}

export const STATE_NAME: Record<number, string> = Object.fromEntries(Object.entries(STATE).map(([k, v]) => [v, k]));

/**
 * Chain mode: optionally index `txHash`, then require the campaign's on-chain state to equal `expected`.
 */
export async function assertOnchainState(c: Campaign, expected: number, txHash?: string) {
  chainMode();
  if (!c.onchainId) throw new ApiError(409, "NOT_FUNDED_ONCHAIN", "Campaign has no on-chain escrow yet");
  // Index the given tx, or catch up with the chain so DB-side facts (e.g. the approval attestation) are not stale.
  if (txHash) await processReceipt(txHash);
  else if (!getOverride("escrowReader")) await syncChain(); // a test double stands in for the chain: never reach for the live RPC
  const onchain = await liveReader().getCampaign(BigInt(c.onchainId));
  if (onchain.state !== expected) {
    throw new ApiError(
      409,
      "CHAIN_STATE_MISMATCH",
      `On-chain campaign is ${STATE_NAME[onchain.state] ?? onchain.state}, expected ${STATE_NAME[expected]}. Send the transaction first, then call this endpoint (optionally with its txHash).`,
    );
  }
  return onchain;
}
