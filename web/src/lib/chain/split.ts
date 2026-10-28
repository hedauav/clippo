import { encodeAbiParameters, getAddress, isAddress, keccak256, toHex } from "viem";
import { fromUnits, toUnits } from "./units";

export interface SplitEntryInput {
  creatorWallet: string;
  amount: number;
}
export interface SplitEntry {
  creatorWallet: string; // lower-case
  amount: number; // USDC
  units: bigint; // base units (what goes on-chain)
}

/**
 * Canonical form of a split: wallets lower-cased, duplicate wallets merged, amounts in micro-USDC,
 * sorted by wallet. Both approvers' submissions are compared (and sent on-chain) in this order,
 * so "identical split" is order-insensitive.
 */
export function normalizeSplit(entries: SplitEntryInput[]): SplitEntry[] {
  const m = new Map<string, bigint>();
  for (const e of entries) {
    const w = e.creatorWallet.trim().toLowerCase();
    m.set(w, (m.get(w) ?? 0n) + toUnits(e.amount));
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([creatorWallet, units]) => ({ creatorWallet, units, amount: fromUnits(units) }));
}

export const isValidSplitWallets = (s: SplitEntry[]) => s.every((e) => isAddress(e.creatorWallet, { strict: false }));

/**
 * Hash of a normalized split. For real addresses this equals the contract's
 * `keccak256(abi.encode(creators, amounts))` (what `pendingSplit(id).hash` stores); for non-address demo wallets
 * (mock mode only) it falls back to a keccak of a canonical string.
 */
export function splitHash(s: SplitEntry[]): `0x${string}` {
  if (isValidSplitWallets(s)) {
    return keccak256(
      encodeAbiParameters(
        [{ type: "address[]" }, { type: "uint256[]" }],
        [s.map((e) => getAddress(e.creatorWallet)), s.map((e) => e.units)],
      ),
    );
  }
  return keccak256(toHex(`clippo-split:${s.map((e) => `${e.creatorWallet}=${e.units}`).join(",")}`));
}

/** Arguments for ClippoEscrow.approveSplit(id, creators, amounts[, attestation]). */
export const onchainSplitArgs = (s: SplitEntry[]) => ({
  creators: s.map((e) => e.creatorWallet as `0x${string}`),
  amounts: s.map((e) => e.units.toString()),
});

/** bytes32 recorded on-chain as the approver's human-confirmation attestation. */
export function attestationHash(p: {
  kind: "APPROVE" | "SPLIT";
  campaignKey: string; // on-chain id when known, else DB id
  wallet: string;
  nullifier: string;
  proofHash: string;
  splitHash?: string;
}): `0x${string}` {
  return keccak256(
    toHex(
      ["clippo:attest:v1", p.kind, p.campaignKey, p.wallet.toLowerCase(), p.nullifier, p.proofHash, p.splitHash ?? ""].join("|"),
    ),
  );
}
