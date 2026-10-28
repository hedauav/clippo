"use client";
/**
 * Browser helpers for the UI: wallet connect, SIWE sign-in, and the on-chain legs of the money flows. Each flow calls
 * the API for exact arguments/previews, sends the transaction from the user's wallet, waits for the receipt and then calls
 * the API with the tx hash so the SERVER verifies it on-chain (the API never trusts the client's claim).
 *
 *   const cfg = await getChainConfig();
 *   const { address } = await connectWallet(cfg);
 *   await signIn(address, "CAMPAIGNER");
 *   const funded = await fundCampaign(campaignId);        // approve USDC + createCampaign + POST /fund
 *   const claimed = await claimPayout(payoutId);          // claim(id) + POST /claim
 *
 * Only imports viem + ABIs (no server modules), so it is safe to bundle for the browser.
 */
import { createPublicClient, createWalletClient, custom, defineChain, getAddress, http, type Chain, type WalletClient } from "viem";
import { createSiweMessage } from "viem/siwe";
import { erc20Abi } from "./erc20-abi";
import { escrowAbi } from "./escrow-abi";
import { activeProvider, type Eip1193 } from "./wallets";

export interface PublicChainConfig {
  enabled: boolean;
  chainId: number;
  rpcUrl: string;
  usdc: `0x${string}`;
  escrow: `0x${string}` | null;
  usdcDecimals: number;
  explorerUrl?: string;
}
export interface FeesConfig {
  campaignerBps: number;
  creatorBps: number;
  source: "chain" | "config";
  retentionDays: number;
  highValueThresholdUsdc: number;
}

async function api<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } }).error;
    throw Object.assign(new Error(e?.message ?? `Request failed (${res.status})`), { code: e?.code ?? "HTTP_ERROR", status: res.status });
  }
  return data as T;
}

export async function getChainConfig(): Promise<{ chain: PublicChainConfig; fees: FeesConfig }> {
  return api("/chain/config");
}

export const chainFor = (cfg: PublicChainConfig): Chain =>
  defineChain({
    id: cfg.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });

export const readClient = (cfg: PublicChainConfig) => createPublicClient({ chain: chainFor(cfg), transport: http(cfg.rpcUrl) });

/** A wallet/sign-in failure with a message that is safe to show to the user as written. */
export class WalletError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function provider(): Eip1193 {
  const p = activeProvider();
  if (!p) throw new WalletError("NO_WALLET", "No browser wallet found. Install MetaMask, Rabby or another EIP-1193 wallet, then reload.");
  return p;
}

type RpcError = { code?: number | string; message?: string; shortMessage?: string; cause?: RpcError; data?: { originalError?: { code?: number } } };
const codeOf = (e: unknown): number | string | undefined => {
  const x = e as RpcError;
  return x?.code ?? x?.cause?.code ?? x?.data?.originalError?.code;
};

/** Turn a raw wallet/RPC error into a readable one. `what` completes "while ...". */
export function walletError(e: unknown, what: string): WalletError {
  if (e instanceof WalletError) return e;
  const c = codeOf(e);
  const raw = (e as RpcError)?.shortMessage || (e as RpcError)?.message || "";
  if (c === 4001 || c === "ACTION_REJECTED") return new WalletError("USER_REJECTED", `You rejected the request in your wallet while ${what}. Nothing was changed.`);
  if (c === -32002) return new WalletError("REQUEST_PENDING", "Your wallet already has a request waiting. Open the wallet extension, answer it, then try again.");
  if (c === 4100) return new WalletError("UNAUTHORIZED", "Your wallet is locked or has not approved this site. Unlock it and approve the connection.");
  if (c === 4902) return new WalletError("CHAIN_MISSING", "Your wallet does not know the Arc Testnet network yet.");
  if (c === -32602) return new WalletError("BAD_PARAMS", `Your wallet rejected the request parameters while ${what}. ${raw}`.trim());
  return new WalletError("WALLET_ERROR", `Wallet error while ${what}${raw ? `: ${raw}` : "."}`);
}

