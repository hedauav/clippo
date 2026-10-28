import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { notify } from "@/lib/notify";

const body = z.object({ approve: z.boolean(), note: z.string().max(500).optional() });

/** Admin manually decides a channel proof the platform could not check automatically (after eyeballing the bio). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  await requireUser(req, ["ADMIN"]);
  const ch = await db.channel.findUnique({ where: { id: (await params).id } });
  if (!ch) throw new ApiError(404, "NOT_FOUND", "Channel not found");
  const v = body.parse(await readJson(req));
  const channel = v.approve ? await db.channel.update({ where: { id: ch.id }, data: { verified: true } }) : ch;
  await notify({
    userId: ch.userId,
    type: v.approve ? "CHANNEL_VERIFIED" : "CHANNEL_REJECTED",
    title: v.approve ? "Channel verified" : "Channel proof not accepted",
    body: v.approve ? `@${ch.handle} is now verified.` : `We could not confirm the code in @${ch.handle}'s bio. ${v.note ?? ""}`.trim(),
    refType: "channel",
    refId: ch.id,
  });
  return ok({ channel });
});
