import { db } from "@/lib/db";
import { ApiError, ok, route } from "@/lib/http";
import { shortlistView, type TokenCtx } from "@/lib/workspace/hires";

/** Public read-only shortlist via its share token. */
export const GET = route(async (_req: Request, { params }: TokenCtx) => {
  const s = await db.shortlist.findUnique({ where: { shareToken: (await params).token } });
  if (!s) throw new ApiError(404, "NOT_FOUND", "Shortlist not found");
  return ok(await shortlistView(s, false));
});
