/**
 * The Clippo split-proposer agent (World AgentKit / "Agent Pass").
 *
 * PURE: no database, no chain client, no proof handling. It turns approved-clip counts into a proposed split and signs an
 * AgentKit (SIWE / CAIP-122) payload over that split's hash, attributing the proposal to the agent wallet. It can only PROPOSE.
 * Nothing here (or anywhere an agent runs) can create a payout or call the escrow; a human World ID check is the gate.
 * Enforced by guardrail.test.ts.
 */
import { formatSIWEMessage, type AgentkitPayload } from "@worldcoin/agentkit";
import { randomBytes } from "node:crypto";
import type { LocalAccount } from "viem";
import { normalizeSplit, splitHash, type SplitEntry, type SplitEntryInput } from "../chain/split";

/** AgentBook resolves wallets on World Chain regardless of where the agent signs. */
export const AGENT_PASS_CHAIN = "eip155:480";
export const PROPOSAL_TTL_MS = 30 * 60_000;
export const AGENT_STATEMENT = "Clippo split proposal. This agent only proposes a split; a verified human must approve it before anything moves.";

export interface ClipShare {
  creatorWallet: string;
  clips: number;
}

/** One share of the net pool per creator, proportional to approved clips, floored to cents. */
export function planSplit(shares: ClipShare[], netPool: number): { split: SplitEntry[]; hash: `0x${string}`; rationale: string } {
  const total = shares.reduce((n, s) => n + s.clips, 0);
  if (total === 0 || netPool <= 0) return { split: [], hash: splitHash([]), rationale: "No approved clips, so there is nothing to propose." };
  const entries: SplitEntryInput[] = shares
    .filter((s) => s.clips > 0)
    .map((s) => ({ creatorWallet: s.creatorWallet, amount: Math.floor((netPool * s.clips * 100) / total) / 100 }));
  const split = normalizeSplit(entries);
  const rationale = `${total} approved clip${total === 1 ? "" : "s"} across ${split.length} creator${split.length === 1 ? "" : "s"}; the net pool of ${netPool} USDC is shared in proportion to approved clips, rounded down to the cent.`;
  return { split, hash: splitHash(split), rationale };
}

/** Sign an AgentKit payload bound to `uri` and to the split hash (requestId). */
export async function signProposal(p: { account: LocalAccount; uri: string; hash: string; now?: Date }): Promise<AgentkitPayload> {
  const now = p.now ?? new Date();
  const info = {
    domain: new URL(p.uri).hostname,
    uri: p.uri,
    statement: AGENT_STATEMENT,
    version: "1",
    nonce: randomBytes(16).toString("hex"),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    requestId: p.hash,
    resources: [`urn:clippo:split:${p.hash}`],
    chainId: AGENT_PASS_CHAIN,
    type: "eip191" as const,
  };
  const address = p.account.address;
  const signature = await p.account.signMessage({ message: formatSIWEMessage(info, address) });
  return { ...info, address, signature };
}
