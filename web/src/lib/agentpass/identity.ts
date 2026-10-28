import { createAgentBookVerifier } from "@worldcoin/agentkit";
import { isHex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, getOverride, notConfigured } from "../config";

/** Resolves an agent wallet to the anonymous human behind it, or null (unregistered or lookup failed). */
export interface AgentBookLookup {
  lookupHuman(address: string): Promise<string | null>;
}

export type AgentPassMode = "agentbook" | "demo";

/**
 * "demo" = AGENT_PASS_DEMO=1: the agent wallet is derived locally and counts as registered to a FAKE human. Agent Pass proofs use
 * fake identities, so this is for the demo only. Every record it makes is stored with mode "demo" and shown as such.
 */
export const agentPassMode = (): AgentPassMode => (env("AGENT_PASS_DEMO") === "1" ? "demo" : "agentbook");

/** The agent's signing wallet. Real mode: AGENT_PASS_PRIVATE_KEY (register it with `npx @worldcoin/agentkit-cli register <address>`). */
export function getAgentAccount() {
  const key = env("AGENT_PASS_PRIVATE_KEY");
  if (key) {
    if (!isHex(key) || key.length !== 66) throw notConfigured("Agent Pass (the key must be 0x plus 64 hex characters)", "AGENT_PASS_PRIVATE_KEY");
    return privateKeyToAccount(key);
  }
  if (agentPassMode() === "demo") return privateKeyToAccount(keccak256(toHex(`clippo-demo-agent:${env("SESSION_SECRET") ?? "dev"}`)));
  throw notConfigured("Agent Pass", "AGENT_PASS_PRIVATE_KEY");
}

export function getAgentBook(): AgentBookLookup {
  const o = getOverride<AgentBookLookup>("agentBook");
  if (o) return o;
  if (agentPassMode() === "demo") {
    const demo = getAgentAccount().address.toLowerCase();
    return { lookupHuman: async (a) => (a.toLowerCase() === demo ? `demo-human-${demo.slice(2, 10)}` : null) };
  }
  return createAgentBookVerifier({ rpcUrl: env("WORLD_CHAIN_RPC_URL") });
}
