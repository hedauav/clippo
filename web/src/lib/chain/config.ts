import { defineChain } from "viem";

/**
 * Chain configuration (server). Everything is overridable by env; the Arc testnet values are defaults
 * (verify against the Arc docs before relying on them).
 *
 *  ARC_RPC_URL        JSON-RPC endpoint            (default https://rpc.testnet.arc.network)
 *  ARC_CHAIN_ID       numeric chain id             (default 5042002)
 *  USDC_ADDRESS       USDC ERC-20 (6 decimals)     (default Arc testnet USDC 0x3600...0000)
 *  ESCROW_ADDRESS     deployed ClippoEscrow        (required to enable chain mode)
 *  ESCROW_DEPLOY_BLOCK first block to index        (default 0)
 *  PLATFORM_CAMPAIGNER_FEE_BPS / PLATFORM_CREATOR_FEE_BPS  fallback fees when the chain is unreachable (default 25 / 25)
 */
export const USDC_DECIMALS = 6;
const DEFAULT_RPC = "https://rpc.testnet.arc.network";
const DEFAULT_CHAIN_ID = 5042002;
const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";

export interface ChainConfig {
  enabled: boolean;
  rpcUrl: string;
  chainId: number;
  usdc: `0x${string}`;
  escrow: `0x${string}` | null;
  deployBlock: number;
}

const isAddr = (a: string | undefined): a is `0x${string}` => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

export function chainConfig(): ChainConfig {
  const escrow = process.env.ESCROW_ADDRESS;
  const usdc = process.env.USDC_ADDRESS;
  return {
    enabled: isAddr(escrow),
    rpcUrl: process.env.ARC_RPC_URL || DEFAULT_RPC,
    chainId: Number(process.env.ARC_CHAIN_ID || DEFAULT_CHAIN_ID),
    usdc: isAddr(usdc) ? usdc : DEFAULT_USDC,
    escrow: isAddr(escrow) ? escrow : null,
    deployBlock: Number(process.env.ESCROW_DEPLOY_BLOCK || 0),
  };
}

export const chainEnabled = () => chainConfig().enabled;

export function arcChain(cfg: ChainConfig = chainConfig()) {
  return defineChain({
    id: cfg.chainId,
    name: "Arc Testnet",
    // Arc uses USDC as the native gas token (18 decimals natively).
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

/** The subset safe to expose to browsers (GET /api/chain/config). */
export function publicChainConfig(cfg: ChainConfig = chainConfig()) {
  return { enabled: cfg.enabled, chainId: cfg.chainId, rpcUrl: cfg.rpcUrl, usdc: cfg.usdc, escrow: cfg.escrow, usdcDecimals: USDC_DECIMALS, faucetUrl: process.env.CIRCLE_FAUCET_URL || "https://faucet.circle.com" };
}