/** Step 1 of connecting: ask the wallet for an account. Needs no server and no chain configuration. */
export async function requestAccount(): Promise<`0x${string}`> {
  const eth = provider();
  let accounts: unknown;
  try {
    accounts = await eth.request({ method: "eth_requestAccounts" });
  } catch (e) {
    throw walletError(e, "connecting");
  }
  const first = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
  if (!first) throw new WalletError("NO_ACCOUNT", "Your wallet returned no account. Unlock it, choose an account, and try again.");
  return getAddress(first);
}

/** EIP-3085 parameters for the configured chain (Arc: USDC is the native gas token, 18 decimals; display scaling is 6). */
export const addChainParams = (cfg: PublicChainConfig) => ({
  chainId: `0x${cfg.chainId.toString(16)}`,
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: [cfg.rpcUrl],
  blockExplorerUrls: [cfg.explorerUrl ?? "https://explorer.testnet.arc.io"],
});

/**
 * Separate step, only for on-chain actions: make sure the wallet is on the configured chain, adding it when unknown.
 * Never called while connecting / signing in.
 */
export async function ensureChain(cfg: PublicChainConfig): Promise<void> {
  const eth = provider();
  const hexId = `0x${cfg.chainId.toString(16)}`;
  try {
    const cur = await eth.request({ method: "eth_chainId" });
    if (typeof cur === "string" && cur.toLowerCase() === hexId) return;
  } catch {
    /* fall through to the switch */
  }
  const switchTo = () => eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  try {
    await switchTo();
    return;
  } catch (e) {
    const c = codeOf(e);
    const msg = ((e as RpcError)?.message ?? "").toLowerCase();
    // 4902 = unknown chain; some wallets answer -32603 / generic "unrecognized chain" instead
    if (!(c === 4902 || (c === -32603 && /unrecogni[sz]ed|not added|unknown chain|add/.test(msg)) || /unrecogni[sz]ed chain|not been added/.test(msg))) {
      throw walletError(e, "switching to Arc Testnet");
    }
  }
  try {
    await eth.request({ method: "wallet_addEthereumChain", params: [addChainParams(cfg)] });
    await switchTo().catch(() => undefined); // many wallets switch on add; a failed second switch is harmless
  } catch (e) {
    const c = codeOf(e);
    if (c === 4001 || c === "ACTION_REJECTED") throw walletError(e, "adding Arc Testnet");
    throw new WalletError("CHAIN_ADD_FAILED", `Could not add Arc Testnet (chain ${cfg.chainId}) to your wallet: ${walletError(e, "adding Arc Testnet").message} Add it manually: RPC ${cfg.rpcUrl}, chain ID ${cfg.chainId}, currency USDC.`);
  }
}

/** Account + correct chain, for on-chain actions (fund, claim, approve, ...). Sign-in does NOT use this. */
export async function connectWallet(cfg: PublicChainConfig): Promise<{ address: `0x${string}`; wallet: WalletClient }> {
  const eth = provider();
  const address = await requestAccount();
  await ensureChain(cfg);
  return { address, wallet: createWalletClient({ chain: chainFor(cfg), transport: custom(eth) }) };
}

/** SIWE sign-in: nonce -> wallet signature -> session cookie. `role` is required for a brand-new non-admin account. Needs no chain config. */
export async function signIn(address: `0x${string}`, role?: "CAMPAIGNER" | "CREATOR", wallet?: WalletClient) {
  const n = await api<{ nonce: string; domain: string; uri: string; chainId: number; statement: string; expiresAt: string }>("/auth/nonce");
  const message = createSiweMessage({
    address,
    chainId: n.chainId,
    domain: n.domain,
    nonce: n.nonce,
    uri: n.uri,
    version: "1",
    statement: n.statement,
    issuedAt: new Date(),
    expirationTime: new Date(n.expiresAt),
  });
  const w = wallet ?? createWalletClient({ transport: custom(provider()) });
  let signature: `0x${string}`;
  try {
    signature = await w.signMessage({ account: address, message });
  } catch (e) {
    throw walletError(e, "signing in");
  }
  return api<{ token: string; user: { id: string; role: string; wallet: string; verified: boolean } }>("/auth/session", {
    json: { message, signature, role },
  });
}

