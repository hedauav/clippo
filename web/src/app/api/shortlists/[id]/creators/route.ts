import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { getShortlist, shortlistView, type IdCtx } from "@/lib/workspace/hires";

const body = z.object({ creatorId: z.string().min(1), note: z.string().max(500).default("") });

export const POST = route(async (req: Request, { params }: IdCtx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const s = await getShortlist((await params).id);
  if (s.ownerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your shortlist");
  const v = body.parse(await readJson(req));
  const p = await db.creatorProfile.findUnique({ where: { userId: v.creatorId } });
  if (!p || !p.listed) throw new ApiError(404, "NOT_FOUND", "Creator not found in the directory");
  await db.shortlistItem.upsert({
    where: { shortlistId_creatorId: { shortlistId: s.id, creatorId: v.creatorId } },
    create: { shortlistId: s.id, creatorId: v.creatorId, note: v.note },
    update: { note: v.note },
  });
  return ok(await shortlistView(s, true), 201);
});
