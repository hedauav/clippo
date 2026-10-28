import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { openAppeal } from "@/lib/appeals";
import { ApiError, ok, readJson, route } from "@/lib/http";

const body = z.object({ note: z.string().min(1).max(2000) });

/** Creator appeals a REJECT verdict; the campaigner reviews first (notified), an admin is the escalation. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CREATOR"]);
  const s = await db.submission.findUnique({
    where: { id: (await params).id },
    include: { verdict: true, campaign: { select: { campaignerId: true, title: true } } },
  });
  if (!s || s.creatorId !== user.id || !s.verdict) throw new ApiError(404, "NOT_FOUND", "Submission not found");
  if (s.verdict.result !== "REJECT") throw new ApiError(409, "BAD_STATE", "Only rejected clips can be appealed");
  if (s.verdict.appealStatus !== "NONE") throw new ApiError(409, "BAD_STATE", "Already appealed");
  const { note } = body.parse(await readJson(req));
  const verdict = await db.verdict.update({ where: { id: s.verdict.id }, data: { appealStatus: "PENDING", appealNote: note } });
  const appeal = await openAppeal({
    submissionId: s.id,
    verdictId: s.verdict.id,
    campaignId: s.campaignId,
    creatorId: s.creatorId,
    campaignerId: s.campaign.campaignerId,
    note,
    title: s.campaign.title,
  });
  return ok({ verdict, appeal });
});
