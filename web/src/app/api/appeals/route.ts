import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { appealView } from "@/lib/appeals";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/http";

/**
 * Appeals visible to the caller. Creator: their own. Campaigner: on their campaigns. Admin: escalated or overdue
 * (`?all=true` for every appeal). Optional `?status=OPEN|UPHELD|OVERTURNED`.
 */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const where: Prisma.AppealWhereInput = {};
  if (status) where.status = status;
  if (user.role === "CREATOR") where.creatorId = user.id;
  else if (user.role === "CAMPAIGNER") where.campaignerId = user.id;
  else if (url.searchParams.get("all") !== "true") where.OR = [{ stage: "ADMIN" }, { stage: "CAMPAIGNER", status: "OPEN", dueAt: { lt: new Date() } }];
  const rows = await db.appeal.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  return ok({ appeals: rows.map(appealView) });
});
