import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getOverride, notConfigured, requireEnv } from "../config";
import { arcChain, chainConfig } from "./config";
import { publicClient } from "./clients";

/** Narrow signer the backend uses for the two server-signed writes (tests inject a double). */
export interface ChainSigner {
  updateProfile(creator: `0x${string}`, p: { tier: number; approvedClips: number; rejectedClips: number; totalViews: number; totalEarnedUsdc: number }, metadataURI: string): Promise<string>;
  setReferrerFrozen(referrer: `0x${string}`, frozen: boolean): Promise<string>;
}

export class ProfileNotOnchainError extends Error {
  constructor(wallet: string) {
    super(`${wallet} has no on-chain profile (the creator must call optIn() on ClippoCreatorProfile first)`);
  }
}

const profileAbi = parseAbi([
  "function updateProfile(address creator,uint8 tier,uint32 approvedClips,uint32 rejectedClips,uint64 totalViews,uint64 totalEarnedUsdc,string metadataURI)",
  "function hasProfile(address creator) view returns (bool)",
]);
const referralAbi = parseAbi(["function setFrozen(address referrer,bool f)"]);

const isAddr = (a: string | undefined): a is `0x${string}` => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

/**
 * Real signer: UPDATER_PRIVATE_KEY (a wallet registered via ClippoCreatorProfile.setUpdater; also the guardian of
 * ClippoReferral if you want referrer freezes mirrored on-chain). Fails loudly (503) when not configured.
 */
export function chainSigner(): ChainSigner {
  const o = getOverride<ChainSigner>("chainSigner");
  if (o) return o;
  const key = requireEnv("Chain updater signer", "UPDATER_PRIVATE_KEY");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  const cfg = chainConfig();
  const wallet = createWalletClient({ account, chain: arcChain(cfg), transport: http(cfg.rpcUrl) });
  const pc = publicClient();
  return {
    async updateProfile(creator, p, metadataURI) {
      const address = process.env.PROFILE_ADDRESS;
      if (!isAddr(address)) throw notConfigured("On-chain creator profile", "PROFILE_ADDRESS");
      if (!(await pc.readContract({ address, abi: profileAbi, functionName: "hasProfile", args: [creator] }))) throw new ProfileNotOnchainError(creator);
      const hash = await wallet.writeContract({
        address,
        abi: profileAbi,
        functionName: "updateProfile",
        args: [creator, p.tier, p.approvedClips, p.rejectedClips, BigInt(p.totalViews), BigInt(p.totalEarnedUsdc), metadataURI],
      });
      await pc.waitForTransactionReceipt({ hash });
      return hash;
    },
    async setReferrerFrozen(referrer, frozen) {
      const address = process.env.REFERRAL_ADDRESS;
      if (!isAddr(address)) throw notConfigured("On-chain referral", "REFERRAL_ADDRESS");
      const hash = await wallet.writeContract({ address, abi: referralAbi, functionName: "setFrozen", args: [referrer, frozen] });
      await pc.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}
