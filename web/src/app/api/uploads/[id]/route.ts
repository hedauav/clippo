import { getUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { assetView, canReadAsset } from "@/lib/source";
import { getStorage } from "@/lib/storage";

export const GET = route(async (req: Request, { params }: Ctx) => {
  const asset = await db.sourceAsset.findUnique({ where: { id: (await params).id } });
  if (!asset || !(await canReadAsset(await getUser(req), asset))) throw new ApiError(404, "NOT_FOUND", "Upload not found");
  return ok({ upload: assetView(asset) });
});

/** Owner removes an upload that is not attached to a live campaign. */
export const DELETE = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const asset = await db.sourceAsset.findUnique({ where: { id: (await params).id } });
  if (!asset || (asset.ownerId !== user.id && user.role !== "ADMIN")) throw new ApiError(404, "NOT_FOUND", "Upload not found");
  if (asset.campaignId) {
    const c = await db.campaign.findUnique({ where: { id: asset.campaignId }, select: { status: true } });
    if (c && c.status !== "DRAFT") throw new ApiError(409, "BAD_STATE", "Source of a funded or live campaign cannot be deleted");
  }
  if (asset.storageKey) await getStorage().delete(asset.storageKey);
  await db.sourceAsset.delete({ where: { id: asset.id } });
  return ok({ deleted: true });
});
