import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { jobView } from "@/lib/video/jobs";

/** Campaigner rejects the rendered video (revokes any earlier approval); generate a new one to continue. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const job = await db.videoJob.findUnique({ where: { id: (await params).id } });
  if (!job || job.requestedById !== user.id) throw new ApiError(404, "NOT_FOUND", "Video job not found");
  const updated = await db.videoJob.update({ where: { id: job.id }, data: { approvalStatus: "REJECTED", approvedById: null, approvedAt: null } });
  return ok({ job: jobView(updated) });
});
