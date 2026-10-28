import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { jobView, refreshJob } from "@/lib/video/jobs";

/** Job status (polls the provider; on success the output is stored as an AI-generated source asset). */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const job = await db.videoJob.findUnique({ where: { id: (await params).id } });
  if (!job || (job.requestedById !== user.id && user.role !== "ADMIN")) throw new ApiError(404, "NOT_FOUND", "Video job not found");
  const r = await refreshJob(job);
  return ok({ job: jobView(r.job, r.progress) });
});
