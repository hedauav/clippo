import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ok, readJson, route } from "@/lib/http";
import { profileSchema } from "@/lib/workspace/hires";

/** The signed-in creator's directory profile (null if none yet). */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  return ok({ profile: await db.creatorProfile.findUnique({ where: { userId: user.id } }) });
});

/** Create or replace the creator's profile and rate card (rates are creator-set). */
export const PUT = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  const v = profileSchema.parse(await readJson(req));
  const profile = await db.creatorProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...v },
    update: v,
  });
  return ok({ profile });
});
