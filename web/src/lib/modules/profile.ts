import { createHash } from "node:crypto";
import { db } from "../db";
import { isEnabled } from "../features";
import { chainSigner, ProfileNotOnchainError } from "../chain/signer";
import { TIERS, computeTier, loadMetrics } from "./ladder";

export interface ProfilePayload {
  tier: number; // 0 none, 1 Verified .. 4 Top (matches ClippoCreatorProfile)
  approvedClips: number;
  rejectedClips: number;
  totalViews: number;
  totalEarnedUsdc: number; // micro-USDC (6 decimals)
}

export const tierToNumber = (t: (typeof TIERS)[number] | null) => (t ? TIERS.indexOf(t) + 1 : 0);

export const hashPayload = (p: ProfilePayload) => createHash("sha256").update(JSON.stringify(p)).digest("hex");

export async function buildPayload(userId: string): Promise<ProfilePayload> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { verified: true } });
  const m = (await loadMetrics([userId])).get(userId);
  const approved = m?.approvedClips ?? 0;
  const claimed = await db.payout.aggregate({ where: { creatorId: userId, status: "CLAIMED" }, _sum: { amount: true } });
  // Tier is only published when the status ladder module is on; otherwise 0.
  const tier = isEnabled("statusLadder") && m ? tierToNumber(computeTier(!!user?.verified, m)) : 0;
  return {
    tier,
    approvedClips: approved,
    rejectedClips: (m?.reviewedClips ?? 0) - approved,
    totalViews: m?.verifiedViews ?? 0,
    totalEarnedUsdc: Math.round((claimed._sum.amount ?? 0) * 1e6),
  };
}

export const getProfile = (userId: string) => db.onchainProfile.findUnique({ where: { userId } });

export async function setOptIn(userId: string, optedIn: boolean) {
  return db.onchainProfile.upsert({
    where: { userId },
    create: { userId, optedIn },
    update: optedIn ? { optedIn } : { optedIn, payloadHash: null, syncedAt: null, txHash: null },
  });
}

/**
 * Chain hook: writes ClippoCreatorProfile.updateProfile with the server's UPDATER_PRIVATE_KEY signer (lib/chain/signer.ts).
 * Throws 503 NOT_CONFIGURED when UPDATER_PRIVATE_KEY / PROFILE_ADDRESS are missing.
 */
export const writeProfileOnchain = (wallet: string, p: ProfilePayload) =>
  chainSigner().updateProfile(wallet as `0x${string}`, p, `clippo://profile/${wallet}`);

/**
 * Compute the payload for every opted-in creator and record changes. `onWrite` performs the on-chain
 * ClippoCreatorProfile.updateProfile write (default: the real updater signer). A creator who opted in off-chain but has no
 * on-chain profile yet is skipped (counted in `skipped`) and retried next sync. A row is only marked synced after a tx hash.
 */
export async function syncProfiles(onWrite: (wallet: string, p: ProfilePayload) => Promise<string | null> = writeProfileOnchain) {
  const rows = await db.onchainProfile.findMany({ where: { optedIn: true } });
  let changed = 0;
  let skipped = 0;
  for (const r of rows) {
    const payload = await buildPayload(r.userId);
    const hash = hashPayload(payload);
    if (hash === r.payloadHash) continue;
    let txHash: string | null = null;
    const u = await db.user.findUnique({ where: { id: r.userId }, select: { wallet: true } });
    if (!u) continue;
    try {
      txHash = await onWrite(u.wallet, payload);
    } catch (e) {
      if (e instanceof ProfileNotOnchainError) {
        skipped++;
        continue;
      }
      throw e;
    }
    await db.onchainProfile.update({
      where: { userId: r.userId },
      data: { payload: payload as unknown as object, payloadHash: hash, syncedAt: new Date(), txHash },
    });
    changed++;
  }
  return { checked: rows.length, changed, skipped };
}
