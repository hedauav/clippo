import { requireUser } from "@/lib/auth";
import { appealView, escalateAppeal } from "@/lib/appeals";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";

/** Escalate to an admin: by the creator after the campaigner upheld the rejection, or by the campaigner while open. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CREATOR", "CAMPAIGNER"]);
  const a = await db.appeal.findUnique({ where: { id: (await params).id } });
  if (!a || (a.creatorId !== user.id && a.campaignerId !== user.id)) throw new ApiError(404, "NOT_FOUND", "Appeal not found");
  return ok({ appeal: appealView(await escalateAppeal(user, a)) });
});
