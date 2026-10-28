import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCampaign, type Ctx } from "@/lib/domain";
import { ApiError, ok, readJson, route } from "@/lib/http";

const body = z
  .object({
    minRate: z.number().positive().max(10_000),
    maxRate: z.number().positive().max(10_000),
    autoAcceptUpTo: z.number().positive().max(10_000).nullable().optional(),
  })
  .refine((v) => v.minRate <= v.maxRate, { message: "minRate must be <= maxRate", path: ["minRate"] })
  .refine((v) => v.autoAcceptUpTo == null || (v.autoAcceptUpTo >= v.minRate && v.autoAcceptUpTo <= v.maxRate), {
    message: "autoAcceptUpTo must sit inside the band",
    path: ["autoAcceptUpTo"],
  });

/** Campaigner publishes the negotiation band (USDC per 1k views) and an optional standing auto-accept ceiling. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser(req, ["CAMPAIGNER"]);
  const c = await getCampaign((await params).id);
  if (c.campaignerId !== user.id) throw new ApiError(403, "FORBIDDEN", "Not your campaign");
  const v = body.parse(await readJson(req));
  const terms = await db.dealTerms.upsert({
    where: { campaignId: c.id },
    create: { campaignId: c.id, minRate: v.minRate, maxRate: v.maxRate, autoAcceptUpTo: v.autoAcceptUpTo ?? null },
    update: { minRate: v.minRate, maxRate: v.maxRate, autoAcceptUpTo: v.autoAcceptUpTo ?? null },
  });
  return ok({ terms });
});
