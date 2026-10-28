import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { onVerdictSet } from "@/lib/appeals";
import { ApiError, ok, readJson, route } from "@/lib/http";

const body = z.object({
  result: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().min(1).max(2000),
});

/** Campaigner (owner) or admin overrides / resolves a verdict; also resolves a pending appeal. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const s = await db.submission.findUnique({
    where: { id: (await params).id },
    include: { verdict: true, campaign: { select: { campaignerId: true } } },
  });
  if (!s || !s.verdict) throw new ApiError(404, "NOT_FOUND", "Submission not found");
  if (user.role !== "ADMIN" && s.campaign.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  const v = body.parse(await readJson(req));
  // Appeal ownership: campaigner first, admin after escalation/SLA; notifies the creator (lib/appeals.ts).
  const appealStatus = await onVerdictSet(user, s, s.verdict, v.result, v.reason);
  const verdict = await db.verdict.update({
    where: { id: s.verdict.id },
    data: { result: v.result, reason: v.reason, confidence: 1, decidedBy: "HUMAN", deciderId: user.id, appealStatus },
  });
  return ok({ verdict });
});
