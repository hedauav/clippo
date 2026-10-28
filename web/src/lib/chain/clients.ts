import { createPublicClient, http, type PublicClient } from "viem";
import { arcChain, chainConfig } from "./config";

const g = globalThis as unknown as { __clippoPublic?: { key: string; client: PublicClient } };

/** Server-side read client for the configured chain (cached per RPC/chain id). */
export function publicClient(): PublicClient {
  const cfg = chainConfig();
  const key = `${cfg.rpcUrl}|${cfg.chainId}`;
  if (g.__clippoPublic?.key !== key) {
    g.__clippoPublic = { key, client: createPublicClient({ chain: arcChain(cfg), transport: http(cfg.rpcUrl) }) as PublicClient };
  }
  return g.__clippoPublic.client;
}
