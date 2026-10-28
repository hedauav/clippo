import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";

/** One submission with its verdict. Visible to its creator, the campaign owner and admins. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req);
  const s = await db.submission.findUnique({
    where: { id: (await params).id },
    include: { verdict: true, campaign: { select: { id: true, title: true, campaignerId: true } } },
  });
  if (!s || (s.creatorId !== user.id && s.campaign.campaignerId !== user.id && user.role !== "ADMIN")) {
    throw new ApiError(404, "NOT_FOUND", "Submission not found");
  }
  return ok({ submission: s });
});
