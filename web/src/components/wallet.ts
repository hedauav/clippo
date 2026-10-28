"use client";
/* Wallet + chain plumbing for the UI. Injected EIP-1193 wallets only (window.ethereum), viem underneath.
   The chain to join comes from GET /api/chain/config (the server's ARC_* env). If that call fails we fall back to the
   public NEXT_PUBLIC_ARC_* env so the wallet can still be pointed at Arc; escrow stays unknown in that case. */
import { getChainConfig, requestAccount, signIn, type FeesConfig, type PublicChainConfig } from "@/lib/chain/client";
import { activeProvider, listWallets } from "@/lib/chain/wallets";

export type ChainInfo = { chain: PublicChainConfig; fees: FeesConfig | null; source: "api" | "env" };

let cached: Promise<ChainInfo> | null = null;

const envChain = (): PublicChainConfig => ({
  enabled: false,
  chainId: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002),
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
  usdc: (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as `0x${string}`,
  escrow: null,
  usdcDecimals: 6,
});

/** Chain + fee schedule from the API (cached for the page session; pass force to refetch). Falls back to env for the chain only. */
export function loadChain(force = false): Promise<ChainInfo> {
  if (!cached || force) {
    cached = getChainConfig()
      .then((r): ChainInfo => ({ chain: r.chain, fees: r.fees, source: "api" }))
      .catch((): ChainInfo => ({ chain: envChain(), fees: null, source: "env" }));
  }
  return cached;
}

export const escrowReady = (c: ChainInfo) => c.source === "api" && c.chain.enabled && !!c.chain.escrow;

export const hasWallet = () => typeof window !== "undefined" && (listWallets().length > 0 || !!activeProvider());

export const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL ?? "https://faucet.circle.com";

export class NoWalletError extends Error {
  code = "NO_WALLET";
  constructor() {
    super("No browser wallet found. Install MetaMask, Rabby or another EIP-1193 wallet, then reload.");
  }
}

/** Connect the chosen wallet and SIWE-sign in. Deliberately independent of /api/chain/config and of the wallet being on Arc:
    account -> nonce -> signature -> session. Chain add/switch happens later, only for on-chain actions (see ensureChain). */
export async function connectAndSignIn(role?: "CAMPAIGNER" | "CREATOR") {
  if (!hasWallet()) throw new NoWalletError();
  const address = await requestAccount();
  const r = await signIn(address, role);
  return r.user;
}

/** Subscribe to wallet account switches. Returns an unsubscribe. */
export function onAccountsChanged(cb: (accounts: string[]) => void) {
  const eth = activeProvider();
  if (!eth?.on) return () => {};
  eth.on("accountsChanged", cb as never);
  return () => eth.removeListener?.("accountsChanged", cb as never);
}
