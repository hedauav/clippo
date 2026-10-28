import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, readJson, route } from "@/lib/http";

const body = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() });

/** Mark notifications read: `{ids: [...]}` or `{all: true}`. Only the caller's own records are touched. */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  const v = body.parse(await readJson(req));
  const r = await db.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(v.all ? {} : { id: { in: v.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return ok({ updated: r.count });
});
