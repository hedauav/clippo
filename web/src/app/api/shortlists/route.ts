import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, readJson, route } from "@/lib/http";
import { newToken, shortlistView } from "@/lib/workspace/hires";

const body = z.object({ title: z.string().trim().min(1).max(120), creatorIds: z.array(z.string()).max(100).default([]) });

export const POST = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const v = body.parse(await readJson(req));
  const s = await db.shortlist.create({ data: { ownerId: user.id, title: v.title, shareToken: newToken() } });
  const valid = await db.creatorProfile.findMany({ where: { userId: { in: v.creatorIds }, listed: true }, select: { userId: true } });
  for (const p of valid) await db.shortlistItem.create({ data: { shortlistId: s.id, creatorId: p.userId } });
  return ok(await shortlistView(s, true), 201);
});

export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const rows = await db.shortlist.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } });
  return ok({ shortlists: rows });
});
