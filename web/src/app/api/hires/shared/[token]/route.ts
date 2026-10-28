import { db } from "@/lib/db";
import { ApiError, ok, route } from "@/lib/http";
import { hireView, type TokenCtx } from "@/lib/workspace/hires";

/** Public read-only view of a hire (brief, creators, live budget, tracking) via its share token. */
export const GET = route(async (_req: Request, { params }: TokenCtx) => {
  const hire = await db.hire.findUnique({ where: { shareToken: (await params).token } });
  if (!hire) throw new ApiError(404, "NOT_FOUND", "Hire not found");
  return ok(await hireView(hire, { includeToken: false }));
});
