import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { ok, readJson, route } from "@/lib/http";
import { createLink, summary } from "@/lib/modules/referral";

export const GET = route(async (req: Request) => {
  requireFeature("referral");
  const user = await requireUser(req, ["CREATOR"]);
  return ok({ links: (await summary(user.id)).links });
});

export const POST = route(async (req: Request) => {
  requireFeature("referral");
  const user = await requireUser(req, ["CREATOR"]);
  const { campaignId } = z.object({ campaignId: z.string().min(1) }).parse(await readJson(req));
  return ok({ link: await createLink(user.id, campaignId) }, 201);
});
