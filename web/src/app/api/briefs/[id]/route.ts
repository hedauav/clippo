import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, route } from "@/lib/http";
import type { IdCtx } from "@/lib/workspace/hires";

export const GET = route(async (req: Request, { params }: IdCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const brief = await db.hireBrief.findUnique({ where: { id: (await params).id } });
  if (!brief || (user.role !== "ADMIN" && brief.campaignerId !== user.id)) throw new ApiError(404, "NOT_FOUND", "Brief not found");
  return ok({ brief });
});
