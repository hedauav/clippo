import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { chainSigner } from "@/lib/chain/signer";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/features";
import { ok, readJson, route } from "@/lib/http";
import { setFrozen } from "@/lib/modules/referral";

/**
 * Freeze/unfreeze a referrer. The API-side freeze is always applied. It is ALSO mirrored on-chain
 * (ClippoReferral.setFrozen, signed by UPDATER_PRIVATE_KEY, which must be a guardian) when REFERRAL_ADDRESS and the key are
 * configured; otherwise `onchain.mirrored` is false with the reason. Fraud-freeze note: an API freeze alone cannot stop a
 * direct contract call; only the on-chain freeze (and the retention window for PER_VIEW credits) does.
 */
export const POST = route(async (req: Request) => {
  requireFeature("referral");
  await requireUser(req, ["ADMIN"]);
  const b = z.object({ userId: z.string().min(1), frozen: z.boolean(), reason: z.string().max(500).optional() }).parse(await readJson(req));
  const state = await setFrozen(b.userId, b.frozen, b.reason);
  let onchain: { mirrored: boolean; txHash?: string; reason?: string };
  if (!process.env.REFERRAL_ADDRESS || !process.env.UPDATER_PRIVATE_KEY) {
    onchain = { mirrored: false, reason: "not configured: set REFERRAL_ADDRESS and UPDATER_PRIVATE_KEY to mirror freezes on-chain" };
  } else {
    const u = await db.user.findUnique({ where: { id: b.userId }, select: { wallet: true } });
    try {
      onchain = { mirrored: true, txHash: await chainSigner().setReferrerFrozen(u!.wallet as `0x${string}`, b.frozen) };
    } catch (e) {
      onchain = { mirrored: false, reason: e instanceof Error ? e.message : "on-chain freeze failed" };
    }
  }
  return ok({ state, onchain });
});
