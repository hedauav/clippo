import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, route } from "@/lib/http";
import { assetResponse, canReadAsset } from "@/lib/source";

/** Playback (inline, Range supported) or download (`?download=1`) of a stored source clip. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const asset = await db.sourceAsset.findUnique({ where: { id: (await params).id } });
  if (!asset || !(await canReadAsset(await getUser(req), asset))) throw new ApiError(404, "NOT_FOUND", "Upload not found");
  return assetResponse(req, asset, new URL(req.url).searchParams.get("download") === "1");
});