interface FundPreviewResponse {
  preview: { poolAmount: number; campaignerFeeBps: number; campaignerFee: number; netPool: number; totalToApprove: number; highValue: boolean };
  fees: FeesConfig;
  chain: PublicChainConfig;
  createCampaignArgs: { mode: number; ratePer1kViews: string; poolAmount: string; deadline: number; requireAdminApproval: boolean; metadataURI: string };
}

/** Fund preview (fee, net pool, high-value flag) without sending anything. */
export const previewFund = (campaignId: string) => api<FundPreviewResponse>(`/campaigns/${campaignId}/fund`);

/** USDC approve (only if the allowance is short) + createCampaign, then ask the server to verify the receipt. */
export async function fundCampaign(campaignId: string, opts: { onStep?: (s: "approve" | "create" | "verify") => void } = {}) {
  const p = await previewFund(campaignId);
  const cfg = p.chain;
  if (!cfg.enabled || !cfg.escrow) throw new Error("The escrow chain is not configured on this deployment");
  const { address, wallet } = await connectWallet(cfg);
  const pc = readClient(cfg);
  const a = p.createCampaignArgs;
  const amount = BigInt(a.poolAmount);

  const allowance = await pc.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "allowance", args: [address, cfg.escrow] });
  if (allowance < amount) {
    opts.onStep?.("approve");
    const h = await wallet.writeContract({ account: address, chain: chainFor(cfg), address: cfg.usdc, abi: erc20Abi, functionName: "approve", args: [cfg.escrow, amount] });
    await pc.waitForTransactionReceipt({ hash: h });
  }
  opts.onStep?.("create");
  const txHash = await wallet.writeContract({
    account: address,
    chain: chainFor(cfg),
    address: cfg.escrow,
    abi: escrowAbi,
    functionName: "createCampaign",
    args: [a.mode, BigInt(a.ratePer1kViews), amount, BigInt(a.deadline), a.requireAdminApproval, a.metadataURI],
  });
  await pc.waitForTransactionReceipt({ hash: txHash });
  opts.onStep?.("verify");
  const res = await api<{ campaign: unknown; verified: boolean }>(`/campaigns/${campaignId}/fund`, { json: { txHash } });
  return { txHash, preview: p.preview, ...res };
}

interface ClaimPreviewResponse {
  payout: { id: string; amount: number; claimedAmount: number; status: string; releaseAt: string | null };
  preview: { gross: number; creatorFeeBps: number; fee: number; net: number };
  claimable: boolean;
  frozen: boolean;
  frozenReason: string | null;
  releaseAt: string | null;
  retentionDays: number;
  chain: PublicChainConfig;
  onchain: { functionName: "claim"; args: [string] } | null;
}

/** Claim preview (gross, creator-side fee, net, retention/freeze state) without sending anything. */
export const previewClaim = (payoutId: string) => api<ClaimPreviewResponse>(`/payouts/${payoutId}/claim`);

/** escrow.claim(id) from the creator's wallet, then server-side receipt verification. */
export async function claimPayout(payoutId: string) {
  const p = await previewClaim(payoutId);
  if (p.frozen) throw new Error(p.frozenReason ?? "This payout is frozen pending review");
  if (!p.claimable) throw new Error(p.releaseAt ? `Not claimable yet (retention window ends ${new Date(p.releaseAt).toLocaleString()})` : "Nothing claimable right now");
  const cfg = p.chain;
  if (!cfg.enabled || !cfg.escrow || !p.onchain) throw new Error("The escrow chain is not configured on this deployment");
  const { address, wallet } = await connectWallet(cfg);
  const txHash = await wallet.writeContract({
    account: address,
    chain: chainFor(cfg),
    address: cfg.escrow,
    abi: escrowAbi,
    functionName: "claim",
    args: [BigInt(p.onchain.args[0])],
  });
  await readClient(cfg).waitForTransactionReceipt({ hash: txHash });
  const res = await api<{ payout: unknown; verified: boolean }>(`/payouts/${payoutId}/claim`, { json: { txHash } });
  return { txHash, preview: p.preview, ...res };
}

