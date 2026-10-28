import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, route } from "@/lib/http";
import { getShortlist, shortlistView, type IdCreatorCtx } from "@/lib/workspace/hires";

export const DELETE = route(async (req: Request, { params }: IdCreatorCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const { id, creatorId } = await params;
  const s = await getShortlist(id);
  if (s.ownerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your shortlist");
  await db.shortlistItem.deleteMany({ where: { shortlistId: id, creatorId } });
  return ok(await shortlistView(s, true));
});
