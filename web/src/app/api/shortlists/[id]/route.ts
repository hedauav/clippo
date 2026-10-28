import { requireUser } from "@/lib/auth";
import { ApiError, ok, route } from "@/lib/http";
import { getShortlist, shortlistView, type IdCtx } from "@/lib/workspace/hires";

export const GET = route(async (req: Request, { params }: IdCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER", "ADMIN"]);
  const s = await getShortlist((await params).id);
  if (user.role !== "ADMIN" && s.ownerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your shortlist");
  return ok(await shortlistView(s, true));
});