/** Admin: on-chain approve (pass the attestation from POST /campaigns/:id/attest for high-value campaigns), then verify via the API. */
export async function approveCampaignOnchain(campaignId: string, onchainId: string, attestation?: `0x${string}`) {
  const { chain: cfg } = await getChainConfig();
  if (!cfg.enabled || !cfg.escrow) throw new Error("The escrow chain is not configured on this deployment");
  const { address, wallet } = await connectWallet(cfg);
  const common = { account: address, chain: chainFor(cfg), address: cfg.escrow, abi: escrowAbi } as const;
  const txHash = attestation
    ? await wallet.writeContract({ ...common, functionName: "approveCampaign", args: [BigInt(onchainId), attestation] })
    : await wallet.writeContract({ ...common, functionName: "approveCampaign", args: [BigInt(onchainId)] });
  await readClient(cfg).waitForTransactionReceipt({ hash: txHash });
  return { txHash, ...(await api<object>(`/campaigns/${campaignId}/approve`, { json: { txHash } })) };
}

/** Admin: on-chain reject (full refund incl. fee), then verify via the API. */
export async function rejectCampaignOnchain(campaignId: string, onchainId: string, reason: string) {
  const { chain: cfg } = await getChainConfig();
  if (!cfg.enabled || !cfg.escrow) throw new Error("The escrow chain is not configured on this deployment");
  const { address, wallet } = await connectWallet(cfg);
  const txHash = await wallet.writeContract({ account: address, chain: chainFor(cfg), address: cfg.escrow, abi: escrowAbi, functionName: "rejectCampaign", args: [BigInt(onchainId)] });
  await readClient(cfg).waitForTransactionReceipt({ hash: txHash });
  return { txHash, ...(await api<object>(`/campaigns/${campaignId}/reject`, { json: { reason, txHash } })) };
}

/** Campaigner/admin: on-chain close (unallocated pool refunded), then verify via the API. */
export async function closeCampaignOnchain(campaignId: string, onchainId: string) {
  const { chain: cfg } = await getChainConfig();
  if (!cfg.enabled || !cfg.escrow) throw new Error("The escrow chain is not configured on this deployment");
  const { address, wallet } = await connectWallet(cfg);
  const txHash = await wallet.writeContract({ account: address, chain: chainFor(cfg), address: cfg.escrow, abi: escrowAbi, functionName: "closeCampaign", args: [BigInt(onchainId)] });
  await readClient(cfg).waitForTransactionReceipt({ hash: txHash });
  return { txHash, ...(await api<object>(`/campaigns/${campaignId}/close`, { json: { txHash } })) };
}

/**
 * Split approval for ONE approver: POST /split (fresh World ID proof; returns the attestation + canonical on-chain args), then
 * `approveSplit(id, creators, amounts, attestation)` from that approver's wallet. The second approver (CAMPAIGNER_AND_ADMIN)
 * repeats this with their own proof and the identical split.
 */
export async function approveSplit(
  campaignId: string,
  splits: { creatorWallet: string; amount: number }[],
  worldIdProof: { nullifier_hash: string; proof: string; merkle_root?: string; verification_level?: string; signal?: string },
  agentProposalId?: string,
) {
  const r = await api<{
    proposal: { id: string; status: string; splitHash: string; approvals: { campaigner: boolean; admin: boolean }; awaiting: string[] };
    attestation: `0x${string}`;
    onchain: { functionName: "approveSplit"; args: { id: string; creators: `0x${string}`[]; amounts: string[]; attestation: `0x${string}` } } | null;
  }>(`/campaigns/${campaignId}/split`, { json: { splits, worldIdProof, ...(agentProposalId ? { agentProposalId } : {}) } });
  if (!r.onchain) return { ...r, txHash: null };
  const { chain: cfg } = await getChainConfig();
  if (!cfg.enabled || !cfg.escrow) return { ...r, txHash: null };
  const { address, wallet } = await connectWallet(cfg);
  const a = r.onchain.args;
  const txHash = await wallet.writeContract({
    account: address,
    chain: chainFor(cfg),
    address: cfg.escrow,
    abi: escrowAbi,
    functionName: "approveSplit",
    args: [BigInt(a.id), a.creators, a.amounts.map((x) => BigInt(x)), a.attestation],
  });
  await readClient(cfg).waitForTransactionReceipt({ hash: txHash });
  return { ...r, txHash };
}
