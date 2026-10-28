import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, route } from "@/lib/http";
import { assetResponse, canReadAsset } from "@/lib/source";

/** Playback/download of the AI-generated video. Response carries `X-Clippo-AI-Generated: true`. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const job = await db.videoJob.findUnique({ where: { id } });
  const asset = job?.outputAssetId ? await db.sourceAsset.findUnique({ where: { id: job.outputAssetId } }) : null;
  if (!job || !asset || !(await canReadAsset(await getUser(req), asset, id))) throw new ApiError(404, "NOT_FOUND", "Video not found");
  return assetResponse(req, asset, new URL(req.url).searchParams.get("download") === "1");
});
