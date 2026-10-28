import { db } from "./db";

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  refType?: string;
  refId?: string;
}

/** Persist an in-app notification record. Failures never break the caller's request. */
export async function notify(n: NotifyInput): Promise<void> {
  try {
    await db.notification.create({ data: n });
  } catch (e) {
    console.error("notify failed", e);
  }
}

export async function notifyAdmins(n: Omit<NotifyInput, "userId">): Promise<void> {
  try {
    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    await Promise.all(admins.map((a) => notify({ ...n, userId: a.id })));
  } catch (e) {
    console.error("notifyAdmins failed", e);
  }
}
