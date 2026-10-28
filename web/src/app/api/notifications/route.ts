import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/http";

/** The caller's notification records, newest first. `?unread=true` filters to unread. */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "true";
  const [notifications, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return ok({ notifications, unread });
});
