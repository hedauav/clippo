import type { FraudFlag } from "@prisma/client";
import { db } from "../db";
import { ApiError } from "../http";

const frozenReasonFor = (videoId: string) => `Clip ${videoId} was deleted or made private; unclaimed balance frozen pending admin review`;

/**
 * Clip deleted after approval: stop feeding its views, open an admin flag and FREEZE the creator's unclaimed payouts for that
 * campaign (the claim API refuses them). Already-claimed money is untouched; on-chain credits already past the retention window
 * stay claimable on-chain (the API cannot block a direct contract call), which is why the retention window exists.
 */
export async function markClipDeleted(sub: { id: string; campaignId: string; creatorId: string; videoId: string }, day: string) {
  await db.$transaction(async (tx) => {
    await tx.submission.update({ where: { id: sub.id }, data: { clipStatus: "DELETED", deletedAt: new Date() } });
    await tx.fraudFlag.upsert({
      where: { submissionId_kind_day: { submissionId: sub.id, kind: "CLIP_DELETED", day } },
      create: { kind: "CLIP_DELETED", campaignId: sub.campaignId, submissionId: sub.id, day, details: { videoId: sub.videoId } },
      update: {},
    });
    await tx.payout.updateMany({
      where: { campaignId: sub.campaignId, creatorId: sub.creatorId, status: "PENDING" },
      data: { frozen: true, frozenReason: frozenReasonFor(sub.videoId) },
    });
  });
}

/** Clip is public again (or admin dismissed the flag): resume feeding views and unfreeze if nothing else holds the balance. */
export async function restoreClip(sub: { id: string; campaignId: string; creatorId: string }, resolvedBy: string | null) {
  await db.$transaction(async (tx) => {
    await tx.submission.update({ where: { id: sub.id }, data: { clipStatus: "LIVE", deletedAt: null } });
    await tx.fraudFlag.updateMany({
      where: { submissionId: sub.id, kind: "CLIP_DELETED", status: { in: ["OPEN"] } },
      data: { status: "DISMISSED", resolvedAt: new Date(), resolvedBy: resolvedBy ?? "system:clip-restored" },
    });
    // other deleted clips by the same creator in the same campaign keep the freeze
    const others = await tx.submission.count({
      where: { campaignId: sub.campaignId, creatorId: sub.creatorId, clipStatus: "DELETED", id: { not: sub.id } },
    });
    if (others === 0) {
      await tx.payout.updateMany({
        where: { campaignId: sub.campaignId, creatorId: sub.creatorId, frozen: true },
        data: { frozen: false, frozenReason: null },
      });
    }
  });
}

/** Admin decision on a flag. DISMISS = false alarm (restores clip / releases the view hold). CONFIRM = fraud: stays held/frozen. */
export async function resolveFlag(flagId: string, action: "DISMISS" | "CONFIRM", adminId: string): Promise<FraudFlag> {
  const flag = await db.fraudFlag.findUnique({ where: { id: flagId } });
  if (!flag) throw new ApiError(404, "NOT_FOUND", "Flag not found");
  if (flag.status !== "OPEN") throw new ApiError(409, "BAD_STATE", `Flag is already ${flag.status}`);
  if (action === "DISMISS") {
    if (flag.kind === "CLIP_DELETED") {
      const s = await db.submission.findUniqueOrThrow({ where: { id: flag.submissionId } });
      await restoreClip(s, adminId); // also marks the flag DISMISSED
    }
    return db.fraudFlag.update({ where: { id: flag.id }, data: { status: "DISMISSED", resolvedAt: new Date(), resolvedBy: adminId } });
  }
  return db.fraudFlag.update({ where: { id: flag.id }, data: { status: "CONFIRMED", resolvedAt: new Date(), resolvedBy: adminId } });
}
