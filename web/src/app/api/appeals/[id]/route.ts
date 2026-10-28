import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, route } from "@/lib/http";
import { appealView } from "@/lib/appeals";

export const GET = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req);
  const a = await db.appeal.findUnique({ where: { id: (await params).id } });
  const allowed = a && (user.role === "ADMIN" || a.creatorId === user.id || a.campaignerId === user.id);
  if (!a || !allowed) throw new ApiError(404, "NOT_FOUND", "Appeal not found");
  const verdict = await db.verdict.findUnique({ where: { id: a.verdictId } });
  return ok({ appeal: appealView(a), verdict });
});
