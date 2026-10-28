import { db } from "@/lib/db";
import { ok, route } from "@/lib/http";
import { requireCron } from "@/lib/modules/cron";
import { refreshJob } from "@/lib/video/jobs";

/** Vercel Cron: poll in-flight AI video jobs so they finish (and the output is stored) even when nobody has the page open. */
export const GET = route(async (req: Request) => {
  requireCron(req);
  const jobs = await db.videoJob.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] }, providerJobId: { not: null } }, orderBy: { updatedAt: "asc" }, take: 5 });
  const results: { id: string; status: string }[] = [];
  for (const j of jobs) {
    try {
      results.push({ id: j.id, status: (await refreshJob(j)).job.status });
    } catch (e) {
      results.push({ id: j.id, status: `error: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }
  return ok({ polled: results.length, results });
});
