import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, readJson, route } from "@/lib/http";
import { briefSchema } from "@/lib/workspace/hires";

export const POST = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const v = briefSchema.parse(await readJson(req));
  return ok({ brief: await db.hireBrief.create({ data: { campaignerId: user.id, ...v } }) }, 201);
});

export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  return ok({ briefs: await db.hireBrief.findMany({ where: { campaignerId: user.id }, orderBy: { createdAt: "desc" } }) });
});
