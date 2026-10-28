import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { jobView, refreshJob } from "@/lib/video/jobs";

/** Campaigner explicitly approves the rendered AI video (required before the campaign can launch). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const found = await db.videoJob.findUnique({ where: { id: (await params).id } });
  if (!found || found.requestedById !== user.id) throw new ApiError(404, "NOT_FOUND", "Video job not found");
  const { job } = await refreshJob(found);
  if (job.status !== "SUCCEEDED" || !job.outputAssetId) throw new ApiError(409, "BAD_STATE", "The video has not finished rendering");
  if (!job.rightsConfirmed) throw new ApiError(409, "RIGHTS_NOT_CONFIRMED", "Rights confirmation is missing");
  const updated = await db.videoJob.update({ where: { id: job.id }, data: { approvalStatus: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
  return ok({ job: jobView(updated) });
});
